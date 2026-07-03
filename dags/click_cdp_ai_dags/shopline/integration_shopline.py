#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Consolidated Shopline integration DAG (click_cdp_ai).

ONE family for both the daily sweep and the "Sync Data" click (replaces the old
shopline_landing_* + shopline_trial_* split). Same shape as integration_shopify:
dynamic task mapping fans each client out to its own ``sync_client`` instance;
datasets run sequentially within a client (one store at a time) while different
clients run in parallel (max_active_runs / max_active_tasks). The neutral
``commerce`` layer is refreshed inline per client. First-run backfill depth is
plan-based (3 years for every tier by default) via lib/pg_state.

Set ``SHOPLINE_API_POOL`` to add a global API ceiling across all runs.
"""

import os
from datetime import datetime, timedelta

from airflow.decorators import dag, task
from airflow.models import Param

from dags.click_cdp_ai_dags.lib import app_state
from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import trial_flow as tf
from dags.click_cdp_ai_dags.lib import shopline_landing
from dags.click_cdp_ai_dags.lib import commerce_integration
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("shopline")

_DEFAULT_ARGS = ga_config.pool_default_args("cdp_ai_shopline_api_pool", "SHOPLINE_API_POOL")

_DATASETS = ("order", "order_line", "product", "customer", "inventory_level")


@dag(
    schedule="@daily",
    start_date=datetime(2024, 1, 1),
    max_active_runs=16,
    max_active_tasks=8,
    catchup=False,
    default_args=_DEFAULT_ARGS,
    tags=["cdp-click-ai", "data_extraction", "shopline", "integration"],
    owner_links={"capsuite": "https://capsuite.co"},
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        "is_debugging": Param(False, type=["boolean", "string"]),
        "dag_run_id": Param(None, type=["string", "null"]),
        "company_id": Param(None, type=["string", "null"]),
        "job_id": Param(None, type=["string", "null"]),
        "integration_type": Param("shopline", type=["string", "null"]),
    },
    on_failure_callback=tf.on_dag_failure_callback,
)
def click_cdp_ai_integration_shopline():

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def get_config(**context):
        str_client_name, _is_debugging, _run_id = tf.get_params(context)
        return app_state.build_shopline_configs(str_client_name=str_client_name)

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

        for dataset in _DATASETS:
            _step(dataset, lambda d=dataset: shopline_landing.run_dataset(dict_config, d))
        _step("commerce_build", lambda: commerce_integration.build_for_client(client, platform="shopline"))

        if errors:
            from dags.click_cdp_ai_dags.lib import scheduled as sch
            sch.notify_and_raise(
                f"Shopline Sync - {len(errors)} step error(s)", client, errors[0][1], context
            )
        _log.info("%s sync done", ctx(client))
        return dict_config

    @task(trigger_rule="all_success")
    def report_success(results, **context):
        return tf.report_success(results, **context)

    results = sync_client.expand(dict_config=get_config())
    report_success(results)


click_cdp_ai_integration_shopline()
