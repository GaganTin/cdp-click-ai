#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""click_cdp_ai - GA landing orchestrator (the single, consolidated pipeline).

This is the ONE GA landing orchestrator (the earlier duplicate family was removed
and this consolidated pipeline uses the ``integration_ga_reports_*`` name). dag_id
``click_cdp_ai_integration_ga_reports``.

Two ways it runs:
  - API / queue trigger with conf {str_client_name, company_id, job_id, ...}
    -> syncs that one workspace (the "Sync Data" button / initial backfill) and
       reports completion to Postgres via the dag-complete webhook.
  - daily schedule (no conf) -> syncs every GA-connected workspace; the per-report
    incremental watermark (lib/pg_state) keeps each daily run cheap.

Broken down by purpose into chained child DAGs:
    - click_cdp_ai_integration_ga_reports_path_funnel
    - click_cdp_ai_integration_ga_reports_content
    - click_cdp_ai_integration_ga_reports_purchase
    - click_cdp_ai_integration_ga_reports_ecommerce     (catalog-driven: item / transaction)
    - click_cdp_ai_integration_ga_reports_acquisition   (catalog-driven: session/first-user/channel/landing)
    - click_cdp_ai_integration_ga_reports_audience      (catalog-driven: demographics/audience/tech/geo/interest/returning)

Config + run status live in Postgres (app.* tables); see lib/pg_config, lib/pg_state
and lib/ga_reports. NOTE: keyword_performance is a Search Console report and is NOT
run here - it lives in click_cdp_ai_gsc_keyword_performance, triggered by the GSC
sync flow.
"""

import os
from datetime import datetime

from airflow.decorators import dag
from airflow.models import Param
from airflow.operators.python import PythonOperator
from airflow.operators.trigger_dagrun import TriggerDagRunOperator
from airflow.utils.state import State

from dags.click_cdp_ai_dags.lib import ga_reports as tf
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("ga.orchestrator")

# Pass-through conf templates so the child group DAGs receive the same trigger
# parameters as this orchestrator (empty string when absent, never the literal "None").
_CHILD_CONF = {
    "str_client_name": "{{ (dag_run.conf.get('str_client_name') or '') if dag_run.conf else '' }}",
    "is_debugging": "{{ (dag_run.conf.get('is_debugging', False) if dag_run.conf else False) }}",
    "dag_run_id": "{{ (dag_run.conf.get('dag_run_id') or '') if dag_run.conf else '' }}",
}


@dag(
    # Daily auto-sync; API/queue triggers run on top of the schedule on demand.
    schedule="@daily",
    start_date=datetime(2024, 1, 1),
    # Allow many per-workspace syncs (40-50 clients) to run concurrently instead
    # of serialising them one-at-a-time. Real API concurrency is bounded inside
    # the child report DAGs (max_active_tasks) and, in production, by Airflow
    # pools sized to the GA quota (see module docstring / repo notes).
    max_active_runs=16,
    catchup=False,
    tags=["cdp-click-ai", "data_extraction", "ga", "orchestrator", "integration"],
    owner_links={"capsuite": "https://capsuite.co"},
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        "is_debugging": Param(False, type=["boolean", "string"]),
        "dag_run_id": Param(None, type=["string", "null"]),
        # Passed by the Node integration queue so the dag-complete webhook can
        # update the right job / integration row.
        "company_id": Param(None, type=["string", "null"]),
        "job_id": Param(None, type=["string", "null"]),
        "integration_type": Param("googleAnalytics", type=["string", "null"]),
    },
    # Child report DAGs each send their own (precise) failure alert; suppress the
    # orchestrator's duplicate when the failure is just a child trigger. Keep the
    # task ids here in sync with the _trigger(...) calls below.
    on_failure_callback=tf.make_orchestrator_failure_callback(
        ["run_path_funnel", "run_content", "run_purchase",
         "run_ecommerce", "run_acquisition", "run_audience", "run_retention"]
    ),
)
def click_cdp_ai_integration_ga_reports():

    def _trigger(task_id, trigger_dag_id):
        return TriggerDagRunOperator(
            task_id=task_id,
            trigger_dag_id=trigger_dag_id,
            # Unique child run id per orchestrator run, so concurrent per-workspace
            # syncs (and the daily run) never collide on the same child run id.
            trigger_run_id="{{ run_id }}__" + task_id,
            conf=_CHILD_CONF,
            wait_for_completion=True,
            poke_interval=20,
            # run id is already unique -> no reset needed (reset would clobber a
            # sibling run of the same child DAG).
            reset_dag_run=False,
            allowed_states=[State.SUCCESS],
            failed_states=[State.FAILED],
        )

    task_dag_start = PythonOperator(
        task_id='dag_start_monitor',
        python_callable=tf.on_dag_start_callback,
        provide_context=True,
        trigger_rule='all_success',
    )

    task_path_funnel = _trigger('run_path_funnel', 'click_cdp_ai_integration_ga_reports_path_funnel')
    task_content = _trigger('run_content', 'click_cdp_ai_integration_ga_reports_content')
    task_purchase = _trigger('run_purchase', 'click_cdp_ai_integration_ga_reports_purchase')
    task_ecommerce = _trigger('run_ecommerce', 'click_cdp_ai_integration_ga_reports_ecommerce')
    task_acquisition = _trigger('run_acquisition', 'click_cdp_ai_integration_ga_reports_acquisition')
    task_audience = _trigger('run_audience', 'click_cdp_ai_integration_ga_reports_audience')
    task_retention = _trigger('run_retention', 'click_cdp_ai_integration_ga_reports_retention')

    # Fires only when every report group succeeded -> reports completion to Postgres.
    task_report_success = PythonOperator(
        task_id='report_success',
        python_callable=tf.report_success,
        provide_context=True,
        trigger_rule='all_success',
    )

    _report_groups = [
        task_path_funnel, task_content, task_purchase,
        task_ecommerce, task_acquisition, task_audience, task_retention,
    ]
    task_dag_start >> _report_groups
    _report_groups >> task_report_success


click_cdp_ai_integration_ga_reports()
