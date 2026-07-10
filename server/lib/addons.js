// Prepaid ADD-ONS (AI tokens + email credits).
//
// A bucket (app.account_addons) is a one-time prepaid balance drawn down only
// once the account's recurring base allowance is exhausted, and it never resets.
// Buckets are USABLE only while the plan is active (paying or non-expired); they
// freeze the moment the plan lapses and are hard-deleted by the 6-month purge in
// server/lib/billingLifecycle.js.
//
// Draw-down is period-scoped and self-healing: for a given period we compute the
// overflow that SHOULD have been charged to buckets (used - base), subtract what
// the app.addon_ledger already recorded this period, and deduct the remainder
// FIFO. That makes it idempotent (safe to call after every consuming event) and
// correct across period resets (a new period starts with zero ledger + zero used).

import { getAiQuota } from "./aiUsage.js";

// ── Plan state ──────────────────────────────────────────────────────────────
// Add-ons can be BOUGHT only by paying subscribers (converted: plan_expires_at
// NULL). They can be USED whenever the plan is active (not expired / not disabled).
export function canPurchaseAddons(account) {
  return !!account && account.is_active === true && account.plan_expires_at == null;
}
export function isPlanActive(account) {
  if (!account || account.is_active !== true) return false;
  return account.plan_expires_at == null || new Date(account.plan_expires_at).getTime() > Date.now();
}

export async function getAccountBillingState(pool, accountId) {
  const { rows } = await pool.query(
    "SELECT id, is_active, plan, plan_expires_at FROM app.accounts WHERE id = $1",
    [accountId]
  );
  return rows[0] || null;
}

// ── Catalog ─────────────────────────────────────────────────────────────────
export async function listAddonProducts(pool) {
  const { rows } = await pool.query(
    "SELECT * FROM app.addon_products WHERE is_active = true ORDER BY kind"
  );
  return rows;
}
export async function getAddonProduct(pool, kind) {
  const { rows } = await pool.query(
    "SELECT * FROM app.addon_products WHERE kind = $1 AND is_active = true",
    [kind]
  );
  return rows[0] || null;
}

// ── Balances ────────────────────────────────────────────────────────────────
// Current usable balance for a kind (0 when the plan is lapsed - the SQL function
// applies the same active-plan guard).
export async function getAddonBalance(pool, accountId, kind) {
  const { rows } = await pool.query("SELECT app.addon_balance($1, $2) AS bal", [accountId, kind]);
  return Number(rows[0]?.bal || 0);
}

// Raw active buckets (for display / Studio), independent of plan state.
export async function listAccountAddons(pool, accountId) {
  const { rows } = await pool.query(
    `SELECT id, kind, quantity, remaining, blocks, status, source, created_date
       FROM app.account_addons
      WHERE account_id = $1 AND status <> 'refunded'
      ORDER BY created_date DESC`,
    [accountId]
  );
  return rows;
}

// ── Granting (used by both Stripe fulfilment and admin grants) ──────────────
// Returns the new bucket row, or the existing one if this checkout session was
// already fulfilled (idempotent on stripe_checkout_session).
export async function grantAddon(pool, { accountId, kind, blocks, source = "stripe", stripeSession = null, stripePaymentIntent = null, createdBy = null }) {
  const product = await getAddonProduct(pool, kind);
  if (!product) throw new Error(`Unknown add-on kind: ${kind}`);
  const n = Math.max(product.min_blocks, Math.floor(Number(blocks) || 0));
  if (n < product.min_blocks) throw new Error(`Minimum ${product.min_blocks} block(s)`);
  const quantity = BigInt(n) * BigInt(product.block_size);

  if (stripeSession) {
    // Idempotent fulfilment: a redelivered webhook returns the already-granted row.
    const { rows: existing } = await pool.query(
      "SELECT * FROM app.account_addons WHERE stripe_checkout_session = $1",
      [stripeSession]
    );
    if (existing.length) return existing[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO app.account_addons
       (account_id, kind, quantity, remaining, blocks, source, stripe_checkout_session, stripe_payment_intent, created_by)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (stripe_checkout_session) WHERE (stripe_checkout_session IS NOT NULL) DO NOTHING
     RETURNING *`,
    [accountId, kind, quantity.toString(), n, source, stripeSession, stripePaymentIntent, createdBy]
  );
  if (rows.length) return rows[0];
  // Lost the race on the unique index - return the winner's row.
  const { rows: winner } = await pool.query(
    "SELECT * FROM app.account_addons WHERE stripe_checkout_session = $1",
    [stripeSession]
  );
  return winner[0] || null;
}

// ── Draw-down (generic, period-scoped, idempotent) ──────────────────────────
async function reconcileDrawdown(pool, { accountId, kind, periodStart, used, base }) {
  if (base == null) return 0;               // unlimited base -> buckets never touched
  const target = Math.max(0, Number(used) - Number(base));
  if (target <= 0) return 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [led] } = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS deducted
         FROM app.addon_ledger
        WHERE account_id = $1 AND kind = $2 AND occurred_at >= $3`,
      [accountId, kind, periodStart]
    );
    let toDeduct = target - Number(led.deducted);
    if (toDeduct <= 0) { await client.query("ROLLBACK"); return 0; }

    const { rows: buckets } = await client.query(
      `SELECT id, remaining FROM app.account_addons
        WHERE account_id = $1 AND kind = $2 AND status = 'active' AND remaining > 0
        ORDER BY created_date, id
        FOR UPDATE`,
      [accountId, kind]
    );

    let drawn = 0;
    for (const b of buckets) {
      if (toDeduct <= 0) break;
      const take = Math.min(Number(b.remaining), toDeduct);
      const newRemaining = Number(b.remaining) - take;
      await client.query(
        `UPDATE app.account_addons
            SET remaining = $2,
                status = CASE WHEN $2 <= 0 THEN 'exhausted' ELSE status END
          WHERE id = $1`,
        [b.id, newRemaining]
      );
      drawn += take;
      toDeduct -= take;
    }

    if (drawn > 0) {
      await client.query(
        `INSERT INTO app.addon_ledger (account_id, kind, amount, metadata)
         VALUES ($1, $2, $3, $4)`,
        [accountId, kind, drawn, JSON.stringify({ periodStart })]
      );
    }
    await client.query("COMMIT");
    return drawn;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("reconcileDrawdown failed:", e.message);
    return 0;
  } finally {
    client.release();
  }
}

// Draw AI overflow from ai_tokens buckets after an AI call has been recorded.
// base = ai_quota.token_limit (base+balance) minus the current balance = pure base.
export async function drawDownAiAddons(pool, accountId) {
  try {
    const q = await getAiQuota(pool, { accountId });
    if (q.limit == null) return 0;                       // unlimited plan
    const balance = await getAddonBalance(pool, accountId, "ai_tokens");
    const base = q.limit - balance;
    return await reconcileDrawdown(pool, { accountId, kind: "ai_tokens", periodStart: q.periodStart, used: q.used, base });
  } catch (e) {
    console.error("drawDownAiAddons failed:", e.message);
    return 0;
  }
}

// ── Email quota (monthly emails-sent + email_credits buckets) ───────────────
// Email base resets on the calendar month; buckets are prepaid and persistent.
export async function getEmailQuota(pool, accountId) {
  const { rows } = await pool.query(
    `SELECT a.is_active, a.plan_expires_at,
            COALESCE(
              NULLIF(a.settings->'limit_overrides'->>'campaigns', '')::bigint,
              NULLIF(p.limits->>'campaigns', '')::bigint
            ) AS base,
            app.addon_balance(a.id, 'email_credits') AS balance,
            (SELECT COALESCE(SUM(ue.quantity), 0)
               FROM app.usage_events ue
               JOIN app.companies c ON c.id = ue.company_id
              WHERE c.account_id = a.id
                AND ue.event_type = 'email_sent'
                AND ue.occurred_at >= date_trunc('month', now())) AS used,
            date_trunc('month', now()) AS period_start
       FROM app.accounts a
       JOIN app.plans p ON p.id = a.plan
      WHERE a.id = $1`,
    [accountId]
  );
  const r = rows[0];
  if (!r) return { base: null, balance: 0, used: 0, limit: null, over: false, remaining: null, planActive: false, periodStart: null };
  const base = r.base == null ? null : Number(r.base);
  const balance = Number(r.balance || 0);
  const used = Number(r.used || 0);
  const planActive = isPlanActive({ is_active: r.is_active, plan_expires_at: r.plan_expires_at });
  const limit = base == null ? null : base + balance;
  return {
    base, balance, used,
    limit,
    remaining: limit == null ? null : Math.max(0, limit - used),
    over: limit != null && used >= limit,
    planActive,
    periodStart: r.period_start,
  };
}

// Record N emails sent (drives the monthly counter) then draw email overflow
// from email_credits buckets. companyId scopes the usage_events row.
export async function recordEmailsSent(pool, { accountId, companyId, userId = null, count, metadata = {} }) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return 0;
  try {
    await pool.query(
      `INSERT INTO app.usage_events (company_id, user_id, event_type, quantity, metadata)
       VALUES ($1, $2, 'email_sent', $3, $4)`,
      [companyId, userId, n, JSON.stringify(metadata)]
    );
    const q = await getEmailQuota(pool, accountId);
    return await reconcileDrawdown(pool, { accountId, kind: "email_credits", periodStart: q.periodStart, used: q.used, base: q.base });
  } catch (e) {
    console.error("recordEmailsSent failed:", e.message);
    return 0;
  }
}
