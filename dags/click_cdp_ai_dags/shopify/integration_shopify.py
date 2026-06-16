#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Consolidated Shopify integration DAG (click_cdp_ai).

ONE family for both the daily sweep and the "Sync Data" click, mirroring the
consolidated GA pipeline (replaces the old shopify_landing_* + shopify_trial_*
split, which duplicated every view DAG and serialised manual syncs at
max_active_runs=1).

Two ways it runs:
  - daily schedule (no conf) -> every connected Shopify workspace, MINUS any that
    has an in-flight manual sync job (app_state dedup);
  - API/queue trigger with conf {str_client_name, company_id, job_id, ...} -> that
    one workspace, and reports completion to the Node app via the dag-complete
    webhook (which flips the job + integration and rebuilds that workspace's
    unified profiles).

Concurrency (handles 40-50 clients): dynamic task mapping fans each client out to
its own ``sync_client`` instance. ``max_active_runs`` caps concurrent manual
dag-runs; ``max_active_tasks`` caps concurrent clients inside the one daily run.
Shopify's "one bulk operation per store" limit is preserved because each client's
datasets run SEQUENTIALLY inside its single mapped task -- different clients are
different stores, so running them in parallel is safe. Set ``SHOPIFY_API_POOL``
to an Airflow pool to add a global ceiling across all runs if needed.

The neutral ``commerce`` layer is refreshed inline per client right after its raw
lands, so report_success -> webhook -> profile rebuild sees fresh commerce data.
"""

import os
from datetime import datetime, timedelta

from airflow.decorators import dag, task
from airflow.models import Param

from dags.click_cdp_ai_dags.lib import app_state
from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import trial_flow as tf
from dags.click_cdp_ai_dags.lib import shopify_landing
from dags.click_cdp_ai_dags.lib import commerce_integration
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("shopify")

# Optional global API ceiling across ALL runs (manual + daily). Create the pool
# first, then set SHOPIFY_API_POOL to its name; unset = no pool.
_DEFAULT_ARGS = ga_config.pool_default_args("cdp_ai_shopify_api_pool", "SHOPIFY_API_POOL")

# Per-client dataset order. Datasets run in series within one client so the store
# never has two concurrent bulk operations; refunds ride the orders window.
_DATASETS = ("order", "order_line", "product", "product_detail", "product_image")


@dag(
    schedule="@daily",
    start_date=datetime(2024, 1, 1),
    max_active_runs=16,
    max_active_tasks=8,
    catchup=False,
    default_args=_DEFAULT_ARGS,
    tags=["cdp-click-ai", "data_extraction", "shopify", "integration"],
    owner_links={"capsuite": "https://capsuite.co"},
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        "is_debugging": Param(False, type=["boolean", "string"]),
        "dag_run_id": Param(None, type=["string", "null"]),
        # Passed by the Node integration queue so the dag-complete webhook can
        # update the right job / integration row.
        "company_id": Param(None, type=["string", "null"]),
        "job_id": Param(None, type=["string", "null"]),
        "integration_type": Param("shopify", type=["string", "null"]),
    },
    on_failure_callback=tf.on_dag_failure_callback,
)
def click_cdp_ai_integration_shopify():

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def get_config(**context):
        str_client_name, _is_debugging, _run_id = tf.get_params(context)
        return app_state.build_shopify_configs(str_client_name=str_client_name)

    @task(retries=2, retry_delay=timedelta(seconds=10))
    def sync_client(dict_config, **context):
        """Sync one client end-to-end: raw datasets in series, then commerce build.

        Each dataset is attempted even if an earlier one failed (so a partial sync
        lands as much as possible), but any error fails the task at the end so
        Airflow retries / the failure webhook fire.
        """
        client = dict_config["client"]
        is_trial = bool(dict_config.get("is_trial", False))
        _log.info("%s sync start (is_trial=%s)", ctx(client), is_trial)
        errors = []

        def _step(label, fn):
            try:
                fn()
            except Exception as error:  # noqa: BLE001 - collected, re-raised below
                _log.error("%s %s failed: %s", ctx(client), label, error)
                errors.append((label, error))

        for dataset in _DATASETS:
            _step(dataset, lambda d=dataset: shopify_landing.run_dataset(dict_config, d, is_trial=is_trial))
        _step("refunds", lambda: shopify_landing.run_refunds(dict_config, is_trial=is_trial))
        _step("customer", lambda: shopify_landing.run_dataset(dict_config, "customer", is_trial=is_trial))
        _step("inventory_level", lambda: shopify_landing.run_dataset(dict_config, "inventory_level", is_trial=is_trial))
        # Refresh the neutral commerce layer from whatever raw landed (idempotent).
        _step("commerce_build", lambda: commerce_integration.build_for_client(client, platform="shopify"))

        if errors:
            from dags.click_cdp_ai_dags.lib import scheduled as sch
            sch.notify_and_raise(
                f"Shopify Sync - {len(errors)} step error(s)", client, errors[0][1], context
            )
        _log.info("%s sync done", ctx(client))
        return dict_config

    @task(trigger_rule="all_success")
    def report_success(results, **context):
        return tf.report_success(results, **context)

    results = sync_client.expand(dict_config=get_config())
    report_success(results)


click_cdp_ai_integration_shopify()
