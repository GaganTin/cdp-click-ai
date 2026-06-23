#!/usr/bin/env node
/* ============================================================================
 *  bootstrap_db.cjs - one command to provision a NEW, empty database end-to-end.
 *
 *  Runs, in order, against POSTGRESQL_CONN (or DATABASE_URL):
 *    1. apply_schema.cjs      - base schema 01..NN   (DESTRUCTIVE: drops schemas)
 *    2. apply_migrations.cjs  - server/sql/migrations/* (idempotent catch-ups)
 *    3. seed_all.cjs          - plans + founding account/users (login data)
 *
 *  Because step 1 DROPS app/manual/ga_landing/shopify/commerce/interaction/public,
 *  this refuses to run unless you confirm you mean THIS connection:
 *
 *    POSTGRESQL_CONN=... CONFIRM=YES node scripts/bootstrap_db.cjs
 *      (or pass --yes instead of CONFIRM=YES)
 *
 *  Pass --no-seed to skip step 3 (schema only, no demo data).
 * ========================================================================== */
require("dotenv").config(); // so the guard sees the same conn the child scripts will use
const path = require("path");
const { spawnSync } = require("child_process");

const conn = process.env.POSTGRESQL_CONN || process.env.DATABASE_URL;
if (!conn) {
  console.error("Set POSTGRESQL_CONN (or DATABASE_URL) before running.");
  process.exit(1);
}

const confirmed = process.env.CONFIRM === "YES" || process.argv.includes("--yes");
if (!confirmed) {
  // Show enough of the target to recognise it, but never print credentials.
  let target = conn;
  try { const u = new URL(conn); target = `${u.host}${u.pathname}`; } catch { /* keep raw */ }
  console.error(
    "Refusing to run: this DROPS and recreates all schemas on:\n" +
    `    ${target}\n` +
    "Re-run with CONFIRM=YES (or --yes) once you've verified that is the NEW DB.");
  process.exit(1);
}

const seed = !process.argv.includes("--no-seed");

const steps = [
  ["apply_schema.cjs", "Base schema (01..NN)"],
  ["apply_migrations.cjs", "Migrations"],
  ...(seed ? [["seed_all.cjs", "Seed (plans + account/users)"]] : []),
];

for (const [script, label] of steps) {
  console.log(`\n=== ${label} (${script}) ===`);
  const res = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    console.error(`\nBootstrap aborted: ${script} exited with code ${res.status}.`);
    process.exit(res.status || 1);
  }
}

console.log("\n✅ Database bootstrap complete." + (seed ? "  Login: owner@acme.test / Password123!" : ""));
