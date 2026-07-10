#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Postgres-backed sync control / watermark for the click_cdp_ai GA pipeline.

A single control table ``ga_sync_control`` holds, per (capsuite_ref, report):

  - settings:  is_debugging, debug_months, overlap_days
  - state:     last_sync_date, last_run_at, last_status, error_message

Resume logic (per report, read before the task fetches from GA):
  - is_debugging = TRUE  -> start from the 1st of (today - debug_months)   (default 2 months)
  - is_debugging = FALSE and last_sync_date set -> last_sync_date - overlap_days (default 7)
  - first run (no last_sync_date) -> full historical BACKFILL sized by the owning
                            account's plan, capped at 24 months (2 years) for every
                            tier by default (see PLAN_BACKFILL_YEARS). A default
                            control row is inserted so you can flip is_debugging in
                            the DB later.

The plan-based backfill is what makes the FIRST "Sync Data" click pull up to the
last 24 months of history; every subsequent (daily) run is the cheap incremental
overlap.

The watermark is advanced in the SAME transaction as the data load (see
pg_loader.load_dataframe), so it never moves past data that failed to load - the
pipeline stays idempotent and safe to re-run.

This module reads the destination from the cdp_pg_* Airflow Variables via config.py
and is fully independent of Azure Blob.
"""

import calendar
import datetime as _dt

try:
    import psycopg2
    from psycopg2 import sql
except ImportError as exc:  # pragma: no cover
    raise ImportError("psycopg2 is required for the sync control table. Install psycopg2-binary.") from exc

from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("pg_state")


CONTROL_TABLE = "ga_sync_control"
QUALITY_TABLE = "ga_report_quality"
DEFAULT_DEBUG_MONTHS = 2
DEFAULT_OVERLAP_DAYS = 7

# First-run historical backfill window, in years, by account plan
# (app.accounts.plan: 'lite' | 'standard' | 'enterprise'). Capped at 24 months
# (2 years) for every tier by default; bump a specific tier here if a plan should
# pull deeper history.
PLAN_BACKFILL_YEARS = {"lite": 2, "standard": 2, "enterprise": 2}
DEFAULT_BACKFILL_YEARS = 2


# --------------------------------------------------------------------------- #
# date helpers
# --------------------------------------------------------------------------- #
def _month_start_back(d, months):
    """First day of the month that is ``months`` months before ``d``."""
    total = d.year * 12 + (d.month - 1) - int(months)
    y, m = divmod(total, 12)
    return _dt.date(y, m + 1, 1)


def _years_back(d, years):
    """The same calendar day ``years`` years before ``d`` (Feb-29 safe)."""
    try:
        return d.replace(year=d.year - int(years))
    except ValueError:
        # d is Feb 29 and the target year is not a leap year -> use Feb 28.
        return d.replace(year=d.year - int(years), day=28)


def parse_watermark(value):
    """Parse a landing date token into a DATE.

    Accepts 'YYYYMMDD' / 'YYYY-MM-DD' (per-day reports) and 'YYYY-MM'
    (funnel monthly, mapped to the LAST day of the month so the 7-day overlap
    stays inside that month)."""
    if value is None:
        return None
    if isinstance(value, _dt.date):
        return value
    text = str(value).strip()
    for fmt in ("%Y%m%d", "%Y-%m-%d"):
        try:
            return _dt.datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    try:
        d = _dt.datetime.strptime(text, "%Y-%m").date()
        last_day = calendar.monthrange(d.year, d.month)[1]
        return _dt.date(d.year, d.month, last_day)
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# connection / table
# --------------------------------------------------------------------------- #
def _conn_kwargs(conn_kwargs=None):
    ck = conn_kwargs or ga_config.get_pg_conn_kwargs()
    if not ck:
        raise RuntimeError(
            "Postgres is required for the sync control table but no connection is "
            "configured. Set the cdp_pg_host_name / cdp_pg_db_port / cdp_pg_db_name "
            "/ cdp_pg_db_user / cdp_pg_db_password Airflow Variables."
        )
    return ck


def ensure_control_table(conn, schema, control_table=None):
    """Create the sync-control table if it does not exist (idempotent).

    ``control_table`` defaults to the GA table name; the commerce-platform
    pipelines reuse this with their own table (e.g. shopify.shopify_sync_control).
    """
    control_table = control_table or CONTROL_TABLE
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL(
                """
                CREATE TABLE IF NOT EXISTS {}.{} (
                    capsuite_ref   TEXT        NOT NULL,
                    report         TEXT        NOT NULL,
                    is_debugging   BOOLEAN     NOT NULL DEFAULT FALSE,
                    debug_months   INTEGER     NOT NULL DEFAULT {},
                    overlap_days   INTEGER     NOT NULL DEFAULT {},
                    last_sync_date DATE,
                    last_run_at    TIMESTAMPTZ,
                    last_status    TEXT,
                    error_message  TEXT,
                    rows_loaded    INTEGER,
                    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
                    PRIMARY KEY (capsuite_ref, report)
                )
                """
            ).format(
                sql.Identifier(schema),
                sql.Identifier(control_table),
                sql.Literal(DEFAULT_DEBUG_MONTHS),
                sql.Literal(DEFAULT_OVERLAP_DAYS),
            )
        )
        # CREATE TABLE IF NOT EXISTS won't add columns to a pre-existing control
        # table, so add rows_loaded explicitly for already-deployed environments.
        cur.execute(
            sql.SQL("ALTER TABLE {}.{} ADD COLUMN IF NOT EXISTS rows_loaded INTEGER").format(
                sql.Identifier(schema), sql.Identifier(control_table)
            )
        )


def _backfill_years_for_client(conn, client):
    """Resolve the first-run backfill window (years) from the account plan.

    ``client`` is a capsuite_ref -> app.companies -> app.accounts.plan. Unknown /
    missing plan falls back to the free-tier window so we never over-pull.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.plan
            FROM app.companies c
            JOIN app.accounts a ON a.id = c.account_id
            WHERE c.capsuite_ref = %s
            """,
            (client,),
        )
        found = cur.fetchone()
    plan = (found[0] if found else None) or "free"
    return PLAN_BACKFILL_YEARS.get(plan, DEFAULT_BACKFILL_YEARS)


def _get_or_create_row(conn, schema, client, report, control_table=None):
    """Return the control row as a dict; insert a default row on first encounter."""
    control_table = control_table or CONTROL_TABLE
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL(
                "SELECT is_debugging, debug_months, overlap_days, last_sync_date "
                "FROM {}.{} WHERE capsuite_ref = %s AND report = %s"
            ).format(sql.Identifier(schema), sql.Identifier(control_table)),
            (client, report),
        )
        found = cur.fetchone()
        if found is not None:
            return {
                "is_debugging": found[0],
                "debug_months": found[1],
                "overlap_days": found[2],
                "last_sync_date": found[3],
            }
        cur.execute(
            sql.SQL(
                "INSERT INTO {}.{} (capsuite_ref, report) VALUES (%s, %s) "
                "ON CONFLICT (capsuite_ref, report) DO NOTHING"
            ).format(sql.Identifier(schema), sql.Identifier(control_table)),
            (client, report),
        )
        return {
            "is_debugging": False,
            "debug_months": DEFAULT_DEBUG_MONTHS,
            "overlap_days": DEFAULT_OVERLAP_DAYS,
            "last_sync_date": None,
        }


# --------------------------------------------------------------------------- #
# public API
# --------------------------------------------------------------------------- #
def resolve_start_date(client, report, conn_kwargs=None, schema=None,
                       control_table=None, first_run_start=None):
    """Return the incremental start date ('%Y-%m-%d') for (client, report).

    ``control_table`` lets the commerce-platform pipelines keep their watermark
    in their own table (defaults to the GA ``ga_sync_control``).
    ``first_run_start`` (a date) overrides the plan-based first-run backfill
    window - e.g. the Shopify landing flow backfills the last 2 years for every
    account. Ignored once a watermark exists or when is_debugging is set.
    """
    ck = _conn_kwargs(conn_kwargs)
    schema = schema or ga_config.PG_SCHEMA

    from dags.click_cdp_ai_dags.lib import db

    def _do(conn):
        ensure_control_table(conn, schema, control_table=control_table)
        row = _get_or_create_row(conn, schema, client, report, control_table=control_table)
        # Only the first run (no watermark yet) needs the plan-based window; skip
        # the extra query on every subsequent incremental run (and when the
        # caller supplied an explicit first-run start).
        if (not row["is_debugging"] and row["last_sync_date"] is None
                and first_run_start is None):
            row["backfill_years"] = _backfill_years_for_client(conn, client)
        return row

    row = db.run_tx(ck, _do)

    today = _dt.date.today()
    debug_months = row["debug_months"] if row["debug_months"] is not None else DEFAULT_DEBUG_MONTHS
    overlap_days = row["overlap_days"] if row["overlap_days"] is not None else DEFAULT_OVERLAP_DAYS

    if row["is_debugging"]:
        start = _month_start_back(today, debug_months)
    elif row["last_sync_date"] is not None:
        start = row["last_sync_date"] - _dt.timedelta(days=overlap_days)
    elif first_run_start is not None:
        # Caller-defined first-run window (e.g. Shopify: epoch / 2-month floor).
        start = first_run_start
    else:
        # First sync for this (client, report): full historical backfill by plan.
        backfill_years = row.get("backfill_years", DEFAULT_BACKFILL_YEARS)
        start = _years_back(today, backfill_years)

    _log.info("%s start_date=%s (debug=%s, last_sync_date=%s, backfill_years=%s)",
              ctx(client, report), start, row["is_debugging"],
              row["last_sync_date"], row.get("backfill_years"))
    return start.strftime("%Y-%m-%d")


def ensure_quality_table(conn, schema, quality_table=None):
    """Create the GA report-quality table if absent (idempotent).

    One row per (capsuite_ref, report, property_id) holding the latest run's
    GA4 data-quality signals - sampling, (other)-row loss, thresholding - plus
    GA's metric TOTALs vs the summed rows, so we can MEASURE which reports
    diverge from the GA4 UI instead of guessing. See GoogleAnalytics.extract_quality.
    """
    quality_table = quality_table or QUALITY_TABLE
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL(
                """
                CREATE TABLE IF NOT EXISTS {}.{} (
                    capsuite_ref             TEXT        NOT NULL,
                    report                   TEXT        NOT NULL,
                    property_id              TEXT        NOT NULL,
                    run_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
                    start_date               DATE,
                    row_count                INTEGER,
                    is_sampled               BOOLEAN,
                    sampling_pct             DOUBLE PRECISION,
                    data_loss_from_other_row BOOLEAN,
                    subject_to_thresholding  BOOLEAN,
                    empty_reason             TEXT,
                    sessions_drift_pct       DOUBLE PRECISION,
                    ga_totals                JSONB       NOT NULL DEFAULT '{{}}'::jsonb,
                    summed_metrics           JSONB       NOT NULL DEFAULT '{{}}'::jsonb,
                    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
                    PRIMARY KEY (capsuite_ref, report, property_id)
                )
                """
            ).format(sql.Identifier(schema), sql.Identifier(quality_table))
        )


def record_report_quality(client, report, property_id, quality,
                          summed_metrics=None, start_date=None,
                          conn_kwargs=None, schema=None, quality_table=None):
    """Upsert the latest data-quality row for (client, report, property_id).

    ``quality`` is the dict from ``GoogleAnalytics.extract_quality``. If
    ``summed_metrics`` (a {metric_name: summed_value} from the actual rows) is
    given and both it and GA's TOTAL carry ``sessions``, the per-row vs total
    drift is computed - a non-zero drift quantifies (other)-row loss.

    Best-effort: never raises into the caller's data path (a quality-logging
    failure must not fail the sync). Returns the computed sessions_drift_pct or
    None.
    """
    import json as _json

    schema = schema or ga_config.PG_SCHEMA
    quality_table = quality_table or QUALITY_TABLE
    summed_metrics = summed_metrics or {}
    ga_totals = (quality or {}).get('totals', {}) or {}

    drift = None
    ga_sessions = ga_totals.get('sessions')
    summed_sessions = summed_metrics.get('sessions')
    if ga_sessions not in (None, 0) and summed_sessions is not None:
        try:
            drift = round((float(summed_sessions) - float(ga_sessions)) / float(ga_sessions) * 100, 4)
        except (TypeError, ValueError, ZeroDivisionError):
            drift = None

    try:
        ck = _conn_kwargs(conn_kwargs)
        from dags.click_cdp_ai_dags.lib import db

        def _do(conn):
            ensure_quality_table(conn, schema, quality_table=quality_table)
            with conn.cursor() as cur:
                cur.execute(
                    sql.SQL(
                        """
                        INSERT INTO {schema}.{table}
                            (capsuite_ref, report, property_id, run_at, start_date, row_count,
                             is_sampled, sampling_pct, data_loss_from_other_row,
                             subject_to_thresholding, empty_reason, sessions_drift_pct,
                             ga_totals, summed_metrics, updated_at)
                        VALUES (%s, %s, %s, now(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                        ON CONFLICT (capsuite_ref, report, property_id) DO UPDATE SET
                            run_at                   = EXCLUDED.run_at,
                            start_date               = EXCLUDED.start_date,
                            row_count                = EXCLUDED.row_count,
                            is_sampled               = EXCLUDED.is_sampled,
                            sampling_pct             = EXCLUDED.sampling_pct,
                            data_loss_from_other_row = EXCLUDED.data_loss_from_other_row,
                            subject_to_thresholding  = EXCLUDED.subject_to_thresholding,
                            empty_reason             = EXCLUDED.empty_reason,
                            sessions_drift_pct       = EXCLUDED.sessions_drift_pct,
                            ga_totals                = EXCLUDED.ga_totals,
                            summed_metrics           = EXCLUDED.summed_metrics,
                            updated_at               = now()
                        """
                    ).format(schema=sql.Identifier(schema), table=sql.Identifier(quality_table)),
                    (client, report, property_id, parse_watermark(start_date),
                     (quality or {}).get('row_count'),
                     (quality or {}).get('is_sampled'),
                     (quality or {}).get('sampling_pct'),
                     (quality or {}).get('data_loss_from_other_row'),
                     (quality or {}).get('subject_to_thresholding'),
                     (quality or {}).get('empty_reason'),
                     drift, _json.dumps(ga_totals), _json.dumps(summed_metrics)),
                )

        db.run_tx(ck, _do)
        if (quality or {}).get('is_sampled') or (quality or {}).get('data_loss_from_other_row'):
            _log.warning("%s GA data-quality flag: sampled=%s other_row=%s thresholding=%s drift=%s%%",
                         ctx(client, report), (quality or {}).get('is_sampled'),
                         (quality or {}).get('data_loss_from_other_row'),
                         (quality or {}).get('subject_to_thresholding'), drift)
    except Exception as error:  # never break the data path on a logging failure
        _log.error("%s failed to record report quality: %s", ctx(client, report), error)
    return drift


def update_watermark_in_tx(conn, schema, client, report, watermark_value,
                           status="success", error=None, control_table=None,
                           rows_loaded=None):
    """Advance the watermark within an existing transaction (called from the
    data-load transaction so it commits atomically with the inserted rows).

    ``rows_loaded`` records how many rows this run loaded for (client, report) -
    the daily digest reads it to flag "synced but 0 rows" clients. Passing
    ``watermark_value=None`` records the run (last_run_at / status / rows_loaded)
    WITHOUT advancing last_sync_date, which is how an empty (0-row) run is logged
    so it stays distinguishable from "did not run at all"."""
    control_table = control_table or CONTROL_TABLE
    new_date = parse_watermark(watermark_value)
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL(
                """
                INSERT INTO {schema}.{table}
                    (capsuite_ref, report, last_sync_date, last_run_at, last_status, error_message, rows_loaded, updated_at)
                VALUES (%s, %s, %s, now(), %s, %s, %s, now())
                ON CONFLICT (capsuite_ref, report) DO UPDATE SET
                    last_sync_date = GREATEST(
                        COALESCE({table}.last_sync_date, EXCLUDED.last_sync_date),
                        EXCLUDED.last_sync_date
                    ),
                    last_run_at    = EXCLUDED.last_run_at,
                    last_status    = EXCLUDED.last_status,
                    error_message  = EXCLUDED.error_message,
                    rows_loaded    = EXCLUDED.rows_loaded,
                    updated_at     = now()
                """
            ).format(
                schema=sql.Identifier(schema),
                table=sql.Identifier(control_table),
            ),
            (client, report, new_date, status, error, rows_loaded),
        )
    _log.info("%s watermark -> %s (%s, rows=%s)", ctx(client, report), new_date, status, rows_loaded)
