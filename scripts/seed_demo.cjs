#!/usr/bin/env node
/* ============================================================================
 *  seed_demo.cjs - provision the shared, read-only DEMO workspace.
 * ----------------------------------------------------------------------------
 *  Creates ONE platform-owned "system" account + ONE workspace flagged
 *  app.companies.is_demo = true, then fills every page/tab with realistic
 *  retail / e-commerce mock data by reusing seedCompany() from seed_all.cjs
 *  (Shopify orders/products, GA landing cubes, UTM, profiles + identity map,
 *  anonymous visitors, segments, EDM, popups + interaction mirror, attributes,
 *  pinned charts, saved reports, skills, a sample conversation, audit log),
 *  PLUS the product-prediction caches (replenishment + recommendations) the
 *  Profiles cards and Segments product pickers read.
 *
 *  The demo workspace is injected into every user's switcher by /auth/me, is
 *  read-only except the AI analyst chat (enforced in server/middleware/auth.js),
 *  and is only ever created / reseeded / deleted here - directly on the CLI or
 *  via the Studio admin endpoints (POST/DELETE /api/admin/demo-workspace), which
 *  spawn this script.
 *
 *  Usage:
 *    POSTGRESQL_CONN=... node scripts/seed_demo.cjs            # provision (no-op if it already exists)
 *    POSTGRESQL_CONN=... node scripts/seed_demo.cjs --reseed   # wipe demo data + re-seed (keeps the fixed id)
 *    POSTGRESQL_CONN=... node scripts/seed_demo.cjs --delete   # remove the demo workspace + system account
 *
 *  Assumes the schema (server/sql/*, incl. the is_demo migration) is applied.
 * ========================================================================== */

const bcrypt = require("bcryptjs");
const { seedCompany, q, pool } = require("./seed_all.cjs");
const {
  DEMO_COMPANY_ID, DEMO_COMPANY_SLUG, DEMO_CAPSUITE_REF, DEMO_ACCOUNT_SLUG,
} = require("./_demo_constants.cjs");

const DEMO_ACCOUNT_NAME = "CapSuite Demo";
const DEMO_COMPANY_NAME = "CapSuite Demo Store";
const DEMO_WEBSITE      = "https://demo.capsuite.co";
const SYSTEM_USER_EMAIL = "demo-system@capsuite.co"; // owns created_by rows; not a usable login

const pick = (arr, i) => arr[i % arr.length];
const rint = (lo, hi, seed) => lo + ((seed * 2654435761) % (hi - lo + 1));

// ── system account + bot user (owner of the demo's created_by rows) ──────────
async function ensureSystemAccountAndUser() {
  let acct = (await q("SELECT id FROM app.accounts WHERE slug = $1", [DEMO_ACCOUNT_SLUG])).rows[0]?.id;
  if (!acct) {
    acct = (await q(
      `INSERT INTO app.accounts (name, slug, plan, plan_expires_at, is_active, settings)
       VALUES ($1,$2,'enterprise', NULL, true, '{"onboarded":true,"is_demo":true}')
       RETURNING id`,
      [DEMO_ACCOUNT_NAME, DEMO_ACCOUNT_SLUG]
    )).rows[0].id;
  }
  let owner = (await q("SELECT id FROM app.users WHERE LOWER(email) = LOWER($1)", [SYSTEM_USER_EMAIL])).rows[0]?.id;
  if (!owner) {
    // Random unusable password: this identity exists only to own created_by FKs.
    const pwHash = await bcrypt.hash(`demo-${Date.now()}-${Math.random()}`, 10);
    owner = (await q(
      `INSERT INTO app.users (account_id, email, password_hash, full_name, is_email_verified, is_active)
       VALUES ($1,$2,$3,'CapSuite Demo', true, true) RETURNING id`,
      [acct, SYSTEM_USER_EMAIL, pwHash]
    )).rows[0].id;
    await q("UPDATE app.accounts SET owner_user_id = $1 WHERE id = $2", [owner, acct]);
  }
  return { acct, owner };
}

// ── product-prediction caches (Profiles cards + Segments product pickers) ────
// seedCompany does not populate these; add a realistic slice so the Profiles
// "Replenishment"/"Recommendations" blocks and the Segments "due to reorder" /
// "push product" pickers have data.
async function seedPredictions(cid, ref) {
  const customers = (await q(
    `SELECT customer_id FROM commerce.customer WHERE company_id = $1 ORDER BY customer_id LIMIT 8`, [cid]
  )).rows.map((r) => r.customer_id);
  const products = (await q(
    `SELECT product_id, product_name, category FROM commerce.product WHERE company_id = $1 ORDER BY product_id`, [cid]
  )).rows;
  if (!customers.length || !products.length) return;

  const statuses = ["due", "due_soon", "upcoming", "overdue"];
  const confid   = ["high", "high", "medium", "low"];
  const methods  = ["item_item", "category_fallback", "item_item"];

  for (let i = 0; i < customers.length; i++) {
    const cust = customers[i];
    // Replenishment: 1-2 predicted reorders per customer.
    const nrep = 1 + (i % 2);
    for (let r = 0; r < nrep; r++) {
      const p = pick(products, i + r);
      const days = rint(-5, 40, i + r + 1) - 5; // some overdue (negative)
      const status = days < 0 ? "overdue" : days <= 7 ? "due" : days <= 21 ? "due_soon" : "upcoming";
      await q(
        `INSERT INTO commerce.customer_replenishment
           (company_id, customer_id, product_id, product_name, product_type, last_order_date,
            cycle_days, cycle_spread, predicted_next_date, days_until, status, confidence, purchase_count, is_cohort_estimate)
         VALUES ($1,$2,$3,$4,'product', NOW() - make_interval(days => $5),
                 $6,$7, (CURRENT_DATE + make_interval(days => $8))::date, $8, $9, $10, $11, false)
         ON CONFLICT (company_id, customer_id, product_id) DO NOTHING`,
        [cid, cust, p.product_id, p.product_name, rint(30, 120, i + r + 2),
          rint(20, 90, i + r + 3), rint(3, 14, i + r + 4), days, status, pick(confid, i + r), rint(2, 8, i + r + 5)]
      );
    }
    // Recommendations: 2-3 cross-sell products per customer.
    const nreco = 2 + (i % 2);
    for (let r = 0; r < nreco; r++) {
      const p = pick(products, i + r + 3);
      await q(
        `INSERT INTO commerce.customer_product_reco
           (company_id, customer_id, product_id, product_name, product_type, score, method, reason, rank)
         VALUES ($1,$2,$3,$4,'product',$5,$6,$7,$8)
         ON CONFLICT (company_id, customer_id, product_id) DO NOTHING`,
        [cid, cust, p.product_id, p.product_name, (0.95 - r * 0.15).toFixed(2),
          pick(methods, i + r), `Frequently bought with ${p.category || "similar items"}`, r + 1]
      );
    }
  }

  // Roll the detail up into the app.customer_profiles caches the Segments
  // predicate builder + rule engine read (mirrors what the predictions DAG does).
  await q(
    `UPDATE app.customer_profiles cp SET
        replenishment_due_count = s.due_count,
        next_replenishment_date = s.next_date,
        days_to_replenishment   = s.min_days,
        replenishment_status    = s.status
     FROM (
       SELECT customer_id,
              COUNT(*) FILTER (WHERE status IN ('due','overdue')) AS due_count,
              MIN(predicted_next_date) AS next_date,
              MIN(days_until) AS min_days,
              (ARRAY_AGG(status ORDER BY days_until ASC))[1] AS status
       FROM commerce.customer_replenishment WHERE company_id = $1 GROUP BY customer_id
     ) s
     WHERE cp.company_id = $1 AND cp.member_id = s.customer_id`,
    [cid]
  );
  await q(
    `UPDATE app.customer_profiles cp SET
        reco_count = s.n,
        top_recommended_product_id = s.pid,
        top_recommended_product    = s.pname,
        top_recommended_category   = s.ptype
     FROM (
       SELECT DISTINCT ON (customer_id) customer_id,
              COUNT(*) OVER (PARTITION BY customer_id) AS n,
              product_id AS pid, product_name AS pname, product_type AS ptype
       FROM commerce.customer_product_reco WHERE company_id = $1
       ORDER BY customer_id, rank ASC
     ) s
     WHERE cp.company_id = $1 AND cp.member_id = s.customer_id`,
    [cid]
  );
}

// ── create the demo company row (fixed id) under the system account ──────────
async function createDemoCompany(acct) {
  const row = (await q(
    `INSERT INTO app.companies
       (id, account_id, name, slug, capsuite_ref, industry, website, plan, is_active, is_demo,
        interaction_service_company_id, interaction_service_synced_at, settings)
     VALUES ($1,$2,$3,$4,$5,'Retail',$6,(SELECT plan FROM app.accounts WHERE id=$2), true, true,
             gen_random_uuid(), NOW(), '{"is_demo":true}')
     RETURNING id, website, interaction_service_company_id`,
    [DEMO_COMPANY_ID, acct, DEMO_COMPANY_NAME, DEMO_COMPANY_SLUG, DEMO_CAPSUITE_REF, DEMO_WEBSITE]
  )).rows[0];
  return row;
}

// ── delete the demo workspace (cascades all company_id-scoped data) ──────────
async function deleteDemoCompany() {
  // Cascade wipes every company_id-scoped row across all schemas, and
  // interaction.companies via cdp_company_id ON DELETE CASCADE.
  await q("DELETE FROM app.companies WHERE is_demo = true");
  // Sync watermarks are keyed by capsuite_ref (no FK) - clean up so a reseed
  // starts fresh.
  await Promise.allSettled([
    q("DELETE FROM ga_landing.ga_sync_control WHERE capsuite_ref = $1", [DEMO_CAPSUITE_REF]),
    q("DELETE FROM shopify.shopify_sync_control WHERE capsuite_ref = $1", [DEMO_CAPSUITE_REF]),
  ]);
}

async function provision({ reseed = false } = {}) {
  const existing = (await q("SELECT id FROM app.companies WHERE is_demo = true")).rows[0];
  if (existing && !reseed) {
    console.log("Demo workspace already exists - nothing to do. (Use --reseed to refresh its data.)");
    return { id: existing.id, created: false };
  }
  if (existing && reseed) {
    console.log("Reseeding: removing existing demo workspace data ...");
    await deleteDemoCompany();
  }

  const { acct, owner } = await ensureSystemAccountAndUser();
  const co = await createDemoCompany(acct);
  const shape = {
    id: co.id,
    website: co.website,
    interaction_service_company_id: co.interaction_service_company_id,
    ref: DEMO_CAPSUITE_REF,
    name: DEMO_COMPANY_NAME,
    commerce: "shopify",
  };
  await seedCompany(shape, { owner, admin: owner });
  await seedPredictions(co.id, DEMO_CAPSUITE_REF);

  // Give the analyst a demo-aware system-prompt note (per-workspace context the
  // analyst prepends). Read-only; platform-managed.
  await q(
    `UPDATE app.settings SET value = $2
       WHERE company_id = $1 AND key = 'analyst_system_prompt'`,
    [co.id,
      `You are the CapSuite AI analyst for a DEMONSTRATION retail workspace. All data here is realistic but synthetic sample data, provided so people can explore what the platform can do. Answer questions using only this workspace's data, and feel free to mention that this is a demo dataset when relevant.`]
  );

  console.log(`✓ Demo workspace provisioned: ${co.id}`);
  return { id: co.id, created: true };
}

async function main() {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--delete")) {
      await deleteDemoCompany();
      // Remove the system account too (cascades the bot user). Its sole purpose
      // was to own the demo.
      await q("DELETE FROM app.accounts WHERE slug = $1", [DEMO_ACCOUNT_SLUG]);
      console.log("✓ Demo workspace + system account deleted.");
    } else {
      await provision({ reseed: args.includes("--reseed") });
    }
  } finally {
    // seed_all.cjs owns the shared pool; end it so the CLI process exits.
    await pool.end();
  }
}

module.exports = { provision, deleteDemoCompany };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
