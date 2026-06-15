#!/usr/bin/env node
/* ============================================================================
 *  notify_scan.cjs - one-shot run of the scan-based notification producer.
 *
 *  The server already runs this on an interval (startNotificationScanWorker).
 *  This script is for manual runs / external cron if you'd rather drive it
 *  out-of-process. Idempotent via dedupe keys - safe to re-run.
 *
 *    POSTGRESQL_CONN=... node scripts/notify_scan.cjs
 * ========================================================================== */
const { pathToFileURL } = require("url");
const path = require("path");
const { getPool } = require("./_db.cjs");

const pool = getPool();

(async () => {
  // The producer lives in an ESM module; load it via dynamic import.
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "server", "lib", "notificationsScan.js")).href);
  const n = await mod.scanNewLeads(pool, { windowMinutes: 30 });
  console.log(`new_leads: ${n} notification(s) created`);
  await pool.end();
})().catch((e) => { console.error(e); pool.end(); process.exit(1); });
