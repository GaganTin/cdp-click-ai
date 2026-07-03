#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate the app's GA catalog artifacts from the DAG cube_catalog (single source
of truth), so the runtime stays on the fast static file and never hits the DB.

cube_catalog (dags/click_cdp_ai_dags/lib/cube_catalog.py) already drives the Airflow
pipeline + the DB app.data_dictionary seed. This script makes it drive the APP too:

  1. server/data/data_dictionary.json   - the dictionary the AI analyst loads once at
     boot (server/index.js). We regenerate ONLY the ga_landing cube entries and
     preserve every other (commerce / manual / app) entry untouched.
  2. server/sql/09_ga_landing.sql        - the cube-table DDL for FRESH installs, kept
     between the "GENERATED CUBE TABLES" markers (indexes the loader does NOT create).
  3. server/sql/migrations/<date>_ga_cubes.sql - idempotent DDL for EXISTING DBs.

Run this whenever cube_catalog changes, then commit the regenerated files:
    python scripts/gen_ga_catalog.py           (writes JSON + prints SQL)
    python scripts/gen_ga_catalog.py --sql-only (just prints the SQL blocks)

Runtime cost is unchanged: the app still reads one static JSON at startup. This is a
lockfile-style artifact, not a build-time DB dependency.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "dags", "click_cdp_ai_dags", "lib"))
import cube_catalog as cc  # noqa: E402

DICT_PATH = os.path.join(ROOT, "server", "data", "data_dictionary.json")
GA_SQL_PATH = os.path.join(ROOT, "server", "sql", "09_ga_landing.sql")
BEGIN_MARK = "-- >>> BEGIN GENERATED CUBE TABLES"
END_MARK = "-- <<< END GENERATED CUBE TABLES"

# GA4 report "type" mirror for the analyst dictionary (see cube_catalog header).
JSON_TYPE = {"TEXT": "string", "BIGINT": "int", "DOUBLE PRECISION": "float",
             "TIMESTAMP": "string", "TIMESTAMPTZ": "string"}
# Physical Postgres type for the DDL (matches what pg_loader would infer).
SQL_TYPE = {"TEXT": "TEXT", "BIGINT": "BIGINT", "DOUBLE PRECISION": "DOUBLE PRECISION",
            "TIMESTAMP": "TIMESTAMP", "TIMESTAMPTZ": "TIMESTAMPTZ"}

# Retired: the flat utm/country tables the redesign dropped (never populated now).
RETIRED_GROUP = "utm"
# Cubes that already have hand-maintained DDL in 09_ga_landing.sql (kept as-is; the
# loader evolves their columns at runtime via ADD COLUMN IF NOT EXISTS).
EXISTING_DDL = {
    "path_exploration", "page_metrics", "page_utm_metrics", "website_metrics",
    "event_list", "utm_ad_performance", "utm_daily_utm_id_performance", "purchase_list",
}


def _cubes():
    return [c for c in cc.CUBES if c.get("group") != RETIRED_GROUP]


# ── 1. data_dictionary.json (analyst) ───────────────────────────────────────────
def _field(col):
    f = {"name": col["name"], "type": JSON_TYPE.get(col["type"], "string"),
         "description": col["description"]}
    if col["name"] == "date":
        f["format"] = "YYYYMMDD"
    elif col["name"] == "date_hour_minute":
        f["format"] = "YYYYMMDDHHMM"
    return f


def _ga_entries():
    # ga_landing cubes only. The ga_gold combination views are intentionally NOT
    # documented here: build_ga_gold is not wired into the pipeline, so those views
    # do not reliably exist. The app reads the base cubes directly instead (see
    # server/routes/utm.js channel endpoints), so the analyst should too.
    entries = []
    for cube in _cubes():
        entries.append({
            "table": cube["name"],
            "schema": "ga_landing",
            "use_case": cube["description"],
            "granularity": cube["grain"],
            "fields": [_field(c) for c in cc.all_columns(cube)],
        })
    return entries


def write_dictionary():
    existing = json.load(open(DICT_PATH, encoding="utf-8"))
    # Keep the two non-cube GA tables (GSC + bespoke funnel) and every non-GA entry.
    # Drop any ga_gold entries too (views not reliably built - see _ga_entries).
    keep_ga = {"keyword_performance", "funnel_report"}
    kept = [e for e in existing
            if e.get("schema") not in ("ga_landing", "ga_gold") or e.get("table") in keep_ga]
    merged = kept + _ga_entries()
    with open(DICT_PATH, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return len(merged), len(_ga_entries())


# ── 2/3. SQL DDL for the NEW cube tables ────────────────────────────────────────
def _ddl_columns(cube):
    lines = []
    for col in cube["columns"]:
        lines.append(f'  {col["name"]:<26} {SQL_TYPE.get(col["type"], "TEXT")}')
    return lines


def _table_ddl(cube, if_not_exists):
    name = cube["name"]
    has_date = any(c["name"] == "date" for c in cube["columns"])
    ine = "IF NOT EXISTS " if if_not_exists else ""
    body = ",\n".join(
        [f'  {"id":<26} BIGINT      GENERATED ALWAYS AS IDENTITY',
         f'  {"company_id":<26} UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE']
        + _ddl_columns(cube)
        + [f'  {"capsuite_ref":<26} TEXT',
           f'  {"property_id":<26} TEXT',
           f'  {"property_name":<26} TEXT',
           f'  {"synced_at":<26} TIMESTAMPTZ NOT NULL DEFAULT NOW()',
           '  PRIMARY KEY (company_id, id)']
    )
    idx_cols = "company_id, date" if has_date else "company_id"
    idx_name = f"gal_{name}_cd_idx" if has_date else f"gal_{name}_c_idx"
    idx_ine = "IF NOT EXISTS " if if_not_exists else ""
    return (f"CREATE TABLE {ine}ga_landing.{name} (\n{body}\n);\n"
            f"CREATE INDEX {idx_ine}{idx_name} ON ga_landing.{name}({idx_cols});\n")


def sql_blocks():
    """Return (fresh_ddl, idempotent_ddl) for the NEW cube tables only."""
    new_cubes = [c for c in _cubes() if c["name"] not in EXISTING_DDL]
    fresh = "\n".join(_table_ddl(c, if_not_exists=False) for c in new_cubes)
    idem = "\n".join(_table_ddl(c, if_not_exists=True) for c in new_cubes)
    names = [c["name"] for c in new_cubes]
    return fresh, idem, names


def write_fresh_sql(fresh):
    """Replace the generated cube-table section of 09_ga_landing.sql (between markers)."""
    txt = open(GA_SQL_PATH, encoding="utf-8").read()
    if BEGIN_MARK not in txt or END_MARK not in txt:
        print(f"[sql] markers not found in {GA_SQL_PATH} - add them once, then re-run.",
              file=sys.stderr)
        return False
    head, rest = txt.split(BEGIN_MARK, 1)
    _, tail = rest.split(END_MARK, 1)
    block = f"{BEGIN_MARK}\n{fresh}{END_MARK}"
    open(GA_SQL_PATH, "w", encoding="utf-8").write(head + block + tail)
    return True


if __name__ == "__main__":
    sql_only = "--sql-only" in sys.argv
    fresh, idem, names = sql_blocks()
    if not sql_only:
        total, ga = write_dictionary()
        print(f"[dict] wrote {DICT_PATH}: {total} entries ({ga} GA)", file=sys.stderr)
        if write_fresh_sql(fresh):
            print(f"[sql] updated {GA_SQL_PATH} cube section", file=sys.stderr)
    print(f"[sql] {len(names)} new cube tables: {', '.join(names)}", file=sys.stderr)
    print("\n===== IDEMPOTENT DDL (for the dated migration) =====\n")
    print(idem)
