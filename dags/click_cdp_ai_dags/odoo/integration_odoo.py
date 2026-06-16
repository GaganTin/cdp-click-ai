#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Consolidated Odoo integration DAG (click_cdp_ai).

ONE family for both the daily sweep and the "Sync Data" click (replaces the old
odoo_landing_* + odoo_trial_* split). Same shape as integration_shopify: each
client is one mapped ``sync_client`` task; views run sequentially within a client
(sale -> purchase -> inventory -> membership) while different clients run in
parallel. The neutral ``commerce`` layer is refreshed inline per client.

Odoo reads each client's OWN Odoo Postgres (resolved per task from the App DB) and
full-replaces the odoo.* raw tables, so there is no incremental window here.

Set ``ODOO_API_POOL`` to add a global ceiling across all runs.
"""

import os
from datetime import datetime, timedelta

from airflow.decorators import dag, task
from airflow.models import Param

from dags.click_cdp_ai_dags.lib import app_state
from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import trial_flow as tf
from dags.click_cdp_ai_dags.lib import odoo_landing
from dags.click_cdp_ai_dags.lib import commerce_integration
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("odoo")

_DEFAULT_ARGS = ga_config.pool_default_args("cdp_ai_odoo_api_pool", "ODOO_API_POOL")

# Views run in series within a client (mirrors the old orchestrator order).
_VIEWS = ("sale", "purchase", "inventory", "membership")


@dag(
    schedule="@daily",
    start_date=datetime(2024, 1, 1),
    max_active_runs=16,
    max_active_tasks=8,
    catchup=False,
    default_args=_DEFAULT_ARGS,
    tags=["cdp-click-ai", "data_extraction", "odoo", "integration"],
    owner_links={"capsuite": "https://capsuite.co"},
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        "is_debugging": Param(False, type=["boolean", "string"]),
        "dag_run_id": Param(None, type=["string", "null"]),
        "company_id": Param(None, type=["string", "null"]),
        "job_id": Param(None, type=["string", "null"]),
        "integration_type": Param("odoo", type=["string", "null"]),
    },
    on_failure_callback=tf.on_dag_failure_callback,
)
def click_cdp_ai_integration_odoo():

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def get_config(**context):
        str_client_name, _is_debugging, _run_id = tf.get_params(context)
        return app_state.build_odoo_configs(str_client_name=str_client_name)

    @task(retries=2, retry_delay=timedelta(seconds=10))
    def sync_client(dict_config, **context):
        client = dict_config["client"]
        _log.info("%s sync start", ctx(client))
        errors = []

        def _step(label, fn):
            try:
                fn()
            except Exception as error:  # noqa: BLE001
                _log.error("%s %s failed: %s", ctx(client), label, error)
                errors.append((label, error))

        for view in _VIEWS:
            _step(view, lambda v=view: odoo_landing.run_view(dict_config, v))
        _step("commerce_build", lambda: commerce_integration.build_for_client(client, platform="odoo"))

        if errors:
            from dags.click_cdp_ai_dags.lib import scheduled as sch
            sch.notify_and_raise(
                f"Odoo Sync - {len(errors)} step error(s)", client, errors[0][1], context
            )
        _log.info("%s sync done", ctx(client))
        return dict_config

    @task(trigger_rule="all_success")
    def report_success(results, **context):
        return tf.report_success(results, **context)

    results = sync_client.expand(dict_config=get_config())
    report_success(results)


click_cdp_ai_integration_odoo()
