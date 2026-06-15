#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared helpers for the API-triggered ("Sync Data") trial-flow DAGs.

The Node integration queue triggers these DAGs with
``conf = {str_client_name, company_id, integration_type, job_id, is_debugging}``
and the orchestrator reports the outcome back to the Node app via the
``/api/data-integrations/webhook/dag-complete`` endpoint, which flips
``app.integration_sync_jobs`` + ``app.data_integrations`` in Postgres.

This is exactly the contract the consolidated GA pipeline already uses, so the
implementation delegates to lib/ga_reports - the commerce-platform
DAGs (shopify / shopline / odoo) just import it under the trial_flow name.
"""

from dags.click_cdp_ai_dags.lib import ga_reports as _ga

# Re-exported helpers (same behavior as the GA family; integration_type comes
# from the trigger conf, so the webhook updates the right integration row).
get_params = _ga.get_params
notify_dag_complete = _ga.notify_dag_complete
on_dag_start_callback = _ga.on_dag_start_callback
on_dag_failure_callback = _ga.on_dag_failure_callback


def report_success(**context):
    """PythonOperator callable: tell the Node app the sync completed.

    No-op for scheduled all-workspace runs (no job_id/company_id in conf).
    """
    dag_run = context.get("dag_run")
    params = (dag_run.conf if dag_run and dag_run.conf else {}) or {}
    return notify_dag_complete(params, is_synced=True)
