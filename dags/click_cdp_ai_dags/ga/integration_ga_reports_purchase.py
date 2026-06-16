#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GA landing - Purchase purpose group.

Handles:
  purchase_list

Writes to Azure Blob and/or Postgres per the ga_storage_targets Variable (hybrid).
"""

import os
from datetime import datetime, timedelta

import pandas as pd
from airflow.decorators import dag, task
from airflow.models import Param

from dags.utils.google_analytics import GoogleAnalytics
from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import storage as ga_storage
from dags.click_cdp_ai_dags.lib import ga_reports as tf
from dags.click_cdp_ai_dags.lib.transforms import transform_purchase_response
from google.analytics.data_v1beta.types import Filter, FilterExpression
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("ga.purchase")

# Cap GA API concurrency via an Airflow pool: set the ga_api_pool Airflow
# Variable (UI), or the GA_API_POOL env var; unset = no pool (create pool first).
_DEFAULT_ARGS = ga_config.pool_default_args("cdp_ai_ga_api_pool", "GA_API_POOL")


@dag(
    schedule=None,
    start_date=datetime(2024, 1, 1),
    max_active_runs=16,
    max_active_tasks=8,
    catchup=False,
    default_args=_DEFAULT_ARGS,
    tags=["cdp-click-ai", "data_extraction", "ga", "purchase", "integration"],
    owner_links={"capsuite": "https://capsuite.co"},
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        "is_debugging": Param(False, type=["boolean", "string"]),
        "dag_run_id": Param(None, type=["string", "null"]),
    },
)
def click_cdp_ai_integration_ga_reports_purchase():

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def get_config(**context):
        _log.info("Start running get_config")
        str_client_name, is_debugging, _ = tf.get_params(context)
        return tf.build_configs(str_client_name, is_debugging)

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_purchase_list(dict_config):
        _log.info("Start running create_purchase_list")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "purchase_list" not in dict_config["report"]:
            _log.info("Purchase List needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "purchase_list", "purchase_list_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [
                    gaConnector.DIM_DATE, gaConnector.DIM_TRXN_ID, gaConnector.DIM_CAPSUITE_SID,
                    gaConnector.DIM_CAPSUITE_APID, gaConnector.DIM_CAPSUITE_UID, gaConnector.DIM_CAPSUITE_IDENTIFIER,
                ]
                list_metrics = []

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today', num_offset=0,
                    list_dimension_filters=FilterExpression(
                        filter=Filter(
                            field_name="eventName",
                            string_filter=Filter.StringFilter(value="purchase"),
                        )))
                num_row_count = type(response).to_dict(response)['row_count']
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_path_exploration = transform_purchase_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset,
                                list_dimension_filters=FilterExpression(
                                    filter=Filter(
                                        field_name="eventName",
                                        string_filter=Filter.StringFilter(value="purchase"),
                                    )))
                            list_path_exploration += transform_purchase_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_path_exploration)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            ga_storage.persist_by_date(df, str_client_name, "purchase_list")
        except Exception as error:
            _log.error(f"Error generating purchase list files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    task_get_config = get_config()
    create_purchase_list.expand(dict_config=task_get_config)


click_cdp_ai_integration_ga_reports_purchase()
