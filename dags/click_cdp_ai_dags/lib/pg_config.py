#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Postgres-backed config builder for the click_cdp_ai GA / GSC DAGs.

Replaces the old MongoDB-driven get_config. The authoritative tenant/config store
is now Postgres (the schema redesign), so the pipeline reads everything from the
``app`` schema instead of Mongo:

  app.companies             -> capsuite_ref <-> company_id, account_id, is_active
  app.data_integrations     -> googleAnalytics  {propertyId, propertyName}
                               googleSearchConsole {siteUrl} + is_connected flags
  app.company_report_config -> ga_reports (which reports to run + per-report flags),
                               supporting_capsuite_param, url_domain

Each returned dict mirrors the shape the group DAGs already expect, so the task
code does not change:

    {
      "client": capsuite_ref,
      "report": ["path_exploration", "utm_performance", ...],
      "supportingCapsuiteParam": ["capsuite_sid", "capsuite_apid"],
      "property": [{"property_id": "...", "property_name": "..."}],
      "site_url": "https://example.com/",     # GSC only
      "url_domain": "https://example.com",
      "<report>": {"isDebugging": false, "debugStartDate": "..."},
    }

API-triggered runs pass ``str_client_name`` (= capsuite_ref) and resolve a single
workspace; scheduled runs pass nothing and resolve every connected workspace.
``keyword_performance`` is a Search Console report and is therefore returned ONLY
for ``source='googleSearchConsole'`` (and only when GSC is connected with a
site_url), never as part of the GA reports.
"""

import json

from dags.click_cdp_ai_dags.lib import config as ga_config, db
from dags.click_cdp_ai_dags.lib.log import get_logger

_log = get_logger("pg_config")

# Reports that are NOT GA reports even if they happen to appear under ga_reports.
_GSC_REPORTS = {"keyword_performance"}


def _as_dict(value):
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return {}


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


_BASE_SQL = """
    SELECT c.capsuite_ref,
           crc.ga_reports,
           crc.gsc_reports,
           crc.supporting_capsuite_param,
           crc.url_domain,
           ga.config        AS ga_config,
           COALESCE(ga.is_connected, FALSE)  AS ga_connected,
           gsc.config       AS gsc_config,
           COALESCE(gsc.is_connected, FALSE) AS gsc_connected
    FROM app.companies c
    LEFT JOIN app.company_report_config crc ON crc.company_id = c.id
    LEFT JOIN app.data_integrations ga
           ON ga.company_id = c.id AND ga.integration_type = 'googleAnalytics'
    LEFT JOIN app.data_integrations gsc
           ON gsc.company_id = c.id AND gsc.integration_type = 'googleSearchConsole'
    WHERE c.is_active = TRUE
"""


def _fetch_rows(conn, str_client_name=None, source="googleAnalytics"):
    sql = _BASE_SQL
    params = []
    if str_client_name:
        sql += " AND c.capsuite_ref = %s"
        params.append(str_client_name)
    else:
        # Daily (all-workspace) run: skip any workspace that already has an
        # in-flight MANUAL sync job for this source, so the scheduled run and a
        # user's "Sync Data" click never process the same workspace at once.
        sql += """
            AND NOT EXISTS (
                SELECT 1 FROM app.integration_sync_jobs j
                WHERE j.company_id = c.id
                  AND j.integration_type = %s
                  AND j.status IN ('queued', 'running')
            )
        """
        params.append(source)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _ga_property_list(ga_config_json):
    """GA integration config holds a single {propertyId, propertyName}."""
    cfg = _as_dict(ga_config_json)
    pid = cfg.get("propertyId")
    if not pid:
        return []
    return [{"property_id": pid, "property_name": cfg.get("propertyName")}]


def _build_one(row, source, is_debugging):
    if source == "googleSearchConsole":
        gsc_cfg = _as_dict(row.get("gsc_config"))
        site_url = gsc_cfg.get("siteUrl")
        if not row.get("gsc_connected") or not site_url:
            return None
        reports_cfg = _as_dict(row.get("gsc_reports")) or {"keyword_performance": {}}
        report_keys = list(reports_cfg.keys())
    else:  # googleAnalytics
        if not row.get("ga_connected"):
            return None
        reports_cfg = _as_dict(row.get("ga_reports"))
        report_keys = [k for k in reports_cfg.keys() if k not in _GSC_REPORTS]
        if not report_keys:
            return None
        site_url = None

    cfg = {
        "client": row["capsuite_ref"],
        "report": report_keys,
        "supportingCapsuiteParam": _as_list(row.get("supporting_capsuite_param")),
        "property": _ga_property_list(row.get("ga_config")),
        "site_url": site_url,
        "url_domain": row.get("url_domain") or "",
    }
    for report_name in report_keys:
        cfg[report_name] = dict(reports_cfg.get(report_name, {}))
        if is_debugging:
            cfg[report_name]["isDebugging"] = True

    return cfg


def build_configs(str_client_name=None, is_debugging=False, source="googleAnalytics"):
    """Return the list of per-workspace report configs from Postgres.

    ``source`` selects which integration gates inclusion and which reports are
    emitted: ``googleAnalytics`` (default) or ``googleSearchConsole``.
    """
    conn_kwargs = ga_config.get_pg_conn_kwargs()
    if not conn_kwargs:
        raise RuntimeError(
            "Postgres connection not configured (cdp_pg_* Airflow Variables)."
        )

    rows = db.run_tx(conn_kwargs, lambda conn: _fetch_rows(conn, str_client_name, source))

    configs = []
    for row in rows:
        cfg = _build_one(row, source, is_debugging)
        if cfg is not None:
            configs.append(cfg)

    scope = str_client_name or "ALL connected workspaces"
    _log.info("%s: built %d config(s) for %s", source, len(configs), scope)
    return configs
