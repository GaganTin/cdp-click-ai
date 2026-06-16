#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""App-DB-backed config / credentials / job status for the click_cdp_ai pipeline.

Client report settings and linked credentials live in the App DB (the ``app``
schema: ``company_report_config`` + ``data_integrations``), NOT in the Data
Postgres that holds the GA landing tables. Run status is tracked in
``app.integration_sync_jobs``. This module replaces the old MongoDB-driven path
(companyreportconfig / companies / dataintegrationjobs).

The App DB connection comes from ``config.get_app_pg_conn_kwargs()`` (the
``app_pg_conn`` Airflow Variable), so it is never hardcoded and the temporary
Neon DB can be swapped for the formal DB (same schema) without code changes.

``build_configs`` returns the exact same ``dict_config`` shape the DAG tasks
already consume, so no DAG task file needs to change:
    client, company_id, report (list), <report_name> (per-report config),
    supporting_capsuite_param, property (list of {property_id, property_name}).
"""

from datetime import datetime, timedelta

from psycopg2 import sql
from psycopg2.extras import RealDictCursor

from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import db
from dags.click_cdp_ai_dags.lib import crypto
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("app_state")


def _conn_kwargs(conn_kwargs=None):
    ck = conn_kwargs or ga_config.get_app_pg_conn_kwargs()
    if not ck:
        raise RuntimeError(
            "App DB connection is not configured. Set the app_pg_conn Airflow "
            "Variable to a postgresql:// URL."
        )
    return ck


# --------------------------------------------------------------------------- #
# Config builder (was the MongoDB-driven get_config / build_configs)
# --------------------------------------------------------------------------- #
def build_configs(str_client_name=None, is_debugging=False, is_trial=None, conn_kwargs=None):
    """Return the list of per-client report configs from the App DB.

    - ``str_client_name`` set  -> resolve that single client (API-triggered run);
      the ``is_trial`` filter is NOT applied, mirroring the original behaviour.
    - ``str_client_name`` None -> resolve every GA-connected client, optionally
      filtered by ``is_trial`` (True for the trial flow, False for the scheduled
      / contracted flow, None for no filter).

    Only clients with a non-empty ``ga_reports`` and a connected googleAnalytics
    integration are returned. Property details come from ``data_integrations``.
    """
    ck = _conn_kwargs(conn_kwargs)
    schema = ga_config.APP_SCHEMA

    def _do(conn):
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            where = [
                # '{{}}' -> '{}' after sql.SQL.format (braces must be escaped).
                "crc.ga_reports <> '{{}}'::jsonb",
                "EXISTS (SELECT 1 FROM {schema}.data_integrations di "
                "WHERE di.company_id = crc.company_id "
                "AND di.integration_type = 'googleAnalytics' AND di.is_connected)",
            ]
            params = []
            if str_client_name:
                where.append("crc.capsuite_ref = %s")
                params.append(str_client_name)
            elif is_trial is not None:
                where.append("crc.is_trial = %s")
                params.append(is_trial)

            cur.execute(
                sql.SQL(
                    "SELECT crc.capsuite_ref, crc.company_id, crc.is_trial, "
                    "crc.supporting_capsuite_param, crc.ga_reports "
                    "FROM {schema}.company_report_config crc "
                    "WHERE " + " AND ".join(where)
                ).format(schema=sql.Identifier(schema)),
                params,
            )
            rows = cur.fetchall()

            configs = []
            for row in rows:
                ga_reports = row["ga_reports"] or {}
                supporting = list(row["supporting_capsuite_param"] or [])
                cfg = {
                    "client": row["capsuite_ref"],
                    "company_id": str(row["company_id"]),
                    "report": list(ga_reports.keys()),
                    # Single canonical key (snake_case), matching the App DB column
                    # and both the trial and scheduled add_capsuite_param_dims.
                    "supporting_capsuite_param": supporting,
                }
                for report_name, report_config in ga_reports.items():
                    cfg[report_name] = dict(report_config) if isinstance(report_config, dict) else report_config

                if is_debugging:
                    debug_start = (datetime.today() - timedelta(days=180)).strftime("%Y-%m-%d")
                    for report_name in cfg["report"]:
                        if isinstance(cfg.get(report_name), dict):
                            cfg[report_name]["isDebugging"] = True
                            cfg[report_name]["debugStartDate"] = debug_start

                cur.execute(
                    sql.SQL(
                        "SELECT di.config->>'propertyId' AS property_id, "
                        "COALESCE(di.config->>'propertyName', c.name) AS property_name "
                        "FROM {schema}.data_integrations di "
                        "JOIN {schema}.companies c ON c.id = di.company_id "
                        "WHERE di.company_id = %s "
                        "AND di.integration_type = 'googleAnalytics' AND di.is_connected "
                        "ORDER BY di.created_date"
                    ).format(schema=sql.Identifier(schema)),
                    (row["company_id"],),
                )
                cfg["property"] = [
                    {"property_id": p["property_id"], "property_name": p["property_name"]}
                    for p in cur.fetchall()
                ]
                configs.append(cfg)
            return configs

    configs = db.run_tx(ck, _do)
    _log.info("built %d GA config(s) (client=%s, is_trial=%s)", len(configs), str_client_name, is_trial)
    return configs


# --------------------------------------------------------------------------- #
# Shopify config / credentials (App DB: data_integrations + companies)
# --------------------------------------------------------------------------- #
# When the daily (all-workspace) run resolves its clients, skip any workspace
# that already has an in-flight MANUAL "Sync Data" job for this source, so the
# scheduled sweep and a user's click never process the same workspace at once
# (mirrors pg_config._fetch_rows for GA/GSC).
_NOT_IN_FLIGHT = (
    "AND NOT EXISTS (SELECT 1 FROM {schema}.integration_sync_jobs j "
    "WHERE j.company_id = di.company_id AND j.integration_type = %s "
    "AND j.status IN ('queued', 'running'))"
)


def build_shopify_configs(str_client_name=None, conn_kwargs=None):
    """Return per-client Shopify configs from the App DB.

    Unlike GA, Shopify ingestion is NOT gated by company_report_config reports:
    a client is in scope when it has a connected ``shopify`` data_integration.

    - ``str_client_name`` set  -> resolve that single client ("Sync Data" click).
    - ``str_client_name`` None -> ALL shopify-connected clients (the daily run),
      MINUS any workspace with an in-flight manual sync job (daily/manual dedup).

    Returns ``[{client, company_id, store_name, is_trial}, ...]`` - ``is_trial``
    is the client's ACTUAL trial status (so a contracted client's first sync
    still backfills all history, a trial client's the 2-month/3-year window).
    The access token is deliberately NOT included so it never travels through
    XCom; fetch it inside the task with ``get_shopify_access_token(company_id)``.
    """
    ck = _conn_kwargs(conn_kwargs)
    schema = ga_config.APP_SCHEMA

    def _do(conn):
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            where = ["di.integration_type = 'shopify'", "di.is_connected = TRUE"]
            params = []
            if str_client_name:
                where.append("c.capsuite_ref = %s")
                params.append(str_client_name)
            else:
                where.append(_NOT_IN_FLIGHT)
                params.append("shopify")

            # DISTINCT ON keeps one store per client (the originals only ever read
            # the first shopify connection); see plan "multi-store" risk.
            cur.execute(
                sql.SQL(
                    "SELECT DISTINCT ON (c.capsuite_ref) "
                    "c.capsuite_ref AS client, di.company_id AS company_id, "
                    "di.config->>'storeName' AS store_name, "
                    "COALESCE(crc.is_trial, FALSE) AS is_trial "
                    "FROM {schema}.data_integrations di "
                    "JOIN {schema}.companies c ON c.id = di.company_id "
                    "LEFT JOIN {schema}.company_report_config crc ON crc.company_id = di.company_id "
                    "WHERE " + " AND ".join(where) + " "
                    "ORDER BY c.capsuite_ref, di.created_date"
                ).format(schema=sql.Identifier(schema)),
                params,
            )
            return [
                {
                    "client": row["client"],
                    "company_id": str(row["company_id"]),
                    "store_name": row["store_name"],
                    "is_trial": bool(row["is_trial"]),
                }
                for row in cur.fetchall()
            ]

    configs = db.run_tx(ck, _do)
    _log.info(f"[app_state] built {len(configs)} shopify config(s) (client={str_client_name})")
    return configs


def get_shopify_access_token(company_id, conn_kwargs=None):
    """Fetch the Shopify access token for a company from the App DB.

    Resolved inside the task (not carried in XCom) so the plaintext token never
    serializes. Returns the token string, or ``None`` if not connected.
    """
    ck = _conn_kwargs(conn_kwargs)
    schema = ga_config.APP_SCHEMA

    def _do(conn):
        with conn.cursor() as cur:
            cur.execute(
                sql.SQL(
                    "SELECT di.config->>'accessToken' "
                    "FROM {schema}.data_integrations di "
                    "WHERE di.company_id = %s AND di.integration_type = 'shopify' "
                    "AND di.is_connected = TRUE "
                    "ORDER BY di.created_date LIMIT 1"
                ).format(schema=sql.Identifier(schema)),
                (company_id,),
            )
            row = cur.fetchone()
            # Token is AES-256-GCM encrypted at rest by the Node app; decrypt is a
            # no-op on any plaintext (legacy) value.
            return crypto.decrypt(row[0]) if row else None

    return db.run_tx(ck, _do)


# --------------------------------------------------------------------------- #
# Shopline / Odoo config (App DB: data_integrations + companies)
# --------------------------------------------------------------------------- #
def _build_integration_clients(integration_type, str_client_name=None, conn_kwargs=None):
    """Return ``[{client, company_id, is_trial}]`` for every company with a
    connected integration of ``integration_type``.

    - ``str_client_name`` set  -> that one client ("Sync Data" click).
    - ``str_client_name`` None -> ALL connected clients (daily run) minus any
      workspace with an in-flight manual job (daily/manual dedup).

    Like build_shopify_configs, these platforms are not gated by
    company_report_config; credentials are fetched inside the task (never XCom)."""
    ck = _conn_kwargs(conn_kwargs)
    schema = ga_config.APP_SCHEMA

    def _do(conn):
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            where = ["di.integration_type = %s", "di.is_connected = TRUE"]
            params = [integration_type]
            if str_client_name:
                where.append("c.capsuite_ref = %s")
                params.append(str_client_name)
            else:
                where.append(_NOT_IN_FLIGHT)
                params.append(integration_type)
            cur.execute(
                sql.SQL(
                    "SELECT DISTINCT ON (c.capsuite_ref) "
                    "c.capsuite_ref AS client, di.company_id AS company_id, "
                    "COALESCE(crc.is_trial, FALSE) AS is_trial "
                    "FROM {schema}.data_integrations di "
                    "JOIN {schema}.companies c ON c.id = di.company_id "
                    "LEFT JOIN {schema}.company_report_config crc ON crc.company_id = di.company_id "
                    "WHERE " + " AND ".join(where) + " "
                    "ORDER BY c.capsuite_ref, di.created_date"
                ).format(schema=sql.Identifier(schema)),
                params,
            )
            return [
                {"client": r["client"], "company_id": str(r["company_id"]), "is_trial": bool(r["is_trial"])}
                for r in cur.fetchall()
            ]

    configs = db.run_tx(ck, _do)
    _log.info(f"[app_state] built {len(configs)} {integration_type} config(s) (client={str_client_name})")
    return configs


def build_shopline_configs(str_client_name=None, conn_kwargs=None):
    return _build_integration_clients("shopline", str_client_name, conn_kwargs)


def build_odoo_configs(str_client_name=None, conn_kwargs=None):
    return _build_integration_clients("odoo", str_client_name, conn_kwargs)


def get_shopline_access_token(company_id, conn_kwargs=None):
    """Fetch the Shopline access token for a company (App DB), or None."""
    ck = _conn_kwargs(conn_kwargs)
    schema = ga_config.APP_SCHEMA

    def _do(conn):
        with conn.cursor() as cur:
            cur.execute(
                sql.SQL(
                    "SELECT di.config->>'accessToken' "
                    "FROM {schema}.data_integrations di "
                    "WHERE di.company_id = %s AND di.integration_type = 'shopline' "
                    "AND di.is_connected = TRUE ORDER BY di.created_date LIMIT 1"
                ).format(schema=sql.Identifier(schema)),
                (company_id,),
            )
            row = cur.fetchone()
            # Token is AES-256-GCM encrypted at rest by the Node app; decrypt is a
            # no-op on any plaintext (legacy) value.
            return crypto.decrypt(row[0]) if row else None

    return db.run_tx(ck, _do)


def get_odoo_conn_kwargs(company_id, conn_kwargs=None):
    """Return psycopg2 connection kwargs for a company's own Odoo Postgres, built
    from its App DB ``odoo`` integration config, or None if not connected."""
    ck = _conn_kwargs(conn_kwargs)
    schema = ga_config.APP_SCHEMA

    def _do(conn):
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                sql.SQL(
                    "SELECT di.config AS config "
                    "FROM {schema}.data_integrations di "
                    "WHERE di.company_id = %s AND di.integration_type = 'odoo' "
                    "AND di.is_connected = TRUE ORDER BY di.created_date LIMIT 1"
                ).format(schema=sql.Identifier(schema)),
                (company_id,),
            )
            return cur.fetchone()

    row = db.run_tx(ck, _do)
    if not row or not row.get("config"):
        return None
    cfg = row["config"]
    return {
        "host": cfg.get("pgHostName"),
        "port": cfg.get("pgDbPort"),
        "dbname": cfg.get("pgDbName"),
        "user": cfg.get("pgDbUser"),
        "password": crypto.decrypt(cfg.get("pgDbPassword")),
        "connect_timeout": 15,
    }


# --------------------------------------------------------------------------- #
# Run-status callbacks (was the MongoDB dataintegrationjobs callbacks)
# --------------------------------------------------------------------------- #
def _update_job_status(context, status, phase):
    """Update app.integration_sync_jobs for the run, matched on airflow_run_id.

    Mirrors the original Mongo callbacks: only API-triggered runs (those carrying
    ``str_client_name``) are tracked, and any error is swallowed so it never masks
    the real task outcome.
    """
    try:
        dag_run = context["dag_run"]
        params = dag_run.conf if dag_run.conf else {}
        run_id = params.get("dag_run_id") or None

        if not params.get("str_client_name"):
            _log.warning(f"Not triggered by API, skipping App DB job '{status}' update")
            return True
        if not run_id:
            _log.warning("No dag_run_id provided, skipping App DB job update")
            return True

        error_message = None
        if phase == "failure":
            error_message = str(context.get("exception", "Unknown error, try again."))

        ck = _conn_kwargs()
        schema = ga_config.APP_SCHEMA

        def _do(conn):
            with conn.cursor() as cur:
                if phase == "start":
                    cur.execute(
                        sql.SQL(
                            "UPDATE {schema}.integration_sync_jobs "
                            "SET status = %s, started_at = now(), updated_date = now() "
                            "WHERE airflow_run_id = %s"
                        ).format(schema=sql.Identifier(schema)),
                        (status, run_id),
                    )
                else:
                    cur.execute(
                        sql.SQL(
                            "UPDATE {schema}.integration_sync_jobs "
                            "SET status = %s, error_message = %s, completed_at = now(), "
                            "updated_date = now() WHERE airflow_run_id = %s"
                        ).format(schema=sql.Identifier(schema)),
                        (status, error_message, run_id),
                    )
                return cur.rowcount

        rowcount = db.run_tx(ck, _do)
        _log.info(f"[app_state] job '{status}' for airflow_run_id={run_id} (rows updated: {rowcount})")
        return True
    except Exception as e:
        _log.error(f"Error updating App DB job status ('{status}'): {e}")
        return False


def on_dag_start_callback(**context):
    """Mark the run 'running' in app.integration_sync_jobs."""
    return _update_job_status(context, status="running", phase="start")


def on_dag_failure_callback(context):
    """Mark the run 'failed' (with the error message) in app.integration_sync_jobs."""
    return _update_job_status(context, status="failed", phase="failure")
