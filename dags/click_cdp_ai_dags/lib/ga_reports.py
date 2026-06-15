#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared helpers for the GA reports DAGs (the single, consolidated
GA landing pipeline; earlier duplicate families have been removed).

The one GA landing pipeline:

  - triggered with ``str_client_name`` (= capsuite_ref) -> sync that one workspace
    (the "Sync Data" button / initial backfill);
  - triggered with no client       -> sync every connected workspace (daily schedule).

Config and job status are read from / written to POSTGRES (the authoritative store
after the schema redesign) - MongoDB is no longer used:

  - ``build_configs``  -> delegates to lib/pg_config (app.* tables)
  - run status         -> the Node app's /api/data-integrations/webhook/dag-complete
                          endpoint updates app.integration_sync_jobs +
                          app.data_integrations (mirrors the content_scrape webhook)
  - ``resolve_incremental_start_date`` -> lib/pg_state (plan-based first-run backfill,
                          then daily incremental overlap)
"""

import os

from dags.click_cdp_ai_dags.lib import config as ga_config  # noqa: F401  (kept for callers)
from dags.click_cdp_ai_dags.lib import pg_config
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("ga")


# --------------------------------------------------------------------------- #
# Postgres-backed run-status notification (replaces the old MongoDB callbacks)
# --------------------------------------------------------------------------- #
def _cdp_endpoint():
    try:
        from airflow.models import Variable
        return Variable.get("cdp_endpoint", default_var=os.environ.get("CDP_ENDPOINT", ""))
    except Exception:
        return os.environ.get("CDP_ENDPOINT", "")


def _params(context):
    dag_run = context.get("dag_run")
    return (dag_run.conf if dag_run and dag_run.conf else {}) or {}


def notify_dag_complete(params, is_synced, error=None, records_synced=None):
    """Tell the Node app the GA sync finished, so it can flip the job + integration
    status in Postgres. Only meaningful for API/queue-triggered runs that carry a
    ``job_id`` + ``company_id``; scheduled (all-workspace) runs have neither and are
    skipped."""
    job_id = params.get("job_id")
    company_id = params.get("company_id")
    integration_type = params.get("integration_type", "googleAnalytics")
    if not job_id or not company_id:
        _log.warning("No job_id/company_id (scheduled run); skipping dag-complete webhook")
        return True

    endpoint = _cdp_endpoint()
    if not endpoint:
        _log.warning("No cdp_endpoint configured; skipping dag-complete webhook")
        return True

    import requests
    payload = {
        "integration_type": integration_type,
        "company_id": company_id,
        "job_id": job_id,
        "is_synced": bool(is_synced),
        "sync_error": (str(error) if error else None),
        "records_synced": records_synced,
    }
    try:
        r = requests.post(
            f"{endpoint.rstrip('/')}/api/data-integrations/webhook/dag-complete",
            json=payload, timeout=30,
        )
        _log.info(f"[ga] dag-complete webhook -> {r.status_code}")
    except Exception as e:
        _log.error(f"[ga] dag-complete webhook failed: {e}")
    return True


def on_dag_start_callback(**context):
    """No-op marker task. The Node queue worker already flips the job to 'running'
    when it claims it; this just records the start in the task log."""
    params = _params(context)
    if params.get("job_id"):
        _log.info(f"GA sync started for job_id={params.get('job_id')} company_id={params.get('company_id')}")
    else:
        _log.info("Scheduled GA sync started (all connected workspaces)")
    return True


def on_dag_failure_callback(context):
    """Airflow on_failure_callback: report the failure to Postgres via the webhook."""
    params = _params(context)
    exception = context.get("exception", "Unknown error, try again.")
    return notify_dag_complete(params, is_synced=False, error=exception)


# --------------------------------------------------------------------------- #
# Config builder (was the MongoDB get_config)
# --------------------------------------------------------------------------- #
def build_configs(str_client_name=None, is_debugging=False):
    """Return the per-workspace GA report configs from Postgres.

    API-triggered runs resolve a single workspace (``str_client_name``); scheduled
    runs resolve every GA-connected workspace. ``keyword_performance`` is excluded
    here - it is a Search Console report handled by the GSC keyword DAG.
    """
    return pg_config.build_configs(str_client_name, is_debugging, source="googleAnalytics")


def get_params(context):
    """Extract (str_client_name, is_debugging, dag_run_id) from the dag_run conf."""
    params = _params(context)
    str_client_name = params.get("str_client_name")
    is_debugging_param = params.get("is_debugging", False)
    if isinstance(is_debugging_param, str):
        is_debugging = is_debugging_param.lower() == 'true'
    else:
        is_debugging = bool(is_debugging_param)
    return str_client_name, is_debugging, params.get("dag_run_id")


# --------------------------------------------------------------------------- #
# Start-date resolution (plan-based first-run backfill, then incremental overlap)
# --------------------------------------------------------------------------- #
def resolve_incremental_start_date(dict_config, report_key, prefix2, blob=None, default_days=180):
    """Resolve the ``str_start_date`` for a daily incremental report.

    The resume point comes from the Postgres ``ga_sync_control`` table: first run
    -> plan-based historical backfill (3y free / 5y pro), otherwise
    last_sync_date - overlap_days. ``report_key`` / ``prefix2`` / ``blob`` /
    ``default_days`` are kept for call-site compatibility; the control report name
    is derived from ``prefix2`` (the trailing ``_2`` is stripped).
    """
    from dags.click_cdp_ai_dags.lib import pg_state
    report = prefix2[:-2] if prefix2.endswith("_2") else prefix2
    return pg_state.resolve_start_date(dict_config["client"], report)
