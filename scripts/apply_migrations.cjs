#!/usr/bin/env node
/* ============================================================================
 *  apply_migrations.cjs - apply every file in server/sql/migrations/ in order.
 *
 *  The base schema (scripts/apply_schema.cjs) only runs server/sql/01..NN. The
 *  dated files under server/sql/migrations/ are the catch-up migrations for
 *  EXISTING databases; they are all idempotent (CREATE ... IF NOT EXISTS /
 *  ADD COLUMN IF NOT EXISTS / guarded DROP), so they are also safe to run on a
 *  fresh DB to guarantee it reaches the same final state (e.g. dropping the
 *  obsolete app.billing_invoices the base file still creates).
 *
 *  Applied in filename order (the YYYY-MM-DD prefix sorts chronologically).
 *  NON-destructive. Run with: POSTGRESQL_CONN=... node scripts/apply_migrations.cjs
 * ========================================================================== */
const fs = require("fs");
const path = require("path");
const { getPool } = require("./_db.cjs");

const pool = getPool();
const MIG_DIR = path.join(__dirname, "..", "server", "sql", "migrations");

async function main() {
  if (!fs.existsSync(MIG_DIR)) {
    console.log("No migrations directory - nothing to apply.");
    return;
  }
  const files = fs.readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (!files.length) {
    console.log("No migration files found.");
    return;
  }

  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIG_DIR, f), "utf8");
    process.stdout.write(`Applying migration ${f} ... `);
    try {
      await pool.query(sql);
      console.log("ok");
    } catch (e) {
      console.log("FAILED");
      console.error(`\n--- error in ${f} ---\n${e.message}\n`);
      throw e;
    }
  }
  console.log(`\n${files.length} migration(s) applied successfully.`);
}

main().then(() => pool.end()).catch(() => { pool.end(); process.exit(1); });
