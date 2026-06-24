// One-off: apply the two attribute migrations safely.
//  1) 2026-06-24_attr_title_min_length.sql  (additive column - always safe)
//  2) 2026-06-24_attr_unique_name.sql       (unique index - only if NO duplicates)
// Run: node scripts/run_attr_migrations.cjs
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const conn = process.env.POSTGRESQL_CONN || process.env.DATABASE_URL;
if (!conn) { console.error("No POSTGRESQL_CONN in env"); process.exit(1); }
const pool = new Pool({ connectionString: conn });
const mig = (f) => fs.readFileSync(path.join(__dirname, "..", "server", "sql", "migrations", f), "utf8");

(async () => {
  const c = await pool.connect();
  try {
    // ── Pre-check: duplicate attribute names per workspace (case-insensitive) ──
    const dup = await c.query(
      `SELECT company_id, lower(name) AS name, COUNT(*) AS n, array_agg(id::text) AS ids
       FROM app.attributes GROUP BY company_id, lower(name) HAVING COUNT(*) > 1`
    );
    console.log(`\n[pre-check] duplicate attribute names: ${dup.rowCount}`);
    if (dup.rowCount) dup.rows.forEach((r) => console.log(`   • "${r.name}" x${r.n}  ids=${r.ids.join(",")}`));

    // ── Migration 1: title min length (safe, idempotent) ──
    console.log("\n[1/2] valid_title_min_length column …");
    await c.query(mig("2026-06-24_attr_title_min_length.sql"));
    console.log("      ✓ applied");

    // ── Migration 2: unique name index (only if no duplicates) ──
    if (dup.rowCount === 0) {
      console.log("[2/2] unique attribute-name index …");
      await c.query(mig("2026-06-24_attr_unique_name.sql"));
      console.log("      ✓ applied");
    } else {
      console.log("[2/2] SKIPPED unique-name index — resolve the duplicates above first, then re-run.");
    }

    // ── Verify ──
    const col = await c.query(
      `SELECT column_name, data_type, column_default FROM information_schema.columns
       WHERE table_schema='app' AND table_name='web_content_html_elements' AND column_name='valid_title_min_length'`
    );
    const idx = await c.query(`SELECT indexname FROM pg_indexes WHERE indexname='attributes_company_lower_name_idx'`);
    console.log("\n[verify] column valid_title_min_length:", col.rows[0] || "MISSING");
    console.log("[verify] index attributes_company_lower_name_idx:", idx.rowCount ? "present" : "absent");
    console.log("\nDone.");
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => { console.error("\nERROR:", e.message); process.exit(1); });
