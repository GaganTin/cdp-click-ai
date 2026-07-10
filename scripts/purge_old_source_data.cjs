#!/usr/bin/env node
/* ============================================================================
 *  purge_old_source_data.cjs - retention purge for raw source data.
 * ----------------------------------------------------------------------------
 *  Deletes dated EVENT / TRANSACTION / LOG rows older than N months (default 24):
 *    shopify        shopify.order / order_line / refund / refund_line
 *    ga             all GA4 dated cubes + event logs (ga_landing.*)
 *    gsc            ga_landing.keyword_performance
 *    interaction    interaction.activities  (popup/tracker log - highest volume)
 *    popup          app.popup_link_clicks
 *    notifications  app.notifications
 *    jobs           app.integration_sync_jobs (terminal rows only)
 *    manual         manual.sale (-> sale_order_line via CASCADE)
 *    commerce       commerce.order / order_line / refund / refund_line
 *
 *  Master / dimension data is intentionally KEPT (customer, product*,
 *  inventory_level, ga_landing.cohort_*): a customer/product created >24mo ago
 *  can still back a recent order, and deleting it would orphan that order.
 *  Control watermarks (*_sync_control, interaction.sync_state) are never touched.
 *  Sensitive logs (leads/PII, billing, audit, chat) are excluded pending sign-off
 *  - see the "Not purged" note below.
 *
 *  SAFE BY DEFAULT: a dry run (row counts only) unless you pass --apply.
 *
 *  Usage:
 *    POSTGRESQL_CONN=... node scripts/purge_old_source_data.cjs            # dry run
 *    POSTGRESQL_CONN=... node scripts/purge_old_source_data.cjs --apply    # delete
 *    node scripts/purge_old_source_data.cjs --apply --months=36
 *    node scripts/purge_old_source_data.cjs --apply --source=ga,gsc
 *    node scripts/purge_old_source_data.cjs --apply --batch=50000
 *
 *  Flags:
 *    --apply          actually delete (otherwise report counts and exit)
 *    --months=N       retention window in months (default 24)
 *    --source=a,b     restrict to sources (default: all). Valid: shopify, ga, gsc,
 *                     interaction, popup, notifications, jobs, manual, commerce
 *    --batch=N        rows per DELETE batch, keeps locks short (default 20000)
 * ========================================================================== */
const { getPool } = require("./_db.cjs");

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};

const APPLY = has("--apply");
const MONTHS = parseInt(val("months", "24"), 10);
const BATCH = parseInt(val("batch", "20000"), 10);
const ALL_SOURCES = "shopify,ga,gsc,interaction,popup,notifications,jobs,manual,commerce";
const SOURCES = String(val("source", ALL_SOURCES))
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (!Number.isInteger(MONTHS) || MONTHS < 1) {
  console.error(`Invalid --months=${val("months")}. Must be a positive integer.`);
  process.exit(1);
}
if (!Number.isInteger(BATCH) || BATCH < 1) {
  console.error(`Invalid --batch=${val("batch")}. Must be a positive integer.`);
  process.exit(1);
}

// Cut-off expressions ($1 = months). One DB clock (now()) is the single source
// of truth so the boundary is identical across every table in the run.
const YMD_CUT = "to_char((now() - ($1 || ' months')::interval), 'YYYYMMDD')"; // ga_landing.date  (TEXT 'YYYYMMDD')
const YM_CUT = "to_char((now() - ($1 || ' months')::interval), 'YYYY-MM')";   // funnel_report.tracking_period (TEXT 'YYYY-MM')
const TS_CUT = "(now() - ($1 || ' months')::interval)";                       // TIMESTAMPTZ

// WHERE-clause builders per date representation.
const whereYmd = (col) => `${col} IS NOT NULL AND ${col} <> '' AND ${col} < ${YMD_CUT}`;
const whereYm = (col) => `${col} IS NOT NULL AND ${col} <> '' AND ${col} < ${YM_CUT}`;
// Shopify raw dates land as TEXT (ISO 8601 from the DAG). Cast to compare.
const whereTsText = (col) => `${col} IS NOT NULL AND ${col} <> '' AND NULLIF(${col}, '')::timestamptz < ${TS_CUT}`;
// Proper TIMESTAMPTZ columns (interaction / app / manual / commerce) - direct compare.
// NULL is treated as "age unknown" and kept.
const whereTs = (col) => `${col} IS NOT NULL AND ${col} < ${TS_CUT}`;

// ── table catalog (events / transactions only) ───────────────────────────────
// `ident` is the exact FROM target (quoted where the name is reserved).
// order matters only where a child must go before its parent (refund_line -> refund).
const GA_DATED = [
  // event-grain (highest volume)
  "path_exploration",
  "path_exploration_duration",
  "outbound_links_attributes",
  "purchase_list",
  // daily aggregates
  "website_metrics",
  "page_metrics",
  "page_utm_metrics",
  "country_performance",
  "utm_performance",
  "utm_daily_performance",
  "utm_daily_full_param_performance",
  "utm_daily_utm_id_performance",
  "utm_ad_performance",
  "event_list",
  // generated daily cubes
  "page_engagement_daily",
  "session_quality_daily",
  "item_performance",
  "item_attribution",
  "transaction_metrics",
  "acquisition_session_daily",
  "acquisition_firstuser_daily",
  "channel_daily",
  "landing_page_daily",
  "demographics_daily",
  "audience_daily",
  "tech_daily",
  "geo_daily",
  "interest_daily",
  "returning_daily",
];

const TABLES = [
  // ── Shopify events / transactions ──────────────────────────────────────────
  { source: "shopify", ident: 'shopify."order"', label: "shopify.order", where: whereTsText("created_at") },
  { source: "shopify", ident: "shopify.order_line", label: "shopify.order_line", where: whereTsText("created_at") },
  // refund_line has no own date -> filtered via its parent refund; must precede it.
  {
    source: "shopify",
    ident: "shopify.refund_line",
    label: "shopify.refund_line",
    // ctid sub-select joins to the parent refund's refund_date.
    select: `SELECT rl.ctid FROM shopify.refund_line rl
             JOIN shopify.refund r
               ON r.company_id = rl.company_id AND r.refund_id = rl.refund_id
             WHERE ${whereTsText("r.refund_date")}`,
  },
  { source: "shopify", ident: "shopify.refund", label: "shopify.refund", where: whereTsText("refund_date") },

  // ── GA4 dated tables ───────────────────────────────────────────────────────
  ...GA_DATED.map((t) => ({ source: "ga", ident: `ga_landing.${t}`, label: `ga_landing.${t}`, where: whereYmd("date") })),
  { source: "ga", ident: "ga_landing.funnel_report", label: "ga_landing.funnel_report", where: whereYm("tracking_period") },

  // ── GSC ────────────────────────────────────────────────────────────────────
  { source: "gsc", ident: "ga_landing.keyword_performance", label: "ga_landing.keyword_performance", where: whereYmd("date") },

  // ── Interaction service — popup/tracker activity log (highest volume) ───────
  { source: "interaction", ident: "interaction.activities", label: "interaction.activities", where: whereTs("created_at") },

  // ── App event/log tables (append-only) ─────────────────────────────────────
  { source: "popup", ident: "app.popup_link_clicks", label: "app.popup_link_clicks", where: whereTs("clicked_at") },
  { source: "notifications", ident: "app.notifications", label: "app.notifications", where: whereTs("created_date") },
  // job-run history: only age TERMINAL rows, never queued/running.
  {
    source: "jobs",
    ident: "app.integration_sync_jobs",
    label: "app.integration_sync_jobs",
    where: `status IN ('completed','failed','cancelled') AND created_date < ${TS_CUT}`,
  },

  // ── Manual (CSV) transactions ──────────────────────────────────────────────
  // Deleting a sale CASCADEs to manual.sale_order_line via its (company_id, trxn_id) FK,
  // so lines need no separate entry.
  { source: "manual", ident: "manual.sale", label: "manual.sale", where: whereTs("trxn_date") },

  // ── Commerce (derived neutral layer the app reads) ─────────────────────────
  // No FKs between these tables -> each purges on its own date. refund_line has no
  // date column, so it is driven off its parent refund's date and must precede it.
  {
    source: "commerce",
    ident: "commerce.refund_line",
    label: "commerce.refund_line",
    select: `SELECT rl.ctid FROM commerce.refund_line rl
             JOIN commerce.refund r
               ON r.company_id = rl.company_id AND r.refund_id = rl.refund_id
             WHERE ${whereTs("r.refund_date")}`,
  },
  { source: "commerce", ident: "commerce.refund", label: "commerce.refund", where: whereTs("refund_date") },
  { source: "commerce", ident: 'commerce."order"', label: "commerce.order", where: whereTs("order_date") },
  { source: "commerce", ident: "commerce.order_line", label: "commerce.order_line", where: whereTs("order_date") },
];

// Not purged (documented so the omission is intentional, not an oversight):
//   shopify/commerce.customer / .product* / .inventory_level  (masters)
//   ga_landing.cohort_weekly / .cohort_monthly  (no date column)
//   manual.sale_order_line  (removed via manual.sale CASCADE, not a separate pass)
//   *_sync_control, interaction.sync_state  (incremental watermarks)
//   Deliberately EXCLUDED sensitive logs (need business/compliance sign-off first):
//     app.popup_email_collected (leads/PII), app.ai_usage (billing totals),
//     app.audit_log (compliance), app.conversations (user chat history)

// A ctid sub-select for a plain single-table config.
const selectFor = (t) => t.select || `SELECT ctid FROM ${t.ident} WHERE ${t.where}`;

const pool = getPool({ max: 2 });

async function countFor(t) {
  const sql = `SELECT count(*)::bigint AS n FROM (${selectFor(t)}) s`;
  const { rows } = await pool.query(sql, [MONTHS]);
  return Number(rows[0].n);
}

// Batched delete via ctid to keep locks short on the large event tables.
async function purge(t) {
  const del = `DELETE FROM ${t.ident} WHERE ctid IN (${selectFor(t)} LIMIT ${BATCH})`;
  let total = 0;
  for (;;) {
    const res = await pool.query(del, [MONTHS]);
    total += res.rowCount;
    if (res.rowCount < BATCH) break;
  }
  return total;
}

async function main() {
  const selected = TABLES.filter((t) => SOURCES.includes(t.source));
  if (!selected.length) {
    console.error(`No tables match --source=${SOURCES.join(",")} (valid: ${ALL_SOURCES.split(",").join(", ")}).`);
    process.exit(1);
  }

  const { rows: cut } = await pool.query(
    `SELECT (now() - ($1 || ' months')::interval)::date AS d`,
    [MONTHS]
  );
  console.log(`Retention purge of raw source data (events/transactions only)`);
  console.log(`  window : ${MONTHS} months  (cut-off < ${cut[0].d})`);
  console.log(`  sources: ${SOURCES.join(", ")}`);
  console.log(`  mode   : ${APPLY ? "APPLY (deleting)" : "DRY RUN (counts only)"}`);
  console.log("");

  let grand = 0;
  const failed = [];
  for (const t of selected) {
    try {
      if (APPLY) {
        const n = await purge(t);
        grand += n;
        console.log(`  ${n > 0 ? "deleted" : "     -- "}  ${String(n).padStart(9)}  ${t.label}`);
      } else {
        const n = await countFor(t);
        grand += n;
        console.log(`  would delete  ${String(n).padStart(9)}  ${t.label}`);
      }
    } catch (e) {
      failed.push(t.label);
      console.error(`  ERROR on ${t.label}: ${e.message}`);
    }
  }

  console.log("");
  console.log(`  ${APPLY ? "deleted" : "would delete"} ${grand} row(s) across ${selected.length} table(s).`);
  if (failed.length) {
    console.error(`  ${failed.length} table(s) failed: ${failed.join(", ")}`);
  }
  if (!APPLY) console.log(`  Re-run with --apply to perform the deletion.`);
  return failed.length ? 1 : 0;
}

main()
  .then((code) => pool.end().then(() => process.exit(code)))
  .catch((e) => {
    console.error(e);
    pool.end().finally(() => process.exit(1));
  });
