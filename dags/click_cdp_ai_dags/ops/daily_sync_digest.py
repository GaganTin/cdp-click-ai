#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Daily sync digest DAG (Tier 2 Teams notification).

Runs once a morning, AFTER the integration DAGs' ``@daily`` runs have had time to
finish, and posts one Adaptive Card summarising the last 24h: hard failures,
tasks that recovered on retry, clients that synced but loaded 0 rows, and a
healthy per-platform roll-up. All the assembly lives in lib/digest; this DAG is
just the schedule + a single task.

It is a NO-OP until the ``cdp_ai_teams_webhook_url`` Airflow Variable (or the
``TEAMS_WEBHOOK_URL`` env var) is set - see lib/teams_notify - so it is safe to
deploy before the Teams endpoint exists.
"""

from datetime import datetime, timedelta

from airflow.decorators import dag, task
from airflow.models import Param

from dags.click_cdp_ai_dags.lib import digest
from dags.click_cdp_ai_dags.lib.log import get_logger

_log = get_logger("ops.digest")


@dag(
    # 09:00 daily - the integration DAGs run @daily (00:00) and finish well before.
    schedule="0 9 * * *",
    start_date=datetime(2024, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["cdp-click-ai", "ops", "notification", "digest"],
    owner_links={"capsuite": "https://capsuite.co"},
    params={
        # Override the look-back window (hours) for an ad-hoc manual trigger.
        "lookback_hours": Param(24, type="integer"),
    },
)
def cdp_click_ai_daily_sync_digest():

    @task(retries=1, retry_delay=timedelta(minutes=2))
    def send_digest(**context):
        conf = (context.get("dag_run").conf if context.get("dag_run") else {}) or {}
        lookback = int(conf.get("lookback_hours", 24))
        report = digest.run_and_send(lookback_hours=lookback)
        _log.info("daily digest complete: %s failed, %s recovered",
                  len(report["failed"]), len(report["recovered"]))
        return True

    send_digest()


cdp_click_ai_daily_sync_digest()
