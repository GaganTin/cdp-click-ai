#!/usr/bin/env node
/* ============================================================================
 *  run_billing_lifecycle.mjs - manual driver for the trial/plan lifecycle.
 * ----------------------------------------------------------------------------
 *  The same logic the daily cron runs (server/lib/billingLifecycle.js): reminder
 *  emails (trial ending / ended / final deletion notice) and, 6 months after an
 *  unconverted trial ends, the end-of-life data purge (delete all data, keep the
 *  account + owner shell so the email can't start a new trial).
 *
 *  SAFE BY DEFAULT: a dry run (logs what it WOULD do) unless you pass --apply.
 *  With --apply and RESEND_API_KEY unset, emails are simulated (logged, not sent),
 *  but the PURGE is real - use a non-production DATABASE_URL to rehearse.
 *
 *  Usage:
 *    POSTGRESQL_CONN=... node scripts/run_billing_lifecycle.mjs            # dry run
 *    POSTGRESQL_CONN=... node scripts/run_billing_lifecycle.mjs --apply    # act
 * ========================================================================== */
import "dotenv/config";
import pg from "pg";
import { runBillingLifecycle } from "../server/lib/billingLifecycle.js";

const APPLY = process.argv.includes("--apply");
const conn = process.env.POSTGRESQL_CONN || process.env.DATABASE_URL;
if (!conn) {
  console.error("Set POSTGRESQL_CONN (or DATABASE_URL) before running.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: conn, max: 2 });

console.log(`Trial/plan lifecycle - mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
if (APPLY && !process.env.RESEND_API_KEY) {
  console.log("  (RESEND_API_KEY unset - emails simulated; PURGE is still real)");
}

runBillingLifecycle(pool, { dryRun: !APPLY })
  .then((r) => {
    console.log("");
    console.log(`  ending=${r.ending} ended=${r.ended} warned=${r.warned} purged=${r.purged} skipped=${r.skipped}`);
    if (!APPLY) console.log("  Re-run with --apply to send emails / run purges.");
    return pool.end().then(() => process.exit(0));
  })
  .catch((e) => {
    console.error(e);
    pool.end().finally(() => process.exit(1));
  });
