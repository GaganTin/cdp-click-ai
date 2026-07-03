#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Google Search Console - Keyword performance DAG.

Extracted out of the GA content reports. This is a SEARCH CONSOLE report (it uses
the GSC service account + the site_url, not a GA property), so it runs on its own
and ONLY for workspaces whose Google Search Console integration is connected.

dag_id ``click_cdp_ai_gsc_keyword_performance``. Trigger it from the GSC sync flow
(the Node integration queue maps googleSearchConsole -> this dag_id), the same way
the GA pipeline is triggered:

    POST {AIRFLOW_BASE_URL}/api/v1/dags/click_cdp_ai_gsc_keyword_performance/dagRuns
    conf = {str_client_name, company_id, job_id, integration_type, is_debugging, dag_run_id}

Two ways it runs (mirrors the GA orchestrator):
  - with str_client_name -> that one workspace (reports completion via the Postgres
    dag-complete webhook);
  - no conf (daily schedule) -> every GSC-connected workspace.

Config + watermark are read from Postgres (lib/pg_config + lib/pg_state); writes go
to ga_landing.keyword_performance via lib/storage, keyed on capsuite_ref/company_id.
"""

import os
from datetime import datetime, timedelta

import pandas as pd
from airflow.decorators import dag, task
from airflow.models import Param

from dags.utils.google_search_console import GoogleSearchConsole
from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import storage as ga_storage
from dags.click_cdp_ai_dags.lib import pg_config
from dags.click_cdp_ai_dags.lib import pg_state
from dags.click_cdp_ai_dags.lib import ga_reports as tf
from dags.click_cdp_ai_dags.lib.transforms import transform_keyword_response
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("gsc")

# Set GSC_API_POOL to an Airflow pool name (e.g. "gsc_api") to cap GSC API concurrency
# across ALL runs (manual + daily); unset = no pool. Create the pool first.
_DEFAULT_ARGS = ga_config.pool_default_args("cdp_ai_gsc_api_pool", "GSC_API_POOL")


@dag(
    schedule="@daily",
    start_date=datetime(2024, 1, 1),
    max_active_runs=16,
    max_active_tasks=8,
    catchup=False,
    default_args=_DEFAULT_ARGS,
    tags=["cdp-click-ai", "data_extraction", "gsc", "keyword", "integration"],
    owner_links={"capsuite": "https://capsuite.co"},
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        "is_debugging": Param(False, type=["boolean", "string"]),
        "dag_run_id": Param(None, type=["string", "null"]),
        "company_id": Param(None, type=["string", "null"]),
        "job_id": Param(None, type=["string", "null"]),
        "integration_type": Param("googleSearchConsole", type=["string", "null"]),
    },
    on_failure_callback=tf.on_dag_failure_callback,
)
def click_cdp_ai_gsc_keyword_performance():

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def get_config(**context):
        _log.info("Start running get_config")
        str_client_name, is_debugging, _ = tf.get_params(context)
        return pg_config.build_configs(str_client_name, is_debugging, source="googleSearchConsole")

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_keyword_performance(dict_config):
        str_client_name = dict_config["client"]
        _log.info("%s create_keyword_performance", ctx(str_client_name))
        if "keyword_performance" not in dict_config["report"]:
            _log.info("%s keyword_performance not in report set; skipping", ctx(str_client_name))
            return dict_config
        if not dict_config.get("site_url"):
            _log.info("%s no site_url (GSC not connected); skipping", ctx(str_client_name))
            return dict_config
        try:
            # Resume point from ga_sync_control: first run -> plan-based backfill
            # (3 years for every tier by default), then daily incremental overlap.
            str_start_date = pg_state.resolve_start_date(str_client_name, "keyword_performance")
            str_end_date = datetime.today().strftime("%Y-%m-%d")
            if str_start_date > str_end_date:
                _log.info("%s no new date window to handle", ctx(str_client_name))
                return dict_config

            # ONE windowed query with the `date` dimension (paginated at 25k rows),
            # instead of one request per calendar day. A 3-year backfill drops from
            # ~1,095 sequential calls to a handful of paginated pages.
            gscConnector = GoogleSearchConsole(ga_config.get_gsc_service_account(), dict_config["site_url"])
            dim_date = getattr(gscConnector, "DIM_DATE", "date")  # standard GSC dimension
            list_dimensions = [dim_date, gscConnector.DIM_QUERY]

            num_row_limit = 25000
            max_pages = 2000  # safety bound (50M rows) so a runaway never loops forever
            frames = []
            num_start_row = 0
            for _page in range(max_pages):
                response = gscConnector.get_search_results(
                    str_start_date, str_end_date, list_dimensions, num_start_row, num_row_limit
                )
                rows = response.get("rows") if isinstance(response, dict) else None
                if not rows:
                    break
                frames.append(transform_keyword_response(response, list_dimensions))
                if len(rows) < num_row_limit:
                    break
                num_start_row += num_row_limit

            if not frames:
                _log.info("%s no keyword data in window %s..%s", ctx(str_client_name), str_start_date, str_end_date)
                # Connected but produced nothing -> record a 0-row run so the daily
                # digest flags it (this branch never reaches persist_by_date).
                from dags.click_cdp_ai_dags.lib import pg_loader
                pg_loader.record_zero_row_run(str_client_name, "keyword_performance")
                return dict_config

            df_all = pd.concat(frames, axis=0).reset_index(drop=True)
            df_all["capsuite_ref"] = str_client_name
            # Ranks are PER DAY (highest first), matching the original per-day ranking.
            df_all["rank_by_impressions"] = (
                df_all.groupby("date")["impressions"].rank(method="first", ascending=False).astype(int)
            )
            df_all["rank_by_clicks"] = (
                df_all.groupby("date")["clicks"].rank(method="first", ascending=False).astype(int)
            )
            _log.info("%s loaded %d keyword rows across %s..%s",
                      ctx(str_client_name), len(df_all), str_start_date, str_end_date)

            # 'date' is YYYY-MM-DD; persist groups by it (dashed_source_date).
            ga_storage.persist_by_date(df_all, str_client_name, "keyword_performance", dashed_source_date=True)
        except Exception as error:
            _log.error("%s keyword_performance failed: %s", ctx(str_client_name), error)
            raise
        return dict_config

    @task(trigger_rule="all_success")
    def report_success(results, **context):
        return tf.report_success(results, **context)

    results = create_keyword_performance.expand(dict_config=get_config())
    report_success(results)


click_cdp_ai_gsc_keyword_performance()
