#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared error helper for the SCHEDULED (daily) landing DAGs.

The scheduled flows have no sync job to report to (jobs only exist for
API-triggered "Sync Data" runs), so failure handling is: log loudly with full
context, then re-raise so the Airflow task fails and its retries / alerting
take over. Kept as its own module so the commerce-platform DAG tasks stay
two-liners and the trial flow (lib/trial_flow) can reuse it.
"""

import traceback
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("scheduled")


def notify_and_raise(subject, client, error, context=None):
    """Log a structured failure line for ``client`` and re-raise ``error``.

    ``subject`` is a short human label (e.g. "Shopify Sale - General Error"),
    ``client`` the capsuite_ref (or "N/A"), ``context`` the Airflow task
    context (used only to enrich the log - never required).
    """
    dag_id = task_id = run_id = None
    try:
        if context:
            ti = context.get("task_instance") or context.get("ti")
            if ti is not None:
                dag_id, task_id, run_id = ti.dag_id, ti.task_id, ti.run_id
    except Exception:
        pass

    _log.info(f"[ALERT] {subject} | client={client} | dag={dag_id} task={task_id} run={run_id}")
    _log.error(f"[ALERT] {type(error).__name__}: {error}")
    traceback.print_exc()

    if isinstance(error, BaseException):
        raise error
    raise RuntimeError(f"{subject} ({client}): {error}")
