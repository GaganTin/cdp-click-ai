#!/usr/bin/env node
/* ============================================================================
 *  schema_diff.cjs - compare the LIVE database against the SQL source files.
 *
 *  Parses server/sql/01..NN_*.sql (canonical) + server/sql/migrations/*.sql
 *  (date-ordered) into an "expected" set of tables & columns, then introspects
 *  the live DB (information_schema) and reports drift:
 *    - tables in SQL but missing from the DB
 *    - tables in the DB but not defined in any SQL file
 *    - columns missing / extra per table
 *    - column type mismatches (best-effort, normalised)
 *
 *  READ-ONLY. Run with: POSTGRESQL_CONN=... node scripts/schema_diff.cjs
 * ========================================================================== */
const fs = require("fs");
const path = require("path");
const { getPool } = require("./_db.cjs");

const SQL_DIR = path.join(__dirname, "..", "server", "sql");
const APP_SCHEMAS = new Set([
  "app", "manual", "ga_landing", "shopify", "shopline", "odoo",
  "commerce", "interaction",
]);

// ── tiny SQL tokenizer: split a file into top-level statements, respecting
//    single-quote strings, line comments, dollar-quoted bodies and parens. ──
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];
    // line comment
    if (c === "-" && c2 === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // block comment
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // single-quoted string
    if (c === "'") {
      buf += c; i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { buf += "''"; i += 2; continue; }
        buf += sql[i];
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    // dollar-quoted ($$ or $tag$)
    if (c === "$") {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        buf += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (c === ";") { out.push(buf); buf = ""; i++; continue; }
    buf += c; i++;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

// split a CREATE TABLE body on top-level commas (respect parens + strings)
function splitTopLevel(body) {
  const parts = [];
  let buf = "", depth = 0, i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i];
    if (c === "'") {
      buf += c; i++;
      while (i < n) {
        if (body[i] === "'" && body[i + 1] === "'") { buf += "''"; i += 2; continue; }
        buf += body[i];
        if (body[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { parts.push(buf); buf = ""; i++; continue; }
    buf += c; i++;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

const CONSTRAINT_KW = new Set([
  "PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT", "EXCLUDE", "LIKE", "PARTITION",
]);

function unquote(id) { return id.replace(/^"|"$/g, "").replace(/""/g, '"'); }

// keywords that terminate the type portion of a column definition
const TYPE_STOP = new Set([
  "NOT", "NULL", "DEFAULT", "PRIMARY", "REFERENCES", "UNIQUE", "CHECK",
  "GENERATED", "COLLATE", "CONSTRAINT", "GENERATED", "AS",
]);

// normalise a SQL DDL type to compare against information_schema.data_type.
// Only looks at the leading type tokens (stops at NOT/DEFAULT/REFERENCES/...) so
// values inside a DEFAULT (e.g. JSONB DEFAULT '[]') don't poison detection.
function normType(t) {
  if (!t) return "";
  // grab only the type portion: tokens before the first constraint keyword
  const toks = [];
  for (const tok of t.trim().split(/\s+/)) {
    if (TYPE_STOP.has(tok.replace(/[\[\](),]/g, "").toUpperCase())) break;
    toks.push(tok);
    if (/\[\]\s*$/.test(tok)) break; // array suffix ends the type
  }
  let s = toks.join(" ").toLowerCase();
  const isArray = /\[\]/.test(s) || /\barray\b/.test(s);
  s = s.replace(/\[\]/g, "").replace(/\(.*?\)/g, "").trim();
  s = s.split(/\s+/)[0];
  const map = {
    text: "text", varchar: "character varying", "character": "character varying",
    uuid: "uuid", jsonb: "jsonb", json: "json",
    boolean: "boolean", bool: "boolean",
    timestamptz: "timestamp with time zone", timestamp: "timestamp without time zone",
    timestamptz_: "timestamp with time zone",
    date: "date", time: "time without time zone",
    integer: "integer", int: "integer", int4: "integer",
    bigint: "bigint", int8: "bigint", smallint: "smallint",
    serial: "integer", bigserial: "bigint",
    numeric: "numeric", decimal: "numeric", real: "real",
    "double": "double precision", float8: "double precision",
    bytea: "bytea", inet: "inet",
  };
  let base = map[s] || s;
  return isArray ? "ARRAY" : base;
}

function qualName(raw) {
  // raw like  app.campaigns  | shopify."order" | "weird"."x"
  const m = raw.trim().match(/^("(?:[^"]|"")+"|[A-Za-z0-9_]+)\.("(?:[^"]|"")+"|[A-Za-z0-9_]+)/);
  if (!m) return null;
  return unquote(m[1]) + "." + unquote(m[2]);
}

// Build expected schema from the SQL files.
function buildExpected() {
  const baseFiles = fs.readdirSync(SQL_DIR)
    .filter(f => /^\d\d_.*\.sql$/.test(f) && !f.startsWith("00_"))
    .sort();
  const migDir = path.join(SQL_DIR, "migrations");
  const migFiles = fs.existsSync(migDir)
    ? fs.readdirSync(migDir).filter(f => f.endsWith(".sql")).sort()
        .map(f => path.join("migrations", f))
    : [];
  const files = [...baseFiles, ...migFiles];

  const tables = new Map(); // "schema.table" -> Map(col -> {type})
  const notes = [];

  for (const rel of files) {
    const sql = fs.readFileSync(path.join(SQL_DIR, rel), "utf8");
    for (const stmtRaw of splitStatements(sql)) {
      const stmt = stmtRaw.trim();
      if (!stmt) continue;
      const head = stmt.replace(/\s+/g, " ");

      // CREATE TABLE
      let m = head.match(/^CREATE TABLE (IF NOT EXISTS )?(.+?)\s*\(/i);
      if (m) {
        const name = qualName(m[2]);
        if (!name) continue;
        // body = text between first ( and matching last )
        const openIdx = stmt.indexOf("(");
        const body = stmt.slice(openIdx + 1, stmt.lastIndexOf(")"));
        if (!tables.has(name)) tables.set(name, new Map());
        const cols = tables.get(name);
        for (const part of splitTopLevel(body)) {
          const seg = part.trim();
          if (!seg) continue;
          const first = seg.split(/\s+/)[0];
          if (CONSTRAINT_KW.has(first.toUpperCase())) continue;
          const colName = unquote(first);
          const rest = seg.slice(first.length).trim();
          cols.set(colName, { type: normType(rest) });
        }
        continue;
      }

      // ALTER TABLE ... ADD COLUMN
      m = head.match(/^ALTER TABLE (IF EXISTS )?(.+?) ADD COLUMN (IF NOT EXISTS )?("[^"]+"|[A-Za-z0-9_]+)\s+(.+)$/i);
      if (m) {
        const name = qualName(m[2]);
        if (!name) continue;
        if (!tables.has(name)) tables.set(name, new Map());
        tables.get(name).set(unquote(m[4]), { type: normType(m[5]) });
        continue;
      }

      // ALTER TABLE ... DROP COLUMN
      m = head.match(/^ALTER TABLE (IF EXISTS )?(.+?) DROP COLUMN (IF EXISTS )?("[^"]+"|[A-Za-z0-9_]+)/i);
      if (m) {
        const name = qualName(m[2]);
        if (name && tables.has(name)) tables.get(name).delete(unquote(m[4]));
        continue;
      }

      // DROP TABLE
      m = head.match(/^DROP TABLE (IF EXISTS )?(.+?)(\s+CASCADE)?$/i);
      if (m) {
        const name = qualName(m[2]);
        if (name) { tables.delete(name); notes.push(`SQL drops ${name}`); }
        continue;
      }
    }
  }
  return { tables, notes };
}

async function buildActual(pool) {
  const schemas = [...APP_SCHEMAS];
  const { rows } = await pool.query(
    `SELECT table_schema, table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = ANY($1)
      ORDER BY 1,2,3`, [schemas]);
  const tables = new Map();
  for (const r of rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!tables.has(key)) tables.set(key, new Map());
    tables.get(key).set(r.column_name, { type: r.data_type });
  }
  // also capture tables that exist but have zero columns (rare) via tables view
  const t = await pool.query(
    `SELECT table_schema, table_name FROM information_schema.tables
      WHERE table_schema = ANY($1) AND table_type='BASE TABLE'`, [schemas]);
  for (const r of t.rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!tables.has(key)) tables.set(key, new Map());
  }
  return tables;
}

(async () => {
  const pool = getPool();
  const { tables: exp, notes } = buildExpected();
  const act = await buildActual(pool);
  await pool.end();

  const expKeys = new Set(exp.keys());
  const actKeys = new Set(act.keys());

  const missingTables = [...expKeys].filter(k => !actKeys.has(k)).sort();
  const extraTables = [...actKeys].filter(k => !expKeys.has(k)).sort();
  const common = [...expKeys].filter(k => actKeys.has(k)).sort();

  const colIssues = [];
  for (const t of common) {
    const e = exp.get(t), a = act.get(t);
    const missingCols = [...e.keys()].filter(c => !a.has(c));
    const extraCols = [...a.keys()].filter(c => !e.has(c));
    const typeDiffs = [];
    for (const c of e.keys()) {
      if (a.has(c)) {
        const et = e.get(c).type, at = a.get(c).type;
        if (et && at && et !== at) typeDiffs.push(`${c}: SQL=${et} DB=${at}`);
      }
    }
    if (missingCols.length || extraCols.length || typeDiffs.length)
      colIssues.push({ t, missingCols, extraCols, typeDiffs });
  }

  const L = [];
  L.push("=== SCHEMA DIFF: SQL files  vs  live DB ===\n");
  L.push(`expected tables (from SQL): ${expKeys.size}`);
  L.push(`actual tables (in DB):      ${actKeys.size}\n`);

  L.push(`-- Tables in SQL but MISSING from DB (${missingTables.length}) --`);
  missingTables.forEach(t => L.push(`  ✗ ${t}`));
  if (!missingTables.length) L.push("  (none)");

  L.push(`\n-- Tables in DB but NOT in any SQL file (${extraTables.length}) --`);
  extraTables.forEach(t => L.push(`  ? ${t}  [cols: ${[...act.get(t).keys()].join(", ") || "-"}]`));
  if (!extraTables.length) L.push("  (none)");

  L.push(`\n-- Column drift on shared tables (${colIssues.length} tables) --`);
  if (!colIssues.length) L.push("  (none - all shared tables match)");
  for (const ci of colIssues) {
    L.push(`  ▸ ${ci.t}`);
    if (ci.missingCols.length) L.push(`      missing in DB  : ${ci.missingCols.join(", ")}`);
    if (ci.extraCols.length)   L.push(`      extra in DB    : ${ci.extraCols.join(", ")}`);
    if (ci.typeDiffs.length)   L.push(`      type mismatch  : ${ci.typeDiffs.join(" | ")}`);
  }

  if (notes.length) { L.push("\n-- notes --"); notes.forEach(n => L.push("  " + n)); }

  const clean = !missingTables.length && !extraTables.length && !colIssues.length;
  L.push(`\nRESULT: ${clean ? "IN SYNC ✅" : "DRIFT FOUND ⚠️"}`);
  console.log(L.join("\n"));
})().catch(e => { console.error(e); process.exit(1); });
