import { Router } from "express";
import crypto from "crypto";
import { authenticate, requirePlatformAdmin, createToken, setAuthCookie } from "../middleware/auth.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/email.js";
import { clearPricingCache } from "../lib/aiUsage.js";
import { blockEmails } from "../lib/blockedEmails.js";

// ============================================================================
//  Platform-owner ("Studio") API. Everything here is PLATFORM-scoped, not
//  company-scoped: a platform owner sees and manages every account/client.
//  All routes require authenticate + requirePlatformAdmin. Never send an
//  x-company-id header to these endpoints.
// ============================================================================
export function createAdminRouter(pool) {
  const router = Router();

  // Lock the whole router down to platform owners.
  router.use(authenticate, requirePlatformAdmin(pool));

  // Direct audit insert (account-level changes have no single company context, so
  // we can't use app.log_audit which derives the account from a company).
  async function audit(accountId, userId, action, resourceType, resourceId, changes = {}) {
    try {
      await pool.query(
        `INSERT INTO app.audit_log (account_id, user_id, action, resource_type, resource_id, changes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [accountId, userId, action, resourceType, resourceId, JSON.stringify(changes)]
      );
    } catch { /* non-fatal */ }
  }

  // ── GET /api/admin/stats ──────────────────────────────────────────────────
  router.get("/stats", async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM app.accounts)                                   AS total_accounts,
          (SELECT COUNT(*) FROM app.accounts WHERE plan = 'paid')               AS paid_accounts,
          (SELECT COUNT(*) FROM app.accounts WHERE plan = 'free')               AS free_accounts,
          (SELECT COUNT(*) FROM app.accounts WHERE is_active = false)           AS suspended_accounts,
          (SELECT COUNT(*) FROM app.users)                                      AS total_users,
          (SELECT COUNT(*) FROM app.companies)                                  AS total_workspaces,
          (SELECT COUNT(*) FROM app.accounts WHERE created_date > NOW() - INTERVAL '30 days') AS signups_30d,
          (SELECT COUNT(*) FROM app.accounts
             WHERE plan = 'free' AND plan_expires_at IS NOT NULL AND plan_expires_at >  NOW()) AS active_trials,
          (SELECT COUNT(*) FROM app.accounts
             WHERE plan = 'free' AND plan_expires_at IS NOT NULL AND plan_expires_at <= NOW()) AS expired_trials,
          (SELECT COUNT(*) FROM app.accounts
             WHERE plan = 'free' AND plan_expires_at IS NOT NULL
               AND plan_expires_at > NOW() AND plan_expires_at <= NOW() + INTERVAL '7 days') AS expiring_7d,
          (SELECT COUNT(*) FROM app.support_tickets WHERE status IN ('open', 'in_progress')) AS open_tickets,
          (SELECT COALESCE(SUM(total_tokens), 0) FROM app.ai_usage)                          AS total_ai_tokens,
          (SELECT COALESCE(SUM(cost), 0)         FROM app.ai_usage)                          AS total_ai_cost
      `);
      const r = rows[0];
      // pg returns COUNT() as text; coerce to numbers for the UI.
      const stats = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, parseInt(v, 10)]));
      // Cost is a decimal - keep its fractional part (the parseInt map truncated it).
      stats.total_ai_cost = Math.round((parseFloat(r.total_ai_cost) || 0) * 1e6) / 1e6;

      // Daily signups for the last 30 days (zero-filled) for the Overview trend.
      const { rows: daily } = await pool.query(`
        SELECT to_char(d::date, 'YYYY-MM-DD') AS d, COALESCE(c.n, 0)::int AS n
          FROM generate_series(NOW()::date - INTERVAL '29 days', NOW()::date, INTERVAL '1 day') d
          LEFT JOIN (
            SELECT created_date::date AS dd, COUNT(*) AS n FROM app.accounts GROUP BY 1
          ) c ON c.dd = d::date
         ORDER BY d
      `);
      stats.signups_daily = daily;

      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/accounts ───────────────────────────────────────────────
  // Overview row per client account. ?search= matches name/slug/owner email.
  // ?sort= one of created_date|name|plan|last_activity (default created_date desc).
  router.get("/accounts", async (req, res) => {
    const search = (req.query.search || "").trim();
    const SORTS = {
      created_date:  "a.created_date DESC",
      name:          "a.name ASC",
      plan:          "a.plan DESC, a.created_date DESC",
      last_activity: "last_activity DESC NULLS LAST",
    };
    const orderBy = SORTS[req.query.sort] || SORTS.created_date;
    try {
      const { rows } = await pool.query(`
        SELECT a.id, a.name, a.slug, a.plan, a.plan_expires_at, a.plan_upgraded_at,
               a.is_active, a.created_date,
               ow.email AS owner_email, ow.full_name AS owner_name,
               (SELECT COUNT(*) FROM app.users u     WHERE u.account_id = a.id) AS user_count,
               (SELECT COUNT(*) FROM app.companies c WHERE c.account_id = a.id) AS workspace_count,
               (SELECT COALESCE(SUM(au.total_tokens), 0) FROM app.ai_usage au WHERE au.account_id = a.id) AS ai_tokens,
               (SELECT COALESCE(SUM(au.cost), 0)         FROM app.ai_usage au WHERE au.account_id = a.id) AS ai_cost,
               GREATEST(
                 (SELECT MAX(u.last_login_at) FROM app.users u      WHERE u.account_id = a.id),
                 (SELECT MAX(al.occurred_at)  FROM app.audit_log al WHERE al.account_id = a.id)
               ) AS last_activity
          FROM app.accounts a
          LEFT JOIN app.users ow ON ow.id = a.owner_user_id
         WHERE ($1 = ''
                OR a.name  ILIKE '%' || $1 || '%'
                OR a.slug  ILIKE '%' || $1 || '%'
                OR ow.email ILIKE '%' || $1 || '%')
         ORDER BY ${orderBy}
      `, [search]);
      res.json(rows.map((r) => ({
        ...r,
        user_count: parseInt(r.user_count, 10),
        workspace_count: parseInt(r.workspace_count, 10),
        ai_tokens: parseInt(r.ai_tokens, 10) || 0,
        ai_cost: Math.round((parseFloat(r.ai_cost) || 0) * 1e6) / 1e6,
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/accounts/:id ───────────────────────────────────────────
  router.get("/accounts/:id", async (req, res) => {
    try {
      const { rows: acct } = await pool.query(`
        SELECT a.*, ow.email AS owner_email, ow.full_name AS owner_name
          FROM app.accounts a
          LEFT JOIN app.users ow ON ow.id = a.owner_user_id
         WHERE a.id = $1
      `, [req.params.id]);
      if (!acct.length) return res.status(404).json({ error: "Account not found" });

      const [users, workspaces, aiTotals, aiByUser, aiByFeature] = await Promise.all([
        pool.query(`
          SELECT id, email, full_name, last_login_at, is_email_verified,
                 is_platform_admin, is_active, created_date
            FROM app.users WHERE account_id = $1 ORDER BY created_date
        `, [req.params.id]),
        pool.query(`
          SELECT c.id, c.name, c.slug, c.created_date, c.is_active,
                 (SELECT COUNT(*) FROM app.company_members cm
                    WHERE cm.company_id = c.id AND cm.status = 'active') AS member_count,
                 (SELECT COUNT(*) FROM app.customer_profiles cp WHERE cp.company_id = c.id) AS profiles,
                 (SELECT COUNT(*) FROM app.edm_campaigns ec     WHERE ec.company_id = c.id) AS campaigns,
                 (SELECT COALESCE(SUM(ue.quantity), 0) FROM app.usage_events ue
                    WHERE ue.company_id = c.id AND ue.event_type = 'ai_token') AS ai_tokens,
                 (SELECT COALESCE(SUM(au.cost), 0) FROM app.ai_usage au
                    WHERE au.company_id = c.id) AS ai_cost
            FROM app.companies c WHERE c.account_id = $1 ORDER BY c.created_date
        `, [req.params.id]),
        // Account-wide AI spend (the per-account cost rollup).
        pool.query(`
          SELECT COALESCE(SUM(input_tokens), 0)  AS input_tokens,
                 COALESCE(SUM(output_tokens), 0) AS output_tokens,
                 COALESCE(SUM(total_tokens), 0)  AS total_tokens,
                 COALESCE(SUM(cost), 0)          AS total_cost,
                 COALESCE(MAX(currency), 'USD')  AS currency
            FROM app.ai_usage WHERE account_id = $1
        `, [req.params.id]),
        // Per-user breakdown (a user can span several of the account's workspaces).
        pool.query(`
          SELECT au.user_id, u.email, u.full_name,
                 COALESCE(SUM(au.total_tokens), 0) AS tokens,
                 COALESCE(SUM(au.cost), 0)         AS cost
            FROM app.ai_usage au
            LEFT JOIN app.users u ON u.id = au.user_id
           WHERE au.account_id = $1
           GROUP BY au.user_id, u.email, u.full_name
           ORDER BY cost DESC
        `, [req.params.id]),
        // Per-feature breakdown (analyst / chart_summary / attribute_* / ...).
        pool.query(`
          SELECT feature,
                 COALESCE(SUM(total_tokens), 0) AS tokens,
                 COALESCE(SUM(cost), 0)         AS cost
            FROM app.ai_usage WHERE account_id = $1
           GROUP BY feature ORDER BY cost DESC
        `, [req.params.id]),
      ]);

      const money = (v) => Math.round((parseFloat(v) || 0) * 1e6) / 1e6;
      const t = aiTotals.rows[0] || {};

      res.json({
        account: acct[0],
        users: users.rows,
        workspaces: workspaces.rows.map((w) => ({
          ...w,
          member_count: parseInt(w.member_count, 10),
          profiles: parseInt(w.profiles, 10),
          campaigns: parseInt(w.campaigns, 10),
          ai_tokens: parseInt(w.ai_tokens, 10),
          ai_cost: money(w.ai_cost),
        })),
        ai_usage: {
          input_tokens: parseInt(t.input_tokens, 10) || 0,
          output_tokens: parseInt(t.output_tokens, 10) || 0,
          total_tokens: parseInt(t.total_tokens, 10) || 0,
          total_cost: money(t.total_cost),
          currency: t.currency || "USD",
          by_user: aiByUser.rows.map((r) => ({
            user_id: r.user_id, email: r.email, full_name: r.full_name,
            tokens: parseInt(r.tokens, 10) || 0, cost: money(r.cost),
          })),
          by_feature: aiByFeature.rows.map((r) => ({
            feature: r.feature, tokens: parseInt(r.tokens, 10) || 0, cost: money(r.cost),
          })),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/admin/accounts/:id ─────────────────────────────────────────
  // Change plan (free|paid), set/extend trial expiry, suspend/reactivate, plus
  // per-account limit overrides + billing notes (stored in settings JSONB).
  // The app.stamp_plan_upgraded_at trigger stamps plan_upgraded_at + clears
  // plan_expires_at on upgrade to paid automatically.
  router.patch("/accounts/:id", async (req, res) => {
    const { plan, plan_expires_at, is_active, limit_overrides, billing_notes, payment_reference } = req.body;
    const sets = [];
    const vals = [];

    if (plan !== undefined) {
      if (!["free", "paid"].includes(plan)) {
        return res.status(400).json({ error: "plan must be 'free' or 'paid'" });
      }
      sets.push(`plan = $${sets.length + 1}`); vals.push(plan);
    }
    if (plan_expires_at !== undefined) {
      sets.push(`plan_expires_at = $${sets.length + 1}`); vals.push(plan_expires_at || null);
    }
    if (is_active !== undefined) {
      sets.push(`is_active = $${sets.length + 1}`); vals.push(!!is_active);
    }

    // Settings-backed fields are merged into the existing settings JSONB so we
    // never clobber unrelated keys.
    const settingsPatch = {};
    if (limit_overrides !== undefined) {
      // Drop blank/zero-less entries so an emptied field falls back to the plan.
      const clean = {};
      for (const [k, v] of Object.entries(limit_overrides || {})) {
        if (v !== "" && v != null) clean[k] = parseInt(v, 10);
      }
      settingsPatch.limit_overrides = clean;
    }
    if (billing_notes !== undefined) settingsPatch.billing_notes = billing_notes;
    if (payment_reference !== undefined) settingsPatch.payment_reference = payment_reference;
    if (Object.keys(settingsPatch).length) {
      sets.push(`settings = COALESCE(settings, '{}'::jsonb) || $${sets.length + 1}::jsonb`);
      vals.push(JSON.stringify(settingsPatch));
    }

    if (!sets.length) return res.status(400).json({ error: "No fields to update" });

    vals.push(req.params.id);
    try {
      const { rows } = await pool.query(
        `UPDATE app.accounts SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      if (!rows.length) return res.status(404).json({ error: "Account not found" });
      await audit(req.params.id, req.user.id, "update", "account", req.params.id,
        { plan, plan_expires_at, is_active, ...settingsPatch });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/admin/accounts/:id ────────────────────────────────────────
  // Hard-delete an account and ALL its data (cascades to users, workspaces,
  // source data, members, integrations...). Irreversible. Guards: can't delete
  // your own account. Audit is written WITHOUT account_id (it would cascade away)
  // with the deleted account's identity in metadata.
  router.delete("/accounts/:id", async (req, res) => {
    try {
      const { rows: own } = await pool.query(
        "SELECT account_id FROM app.users WHERE id = $1", [req.user.id]
      );
      if (own[0]?.account_id === req.params.id) {
        return res.status(400).json({ error: "You can't delete your own account" });
      }
      // Block every email in the account before the cascade removes the users, so
      // a deleted account can never be re-created (incl. via OAuth re-provision).
      const { rows: emailRows } = await pool.query(
        "SELECT email FROM app.users WHERE account_id = $1", [req.params.id]
      );
      const { rows } = await pool.query(
        "DELETE FROM app.accounts WHERE id = $1 RETURNING id, name, slug", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Account not found" });
      await blockEmails(pool, emailRows.map((r) => r.email), { accountId: rows[0].id });
      await audit(null, req.user.id, "delete", "account", rows[0].id,
        { name: rows[0].name, slug: rows[0].slug });
      res.json({ ok: true, deleted: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/users ──────────────────────────────────────────────────
  // All users across all accounts, owners first. ?search= matches email/name.
  router.get("/users", async (req, res) => {
    const search = (req.query.search || "").trim();
    try {
      const { rows } = await pool.query(`
        SELECT u.id, u.email, u.full_name, u.is_platform_admin, u.is_active,
               u.is_email_verified, u.last_login_at, u.created_date,
               a.id AS account_id, a.name AS account_name,
               la.action AS last_action, la.occurred_at AS last_action_at
          FROM app.users u
          LEFT JOIN app.accounts a ON a.id = u.account_id
          LEFT JOIN LATERAL (
            SELECT action, occurred_at FROM app.audit_log
             WHERE user_id = u.id ORDER BY occurred_at DESC LIMIT 1
          ) la ON true
         WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.full_name ILIKE '%' || $1 || '%')
         ORDER BY u.is_platform_admin DESC, u.created_date DESC
      `, [search]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/admin/users/:id ────────────────────────────────────────────
  // Promote/demote a platform owner. Guards: you can't demote yourself, and the
  // last remaining owner can't be demoted (never lock everyone out).
  router.patch("/users/:id", async (req, res) => {
    const { is_platform_admin } = req.body;
    if (typeof is_platform_admin !== "boolean") {
      return res.status(400).json({ error: "is_platform_admin (boolean) is required" });
    }

    if (!is_platform_admin) {
      if (req.params.id === req.user.id) {
        return res.status(400).json({ error: "You can't remove your own platform-owner access" });
      }
      const { rows: cnt } = await pool.query(
        "SELECT COUNT(*)::int AS n FROM app.users WHERE is_platform_admin = true"
      );
      if (cnt[0].n <= 1) {
        return res.status(400).json({ error: "Can't demote the last platform owner" });
      }
    }

    try {
      const { rows } = await pool.query(
        `UPDATE app.users SET is_platform_admin = $1 WHERE id = $2
         RETURNING id, email, full_name, is_platform_admin, account_id`,
        [is_platform_admin, req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "User not found" });
      await audit(rows[0].account_id, req.user.id, "role_change", "user", req.params.id,
        { is_platform_admin });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/plans ──────────────────────────────────────────────────
  // Full catalog incl. inactive (the owner manages active state here).
  router.get("/plans", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM app.plans ORDER BY sort_order");
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/admin/plans/:id ────────────────────────────────────────────
  // Edit plan offering: limits, trial length, features, etc. Changes apply live
  // to every account on that plan (planLimit reads the catalog at request time).
  router.patch("/plans/:id", async (req, res) => {
    const allowed = ["name","price_display","period","badge","description","cta_label","cta_href","cta_external","is_highlighted","sort_order","trial_days","warning_days","features","limits","is_active"];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (key in req.body) {
        sets.push(`${key} = $${sets.length + 1}`);
        const v = req.body[key];
        vals.push((key === "features" || key === "limits") ? JSON.stringify(v) : v);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "No fields to update" });
    vals.push(req.params.id);
    try {
      const { rows } = await pool.query(
        `UPDATE app.plans SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      if (!rows.length) return res.status(404).json({ error: "Plan not found" });
      await audit(null, req.user.id, "update", "plan", req.params.id, req.body);
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/ai-pricing ─────────────────────────────────────────────
  // Editable $/1M-token rates per model, used to cost AI usage at insert time.
  router.get("/ai-pricing", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM app.ai_model_pricing ORDER BY model");
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/admin/ai-pricing/:model ────────────────────────────────────
  // Update (or create) a model's rates. New rates apply to FUTURE usage only -
  // already-recorded costs are frozen on their ledger rows.
  router.patch("/ai-pricing/:model", async (req, res) => {
    const { input_per_1m, output_per_1m, currency } = req.body;
    const num = (v) => (v === "" || v == null ? null : Number(v));
    const inP = num(input_per_1m), outP = num(output_per_1m);
    if ((inP != null && (isNaN(inP) || inP < 0)) || (outP != null && (isNaN(outP) || outP < 0))) {
      return res.status(400).json({ error: "Rates must be non-negative numbers" });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.ai_model_pricing (model, input_per_1m, output_per_1m, currency, updated_date)
         VALUES ($1, COALESCE($2, 0), COALESCE($3, 0), COALESCE($4, 'USD'), NOW())
         ON CONFLICT (model) DO UPDATE SET
           input_per_1m  = COALESCE($2, app.ai_model_pricing.input_per_1m),
           output_per_1m = COALESCE($3, app.ai_model_pricing.output_per_1m),
           currency      = COALESCE($4, app.ai_model_pricing.currency),
           updated_date  = NOW()
         RETURNING *`,
        [req.params.model, inP, outP, currency || null]
      );
      clearPricingCache();
      await audit(null, req.user.id, "update", "ai_pricing", req.params.model, { input_per_1m: inP, output_per_1m: outP, currency });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/users/:id/send-verification ───────────────────────────
  // Re-issue an email-verification link to a client's user.
  router.post("/users/:id/send-verification", async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT email, is_email_verified FROM app.users WHERE id = $1", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "User not found" });
      if (rows[0].is_email_verified) return res.json({ ok: true, already_verified: true });
      const token = crypto.randomBytes(32).toString("hex");
      await pool.query(
        `UPDATE app.users SET email_verify_token = $1, email_verify_expires = NOW() + INTERVAL '24 hours' WHERE id = $2`,
        [token, req.params.id]
      );
      let sent = false, error = null;
      try { const r = await sendVerificationEmail(rows[0].email, token); sent = !r?.simulated; }
      catch (e) { error = e.message; }
      await audit(null, req.user.id, "send", "user", req.params.id, { kind: "verification" });
      res.json({ ok: true, sent, error });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/users/:id/send-reset ──────────────────────────────────
  // Send a password-reset link to a client's user.
  router.post("/users/:id/send-reset", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT email FROM app.users WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "User not found" });
      const token = crypto.randomBytes(32).toString("hex");
      const token_hash = crypto.createHash("sha256").update(token).digest("hex");
      await pool.query(
        `INSERT INTO app.password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [req.params.id, token_hash]
      );
      let sent = false, error = null;
      try { await sendPasswordResetEmail(rows[0].email, token); sent = true; }
      catch (e) { error = e.message; }
      await audit(null, req.user.id, "send", "user", req.params.id, { kind: "password_reset" });
      res.json({ ok: true, sent, error });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/users/:id/impersonate ─────────────────────────────────
  // Swap the CURRENT session to act as the target user (for debugging what a
  // client sees). Mints a 1-hour token tagged with the impersonator, replacing
  // the owner's cookie. Exit by logging out. Audited. Can't impersonate yourself.
  router.post("/users/:id/impersonate", async (req, res) => {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You're already yourself" });
    }
    try {
      const { rows } = await pool.query(
        "SELECT id, email FROM app.users WHERE id = $1 AND is_active = true", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "User not found or inactive" });
      const target = rows[0];
      const token = createToken({
        id: target.id,
        email: target.email,
        impersonated_by: req.user.email,
        impersonator_id: req.user.id,
        imp: true,
      });
      setAuthCookie(res, token);
      await audit(null, req.user.id, "impersonate", "user", target.id, { email: target.email });
      res.json({ ok: true, user: target });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Owner invites (grant owner access to an email that may not exist yet) ──
  router.post("/owners/invite", async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) {
      return res.status(400).json({ error: "A valid email is required" });
    }
    try {
      const { rows: existing } = await pool.query(
        "SELECT id, is_platform_admin FROM app.users WHERE LOWER(email) = $1", [email]
      );
      if (existing.length) {
        if (existing[0].is_platform_admin) return res.json({ ok: true, status: "already_owner" });
        await pool.query("UPDATE app.users SET is_platform_admin = true WHERE id = $1", [existing[0].id]);
        await audit(null, req.user.id, "role_change", "user", existing[0].id, { is_platform_admin: true });
        return res.json({ ok: true, status: "promoted" });
      }
      // No account yet - record a pending invite consumed on signup.
      await pool.query(
        `INSERT INTO app.platform_owner_invites (email, invited_by) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET invited_by = EXCLUDED.invited_by, created_at = NOW()`,
        [email, req.user.id]
      );
      await audit(null, req.user.id, "invite", "owner", email, { email });
      res.json({ ok: true, status: "invited" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/owner-invites", async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT i.email, i.created_at, u.email AS invited_by_email
          FROM app.platform_owner_invites i
          LEFT JOIN app.users u ON u.id = i.invited_by
         ORDER BY i.created_at DESC
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete("/owner-invites/:email", async (req, res) => {
    try {
      await pool.query("DELETE FROM app.platform_owner_invites WHERE email = LOWER($1)", [req.params.email]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Blocked emails ────────────────────────────────────────────────────────
  // Emails locked out of sign-up/sign-in (auto-added when an account is deleted).
  // Platform owners can block/unblock directly from Studio.
  router.get("/blocked-emails", async (_req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT email, reason, account_id, blocked_at FROM app.blocked_emails ORDER BY blocked_at DESC"
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/blocked-emails", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email is required" });
    }
    try {
      const [blocked] = await blockEmails(pool, [email], { reason: "admin_blocked" });
      await audit(null, req.user.id, "block", "email", blocked, { email: blocked });
      res.status(201).json({ ok: true, email: blocked });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete("/blocked-emails/:email", async (req, res) => {
    const email = String(req.params.email).trim().toLowerCase();
    try {
      const { rowCount } = await pool.query(
        "DELETE FROM app.blocked_emails WHERE email = $1", [email]
      );
      if (!rowCount) return res.status(404).json({ error: "Email is not blocked" });
      await audit(null, req.user.id, "unblock", "email", email, { email });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/tickets ────────────────────────────────────────────────
  // All support tickets across every client. ?status= ?type= filters.
  router.get("/tickets", async (req, res) => {
    const status = (req.query.status || "").trim();
    const type = (req.query.type || "").trim();
    try {
      const { rows } = await pool.query(`
        SELECT t.id, t.type, t.subject, t.body, t.status, t.priority,
               t.created_date, t.updated_date, t.resolved_at,
               u.email AS user_email, u.full_name AS user_name,
               a.id AS account_id, a.name AS account_name,
               c.name AS company_name
          FROM app.support_tickets t
          LEFT JOIN app.users u     ON u.id = t.user_id
          LEFT JOIN app.accounts a  ON a.id = COALESCE(t.account_id, u.account_id)
          LEFT JOIN app.companies c ON c.id = t.company_id
         WHERE ($1 = '' OR t.status = $1)
           AND ($2 = '' OR t.type = $2)
         ORDER BY
           CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
           t.created_date DESC
         LIMIT 200
      `, [status, type]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/admin/tickets/:id ──────────────────────────────────────────
  // Update a ticket's status and/or priority. Stamps resolved_at on resolve/close.
  router.patch("/tickets/:id", async (req, res) => {
    const { status, priority } = req.body;
    const STATUSES = ["open", "in_progress", "resolved", "closed"];
    const PRIORITIES = ["low", "normal", "high", "urgent"];
    const sets = [];
    const vals = [];

    if (status !== undefined) {
      if (!STATUSES.includes(status)) return res.status(400).json({ error: "invalid status" });
      sets.push(`status = $${sets.length + 1}`); vals.push(status);
      // Stamp / clear resolved_at to match the new status.
      sets.push(`resolved_at = ${["resolved", "closed"].includes(status) ? "NOW()" : "NULL"}`);
    }
    if (priority !== undefined) {
      if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: "invalid priority" });
      sets.push(`priority = $${sets.length + 1}`); vals.push(priority);
    }
    if (!sets.length) return res.status(400).json({ error: "No fields to update" });

    vals.push(req.params.id);
    try {
      const { rows } = await pool.query(
        `UPDATE app.support_tickets SET ${sets.join(", ")} WHERE id = $${vals.length}
         RETURNING id, status, priority, account_id`,
        vals
      );
      if (!rows.length) return res.status(404).json({ error: "Ticket not found" });
      await audit(rows[0].account_id, req.user.id, "update", "support_ticket", req.params.id, { status, priority });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/audit ──────────────────────────────────────────────────
  // Platform-wide audit feed. Filters: ?action= ?account_id= ?limit= (max 200).
  router.get("/audit", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const action = (req.query.action || "").trim();
    const accountId = (req.query.account_id || "").trim();
    try {
      const { rows } = await pool.query(`
        SELECT al.id, al.occurred_at, al.action, al.resource_type, al.resource_id,
               al.changes, al.account_id, al.user_id,
               u.email AS user_email, u.full_name AS user_name,
               a.name AS account_name
          FROM app.audit_log al
          LEFT JOIN app.users u    ON u.id = al.user_id
          LEFT JOIN app.accounts a ON a.id = al.account_id
         WHERE ($1 = '' OR al.action = $1)
           AND ($2 = '' OR al.account_id = $2::uuid)
         ORDER BY al.occurred_at DESC
         LIMIT $3
      `, [action, accountId, limit]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
