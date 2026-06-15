#!/usr/bin/env node
/* ============================================================================
 *  apply_schema.cjs - drop + recreate the whole CDP schema via node-postgres.
 *  Runs server/sql/01..12 in order after dropping the app-owned schemas.
 *  (Does NOT use 00_teardown.sql - that file is psql-only; we drop in JS here.)
 *
 *  DESTRUCTIVE: drops app/manual/ga_landing/shopify/shopline/odoo/commerce/
 *  interaction/public.
 *    POSTGRESQL_CONN=... node scripts/apply_schema.cjs
 * ========================================================================== */
const fs = require("fs");
const path = require("path");
const { getPool } = require("./_db.cjs");

const pool = getPool();

const SQL_DIR = path.join(__dirname, "..", "server", "sql");

async function main() {
  console.log("Dropping schemas...");
  await pool.query(`
    DROP SCHEMA IF EXISTS app         CASCADE;
    DROP SCHEMA IF EXISTS manual      CASCADE;
    DROP SCHEMA IF EXISTS ga_landing  CASCADE;
    DROP SCHEMA IF EXISTS shopify     CASCADE;
    DROP SCHEMA IF EXISTS shopline    CASCADE;
    DROP SCHEMA IF EXISTS odoo        CASCADE;
    DROP SCHEMA IF EXISTS commerce    CASCADE;
    DROP SCHEMA IF EXISTS interaction CASCADE;
    DROP SCHEMA IF EXISTS public      CASCADE;
    CREATE SCHEMA public;
  `);

  const files = fs.readdirSync(SQL_DIR)
    .filter((f) => /^\d\d_.*\.sql$/.test(f) && !f.startsWith("00_"))
    .sort();

  for (const f of files) {
    const sql = fs.readFileSync(path.join(SQL_DIR, f), "utf8");
    process.stdout.write(`Applying ${f} ... `);
    try {
      await pool.query(sql);
      console.log("ok");
    } catch (e) {
      console.log("FAILED");
      console.error(`\n--- error in ${f} ---\n${e.message}\n`);
      throw e;
    }
  }
  console.log("\nSchema applied successfully.");
}

main().then(() => pool.end()).catch((e) => { pool.end(); process.exit(1); });
