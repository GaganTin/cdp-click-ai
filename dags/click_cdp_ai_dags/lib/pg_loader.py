#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hybrid PostgreSQL loader for the GA landing DAGs.

Modelled on cdp-ai/scripts/import_linkedu_google_analytics_to_neon.py:
- psycopg2 + execute_values for batched inserts
- one ``ga_<prefix>`` table per dataset
- ensure-table (types inferred from the DataFrame) -> ensure capsuite_ref +
  index -> scoped DELETE -> batched INSERT

The destination is the k8s Postgres reached over a local ``kubectl port-forward``;
the connection is built from the ``cdp_pg_host_name`` / ``cdp_pg_db_port`` /
``cdp_pg_db_name`` / ``cdp_pg_db_user`` / ``cdp_pg_db_password`` Airflow Variables
(see config.py).

Scoped replace semantics
------------------------
The landing tasks fetch incrementally (e.g. the last 7 days), so a blanket
"DELETE WHERE capsuite_ref = client" would wipe history. Instead we delete only
the rows for the client AND the keys currently being (re)written (the set of
dates / tracking periods present in the DataFrame), which mirrors the
per-file "overwrite blob" behaviour.
"""

from decimal import Decimal
import datetime as _dt
import math

import numpy as np
import pandas as pd

try:
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extras import execute_values
except ImportError as exc:  # pragma: no cover - surfaced at runtime only
    raise ImportError(
        "psycopg2 is required for Postgres loading. Install psycopg2-binary."
    ) from exc

from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("pg_loader")

DEFAULT_BATCH_SIZE = 5000


def _pg_type_for_series(series: pd.Series) -> str:
    """Infer a Postgres column type from a pandas Series dtype."""
    dtype = series.dtype
    if pd.api.types.is_bool_dtype(dtype):
        return "BOOLEAN"
    if pd.api.types.is_integer_dtype(dtype):
        return "BIGINT"
    if pd.api.types.is_float_dtype(dtype):
        return "DOUBLE PRECISION"
    if pd.api.types.is_datetime64tz_dtype(dtype):
        return "TIMESTAMPTZ"
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return "TIMESTAMP"
    # Everything else (object / string / mixed) is stored as text in landing.
    return "TEXT"


def _normalize_value(value):
    """Convert a pandas/numpy scalar into a psycopg2-friendly Python value."""
    if value is None:
        return None
    # pandas NA / NaT
    try:
        if value is pd.NaT or (np.isscalar(value) and pd.isna(value)):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        v = float(value)
        return None if math.isnan(v) else v
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, Decimal):
        return value
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime()
    if isinstance(value, (list, tuple, dict, np.ndarray)):
        import json
        return json.dumps(value, default=str)
    if isinstance(value, (str, bool, int, float, _dt.datetime, _dt.date)):
        return value
    return str(value)


def _ensure_table(conn, schema, table, df):
    defs = [
        sql.SQL("{} {}").format(sql.Identifier(col), sql.SQL(_pg_type_for_series(df[col])))
        for col in df.columns
    ]
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL("CREATE TABLE IF NOT EXISTS {}.{} ({})").format(
                sql.Identifier(schema),
                sql.Identifier(table),
                sql.SQL(", ").join(defs),
            )
        )
        # Guarantee every DataFrame column exists (handles schema drift).
        for col in df.columns:
            cur.execute(
                sql.SQL("ALTER TABLE {}.{} ADD COLUMN IF NOT EXISTS {} {}").format(
                    sql.Identifier(schema),
                    sql.Identifier(table),
                    sql.Identifier(col),
                    sql.SQL(_pg_type_for_series(df[col])),
                )
            )
        if "capsuite_ref" not in df.columns:
            cur.execute(
                sql.SQL("ALTER TABLE {}.{} ADD COLUMN IF NOT EXISTS capsuite_ref TEXT").format(
                    sql.Identifier(schema), sql.Identifier(table)
                )
            )
        cur.execute(
            sql.SQL("CREATE INDEX IF NOT EXISTS {} ON {}.{} (capsuite_ref)").format(
                sql.Identifier(f"{table}_capsuite_ref_idx"),
                sql.Identifier(schema),
                sql.Identifier(table),
            )
        )


def _resolve_company_id(conn, capsuite_ref):
    """Map a capsuite_ref to its app.companies.id (the authoritative tenant key).

    The whole ga_landing schema is partitioned by company_id (NOT NULL), so every
    loaded row needs it. Raises if the ref has no matching workspace so we never
    silently drop a client's data into an untenant-able row.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM app.companies WHERE capsuite_ref = %s",
            (capsuite_ref,),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError(
            f"No app.companies row found for capsuite_ref '{capsuite_ref}'. "
            f"Cannot load GA landing data without a company_id."
        )
    return row[0]


def _scoped_delete(conn, schema, table, company_id, scope_column, scope_values):
    """Replace only this tenant's rows for the keys being (re)written.

    Scoping by company_id (not capsuite_ref) keeps the replace aligned with the
    NOT NULL tenant key and is incremental-safe: only the dates present in the
    DataFrame are deleted, so historical rows survive.
    """
    with conn.cursor() as cur:
        if scope_column and scope_values:
            unique_values = sorted({str(v) for v in scope_values})
            cur.execute(
                sql.SQL("DELETE FROM {}.{} WHERE company_id = %s AND {}::text = ANY(%s)").format(
                    sql.Identifier(schema),
                    sql.Identifier(table),
                    sql.Identifier(scope_column),
                ),
                (company_id, unique_values),
            )
        else:
            cur.execute(
                sql.SQL("DELETE FROM {}.{} WHERE company_id = %s").format(
                    sql.Identifier(schema), sql.Identifier(table)
                ),
                (company_id,),
            )


def _insert_rows(conn, schema, table, columns, df, batch_size):
    stmt = sql.SQL("INSERT INTO {}.{} ({}) VALUES %s").format(
        sql.Identifier(schema),
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(c) for c in columns),
    )
    records = df.to_dict("records")
    rows = [tuple(_normalize_value(rec.get(c)) for c in columns) for rec in records]
    inserted = 0
    with conn.cursor() as cur:
        rendered = stmt.as_string(conn)
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            execute_values(cur, rendered, batch, page_size=batch_size)
            inserted += len(batch)
    return inserted


def load_dataframe(
    df,
    table_name,
    client,
    scope_column=None,
    scope_values=None,
    conn_kwargs=None,
    schema=None,
    batch_size=DEFAULT_BATCH_SIZE,
    report=None,
    watermark_value=None,
    control_table=None,
):
    """Load ``df`` into ``schema.table_name`` for ``client`` using scoped replace.

    Parameters
    ----------
    df : pandas.DataFrame
        Rows to load. Must already contain a ``capsuite_ref`` column (the landing
        tasks set this), otherwise it is added from ``client``.
    table_name : str
        Destination table, typically ``ga_<prefix>``.
    client : str
        capsuite_ref scope for the replace.
    scope_column / scope_values : optional
        If given, only rows matching these key values are deleted before insert
        (incremental-safe). Typically the ``date`` (or ``tracking_period``)
        column and the distinct values present in ``df``.
    report / watermark_value : optional
        When both are given, the sync-control watermark for (client, report)
        is advanced to ``watermark_value`` in the SAME transaction as the insert,
        so the high-water-mark never moves past data that failed to load.
    control_table : optional
        Sync-control table name inside ``schema`` (defaults to the GA
        ``ga_sync_control``; the commerce platforms pass their own, e.g.
        ``shopify_sync_control``).
    """
    if df is None or len(df) == 0:
        _log.info("%s %s: no rows to load, skipping", ctx(client, table_name), table_name)
        return 0

    conn_kwargs = conn_kwargs or ga_config.get_pg_conn_kwargs()
    if not conn_kwargs:
        raise RuntimeError(
            "Postgres is enabled but no connection is configured. Set the "
            "cdp_pg_host_name / cdp_pg_db_port / cdp_pg_db_name / cdp_pg_db_user "
            "/ cdp_pg_db_password Airflow Variables."
        )
    schema = schema or ga_config.PG_SCHEMA

    df = df.copy()
    if "capsuite_ref" not in df.columns:
        df["capsuite_ref"] = client

    from dags.click_cdp_ai_dags.lib import db, pg_state

    def _do(conn):
        # Resolve the tenant key once and stamp it on every row. ga_landing tables
        # are company_id NOT NULL, so this must precede ensure-table/insert.
        company_id = _resolve_company_id(conn, client)
        # Serialise concurrent loads of the SAME (workspace, table) - e.g. a manual
        # "Sync Data" click landing while the daily run is mid-flight - so their
        # scoped delete+insert can't interleave or deadlock. Auto-released at COMMIT.
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"{company_id}:{table_name}",))
        frame = df
        if "company_id" not in frame.columns:
            frame = frame.copy()
            frame["company_id"] = str(company_id)
        columns = list(frame.columns)

        _ensure_table(conn, schema, table_name, frame)
        _scoped_delete(conn, schema, table_name, company_id, scope_column, scope_values)
        n = _insert_rows(conn, schema, table_name, columns, frame, batch_size)
        if report and watermark_value is not None:
            # Advance the watermark atomically with the inserted rows.
            pg_state.ensure_control_table(conn, schema, control_table=control_table)
            pg_state.update_watermark_in_tx(conn, schema, client, report, watermark_value,
                                            control_table=control_table)
        return n

    inserted = db.run_tx(conn_kwargs, _do)
    _log.info("%s loaded %d rows into %s.%s", ctx(client, table_name), inserted, schema, table_name)
    return inserted
