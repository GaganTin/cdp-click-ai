#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Commerce FULL-REBUILD utility — rebuild the neutral commerce.* layer for every
client+platform from the existing per-platform raw schemas.

NOTE: the normal flow does NOT need this. Each platform DAG (integration_shopify
/ _shopline / _odoo) refreshes its OWN commerce slice inline per client right
after the raw lands. This DAG exists only as a manual "rebuild everything"
utility -- e.g. after a commerce_integration mapping change or a schema migration
-- so it is unscheduled and triggered by hand.

One mapped task per (client, platform): scoped DELETE + INSERT...SELECT,
idempotent. max_active_runs raised so a manual full rebuild fans out across many
clients instead of serialising.
"""

import os
from datetime import datetime, timedelta

from airflow.decorators import dag, task

from dags.click_cdp_ai_dags.lib import app_state
from dags.click_cdp_ai_dags.lib import scheduled as sch
from dags.click_cdp_ai_dags.lib import commerce_integration

os.environ["no_proxy"] = "*"


@dag(
    schedule=None,
    start_date=datetime(2024, 1, 1),
    max_active_runs=16,
    max_active_tasks=8,
    catchup=False,
    tags=["cdp-click-ai", "commerce", "integration", "utility"],
    owner_links={"capsuite": "https://capsuite.co"},
)
def click_cdp_ai_commerce_landing():

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def get_config(**context):
        try:
            # ALL connected clients (trial + contracted) - the build is a scoped
            # DELETE + INSERT...SELECT over whatever raw exists, so it is cheap
            # and idempotent for everyone.
            cfgs = [{"client": c["client"], "platform": "shopify"}
                    for c in app_state.build_shopify_configs()]
            cfgs += [{"client": c["client"], "platform": "shopline"}
                     for c in app_state.build_shopline_configs()]
            cfgs += [{"client": c["client"], "platform": "odoo"}
                     for c in app_state.build_odoo_configs()]
            return cfgs
        except Exception as error:
            sch.notify_and_raise("Commerce Integration - Cannot Get Config", "N/A", error, context)

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def build(cfg, **context):
        client, platform = cfg.get("client", "N/A"), cfg.get("platform", "shopify")
        try:
            commerce_integration.build_for_client(client, platform=platform)
        except Exception as error:
            sch.notify_and_raise("Commerce Integration - General Error", f"{client}/{platform}", error, context)
        return cfg

    build.expand(cfg=get_config())


click_cdp_ai_commerce_landing()
