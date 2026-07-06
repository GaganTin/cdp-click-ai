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
        return Variable.get("cdp_ai_endpoint", default_var=os.environ.get("CDP_ENDPOINT", ""))
    except Exception:
        return os.environ.get("CDP_ENDPOINT", "")


def _webhook_secret():
    """Shared secret sent with the dag-complete webhook so Node can verify the call
    really came from Airflow. Stored in the `cdp_ai_webhook_secret` Airflow Variable."""
    try:
        from airflow.models import Variable
        return Variable.get("cdp_ai_webhook_secret", default_var=os.environ.get("WEBHOOK_SECRET", ""))
    except Exception:
        return os.environ.get("WEBHOOK_SECRET", "")


def _params(context):
    """Resolved run parameters for this dag_run.

    API/queue-triggered runs carry everything in ``dag_run.conf``. SCHEDULED runs
    have an empty conf, so relying on conf alone loses each DAG's declared Param
    defaults - most importantly ``integration_type`` (googleSearchConsole / shopify),
    which then silently fell back to "googleAnalytics" and made GSC/Shopify daily
    syncs stamp GA's last_synced_date instead of their own. Airflow's
    ``context["params"]`` already holds the declared Param defaults with any conf
    overrides applied, so prefer it and layer conf on top for safety.
    """
    params = context.get("params") or {}
    dag_run = context.get("dag_run")
    conf = (dag_run.conf if dag_run and dag_run.conf else None)
    if params:
        merged = dict(params)
        if conf:
            merged.update(conf)
        return merged
    return conf or {}


def notify_dag_complete(params, is_synced, error=None, records_synced=None):
    """Tell the Node app the sync finished so it can flip status in Postgres.
    API/queue-triggered runs carry a ``job_id`` + ``company_id`` (one workspace).
    Scheduled (all-workspace) runs carry neither - we still report them with
    ``scheduled=true`` so a successful daily run stamps last_synced_date on every
    connected workspace of this type (and fires the daily-sync notification)."""
    job_id = params.get("job_id")
    company_id = params.get("company_id")
    integration_type = params.get("integration_type", "googleAnalytics")
    scheduled = not (job_id and company_id)

    endpoint = _cdp_endpoint()
    if not endpoint:
        _log.warning("No cdp_endpoint configured; skipping dag-complete webhook")
        return True

    import requests
    payload = {
        "integration_type": integration_type,
        "company_id": company_id,   # None for scheduled runs
        "job_id": job_id,           # None for scheduled runs
        "scheduled": scheduled,
        "is_synced": bool(is_synced),
        "sync_error": (str(error) if error else None),
        "records_synced": records_synced,
    }
    try:
        r = requests.post(
            f"{endpoint.rstrip('/')}/api/data-integrations/webhook/dag-complete",
            json=payload, timeout=30,
        )
        _log.info(f"[ga] dag-complete webhook ({'scheduled' if scheduled else 'job'}) -> {r.status_code}")
    except Exception as e:
        _log.error(f"[ga] dag-complete webhook failed: {e}")
    return True


def update_integration_status(params, is_synced, error=None):
    """Write the sync result straight to ``app.data_integrations`` FROM THE DAG.

    The DAG is the source of truth for the integration sync status - not the Node
    reconciler cron (which used to stamp last_synced_date on a 30s interval). Rules:

      - success  -> is_synced=true, last_synced_date=NOW(), clear the error;
      - failure  -> is_sync_error=true, sync_error=<msg>, and last_synced_date is
                    LEFT UNTOUCHED (only a successful run advances the sync date).

    Scope: job/queue-triggered runs carry ``company_id`` -> that one workspace;
    scheduled all-workspace runs carry none -> every connected workspace of this
    integration type (exactly the ones the daily run just refreshed). Best-effort:
    a status-write hiccup is logged, never raised, so it can't fail the DAG."""
    integration_type = params.get("integration_type", "googleAnalytics")
    company_id = params.get("company_id")

    from dags.click_cdp_ai_dags.lib import config as ga_config
    from dags.click_cdp_ai_dags.lib import db
    conn_kwargs = ga_config.get_pg_conn_kwargs()
    if not conn_kwargs:
        _log.warning("[sync-status] Postgres not configured; skipping data_integrations update")
        return False

    if is_synced:
        set_sql = ("SET is_synced=true, last_synced_date=NOW(), "
                   "is_sync_error=false, sync_error=NULL, updated_date=NOW()")
        set_vals = ()
    else:
        set_sql = "SET is_sync_error=true, sync_error=%s, updated_date=NOW()"
        set_vals = ((str(error) if error else "Sync failed")[:2000],)

    if company_id:
        where_sql, where_vals = "WHERE integration_type=%s AND company_id=%s", (integration_type, company_id)
    else:
        where_sql, where_vals = "WHERE integration_type=%s AND is_connected=true", (integration_type,)

    sql = f"UPDATE app.data_integrations {set_sql} {where_sql}"
    sql_vals = set_vals + where_vals

    def _run(conn):
        with conn.cursor() as cur:
            cur.execute(sql, sql_vals)
            return cur.rowcount

    try:
        n = db.run_tx(conn_kwargs, _run)
        _log.info("[sync-status] %s is_synced=%s -> updated %s row(s)%s",
                  integration_type, bool(is_synced), n,
                  "" if company_id else " (all connected workspaces)")
        return True
    except Exception as exc:  # noqa: BLE001 - status write must never fail the DAG
        _log.error("[sync-status] data_integrations update failed: %s", exc)
        return False


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
    """Airflow DAG-level on_failure_callback (fires once, after task retries are
    exhausted): report the failure to Postgres via the webhook AND post a
    real-time Teams alert (Tier 1)."""
    params = _params(context)
    exception = context.get("exception", "Unknown error, try again.")
    _notify_teams_failure(context, params, exception)
    # DAG owns the integration status: record the error WITHOUT advancing last_synced_date.
    update_integration_status(params, is_synced=False, error=exception)
    return notify_dag_complete(params, is_synced=False, error=exception)


def _notify_teams_failure(context, params, exception):
    """Best-effort Tier 1 Teams alert. Never raises (callbacks must not fail)."""
    try:
        from dags.click_cdp_ai_dags.lib import teams_notify
        dag_id = task_id = run_id = None
        ti = context.get("task_instance") or context.get("ti")
        if ti is not None:
            dag_id = getattr(ti, "dag_id", None)
            task_id = getattr(ti, "task_id", None)
            run_id = getattr(ti, "run_id", None)
        if dag_id is None:
            dag = context.get("dag")
            dag_id = getattr(dag, "dag_id", None)
        teams_notify.send_failure_alert(
            dag_id=dag_id,
            integration_type=params.get("integration_type"),
            client=params.get("str_client_name"),
            error=exception,
            run_id=run_id,
            task_id=task_id,
        )
    except Exception as exc:  # noqa: BLE001
        _log.error(f"[teams] failure alert skipped: {exc}")


def _failed_task_ids(context):
    """Set of task_ids that ended in FAILED for this dag run (empty on error)."""
    try:
        from airflow.utils.state import State
        dag_run = context.get("dag_run")
        if dag_run is None:
            return set()
        return {ti.task_id for ti in dag_run.get_task_instances(state=State.FAILED)}
    except Exception:
        return set()


def make_orchestrator_failure_callback(child_trigger_task_ids):
    """DAG-level on_failure_callback for the GA *orchestrator*.

    The orchestrator triggers each child report DAG with ``failed_states=[FAILED]``,
    so a child failure also fails the orchestrator's trigger task and would fire a
    SECOND (rollup) Teams alert on top of the child's own (precise) alert. This
    callback suppresses that duplicate: when every failed task is a child-DAG
    trigger, the child already alerted, so we skip Teams here. The Node job-status
    webhook still fires either way (only the orchestrator carries job_id/company_id),
    and a failure in the orchestrator's OWN tasks (dag_start_monitor / report_success)
    still alerts.
    """
    child_trigger_task_ids = set(child_trigger_task_ids)

    def _callback(context):
        params = _params(context)
        exception = context.get("exception", "Unknown error, try again.")
        # DAG owns the integration status: record the error, do NOT touch last_synced_date.
        update_integration_status(params, is_synced=False, error=exception)
        # Always report job status to Node (the orchestrator owns job_id/company_id).
        notify_dag_complete(params, is_synced=False, error=exception)
        failed = _failed_task_ids(context)
        if failed and failed <= child_trigger_task_ids:
            _log.info("[teams] orchestrator failure is downstream child(ren) %s; "
                      "child alert already sent, skipping duplicate", sorted(failed))
            return True
        _notify_teams_failure(context, params, exception)
        return True

    return _callback


def report_success(results=None, **context):
    """Shared "Report" step for every integration DAG: tell the Node app the sync
    completed (dag-complete webhook, ``is_synced=True``). ``results`` is the
    (ignored) upstream task output so this can sit downstream of an expanded task.
    For scheduled all-workspace runs (no job_id/company_id) it reports with
    ``scheduled=true`` so last_synced_date is stamped on every connected workspace."""
    params = _params(context)
    # DAG owns the integration status: stamp is_synced=true + last_synced_date=NOW()
    # directly (source of truth). The webhook still fires for job status /
    # notifications / profile rebuild.
    update_integration_status(params, is_synced=True)
    return notify_dag_complete(params, is_synced=True)


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
    -> plan-based historical backfill (3 years for every tier by default), otherwise
    last_sync_date - overlap_days. ``report_key`` / ``prefix2`` / ``blob`` /
    ``default_days`` are kept for call-site compatibility; the control report name
    is derived from ``prefix2`` (the trailing ``_2`` is stripped).
    """
    from dags.click_cdp_ai_dags.lib import pg_state
    report = prefix2[:-2] if prefix2.endswith("_2") else prefix2
    return pg_state.resolve_start_date(dict_config["client"], report)


# --------------------------------------------------------------------------- #
# Data-quality recording (sampling / (other)-row / thresholding / totals drift)
# --------------------------------------------------------------------------- #
def record_report_quality(client, report, property_id, quality, df=None,
                          metric_cols=("sessions",), start_date=None):
    """Persist a report's GA4 data-quality signals to ``ga_report_quality``.

    ``quality`` is the dict from ``GoogleAnalytics.extract_quality`` (compute it
    on the FIRST page, before pagination reassigns ``response``). ``df`` is the
    fully-paginated frame; the named ``metric_cols`` are summed and compared
    against GA's own TOTAL to quantify (other)-row loss. Best-effort.
    """
    from dags.click_cdp_ai_dags.lib import pg_state
    summed = {}
    if df is not None and hasattr(df, "columns"):
        for col in metric_cols:
            if col in df.columns:
                try:
                    summed[col] = float(df[col].sum())
                except Exception:  # noqa: BLE001  - non-numeric column, skip
                    pass
    return pg_state.record_report_quality(
        client, report, str(property_id), quality,
        summed_metrics=summed, start_date=start_date)
