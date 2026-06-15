#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GA landing - UTM purpose group.

Handles:
  utm_performance -> [utm_ad_performance, utm_daily_performance,
                      utm_daily_full_param_performance, utm_daily_utm_id_performance,
                      country_performance]

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
from dags.click_cdp_ai_dags.lib.transforms import (
    transform_utm_response,
    transform_utm_daily_response,
    transform_utm_daily_full_param_response,
    transform_utm_daily_utm_id_response,
    transform_country_response,
    transform_utm_ad_response,
)
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("ga.utm")

# Set GA_API_POOL to an Airflow pool name (e.g. "ga_api") to cap GA API concurrency
# across ALL runs (manual + daily); unset = no pool. Create the pool first.
GA_API_POOL = os.environ.get("GA_API_POOL")
_DEFAULT_ARGS = {"pool": GA_API_POOL} if GA_API_POOL else {}


@dag(
    schedule=None,
    start_date=datetime(2024, 1, 1),
    max_active_runs=16,
    max_active_tasks=8,
    catchup=False,
    default_args=_DEFAULT_ARGS,
    tags=["cdp-click-ai", "data_extraction", "ga", "utm", "integration"],
    owner_links={"capsuite": "https://capsuite.co"},
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        "is_debugging": Param(False, type=["boolean", "string"]),
        "dag_run_id": Param(None, type=["string", "null"]),
    },
)
def click_cdp_ai_integration_ga_reports_utm():

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def get_config(**context):
        _log.info("Start running get_config")
        str_client_name, is_debugging, _ = tf.get_params(context)
        return tf.build_configs(str_client_name, is_debugging)

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_utm_performance(dict_config):
        _log.info("Start running create_utm_performance")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "utm_performance" not in dict_config["report"]:
            _log.info("UTM Performance needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "utm_performance", "utm_performance_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [
                    gaConnector.DIM_DATE_HOUR_MINUTE, gaConnector.DIM_SESSION_SOURCE,
                    gaConnector.DIM_SESSION_MEDIUM, gaConnector.DIM_SESSION_CAMPAIGN_NAME,
                    gaConnector.DIM_SESSION_MANUAL_AD_CONTENT, gaConnector.DIM_SESSION_MANUAL_TERM,
                    gaConnector.DIM_SESSION_UTM_ID, gaConnector.DIM_COUNTRY, gaConnector.DIM_DEVICE_CATEGORY,
                ]
                list_metrics = [
                    gaConnector.MET_ACTIVE_USERS, gaConnector.MET_NEW_USERS, gaConnector.MET_BOUNCE_RATE,
                    gaConnector.MET_ENGAGEMENT_RATE, gaConnector.MET_AVERAGE_SESSION_DURATION, gaConnector.MET_SESSIONS,
                ]

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None)
                num_row_count = type(response).to_dict(response)['row_count']
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_utm_performance = transform_utm_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None)
                            list_utm_performance += transform_utm_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_utm_performance)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    tmp_df['date'] = tmp_df['date_hour_minute'].dt.date.apply(lambda x: x.strftime('%Y%m%d'))
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            ga_storage.persist_by_date(df, str_client_name, "utm_performance")
        except Exception as error:
            _log.error(f"Error generating UTM performance files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_utm_daily_performance(dict_config):
        _log.info("Start running create_utm_daily_performance")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "utm_daily_performance" not in dict_config["report"]:
            _log.info("UTM Daily Performance needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "utm_daily_performance", "utm_daily_performance_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [
                    gaConnector.DIM_DATE, gaConnector.DIM_SESSION_SOURCE, gaConnector.DIM_SESSION_MEDIUM,
                    gaConnector.DIM_SESSION_CAMPAIGN_NAME, gaConnector.DIM_COUNTRY, gaConnector.DIM_DEVICE_CATEGORY,
                ]
                list_metrics = [
                    gaConnector.MET_ACTIVE_USERS, gaConnector.MET_NEW_USERS, gaConnector.MET_BOUNCE_RATE,
                    gaConnector.MET_ENGAGEMENT_RATE, gaConnector.MET_AVERAGE_SESSION_DURATION, gaConnector.MET_SESSIONS,
                ]

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None)
                num_row_count = type(response).to_dict(response)['row_count']
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_utm_performance = transform_utm_daily_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None)
                            list_utm_performance += transform_utm_daily_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_utm_performance)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            ga_storage.persist_by_date(df, str_client_name, "utm_daily_performance")
        except Exception as error:
            _log.error(f"Error generating UTM daily performance files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_utm_daily_full_param_performance(dict_config):
        _log.info("Start running create_utm_daily_full_param_performance")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "utm_daily_full_param_performance" not in dict_config["report"]:
            _log.info("UTM Daily Full Param Performance needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "utm_daily_performance", "utm_daily_full_param_performance_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [
                    gaConnector.DIM_DATE, gaConnector.DIM_SESSION_SOURCE, gaConnector.DIM_SESSION_MEDIUM,
                    gaConnector.DIM_SESSION_CAMPAIGN_NAME, gaConnector.DIM_SESSION_MANUAL_AD_CONTENT,
                    gaConnector.DIM_SESSION_MANUAL_TERM, gaConnector.DIM_SESSION_UTM_ID,
                    gaConnector.DIM_COUNTRY, gaConnector.DIM_DEVICE_CATEGORY,
                ]
                list_metrics = [
                    gaConnector.MET_ACTIVE_USERS, gaConnector.MET_NEW_USERS, gaConnector.MET_BOUNCE_RATE,
                    gaConnector.MET_ENGAGEMENT_RATE, gaConnector.MET_AVERAGE_SESSION_DURATION, gaConnector.MET_SESSIONS,
                ]

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None)
                num_row_count = type(response).to_dict(response)['row_count']
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_utm_performance = transform_utm_daily_full_param_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None)
                            list_utm_performance += transform_utm_daily_full_param_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_utm_performance)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            ga_storage.persist_by_date(df, str_client_name, "utm_daily_full_param_performance")
        except Exception as error:
            _log.error(f"Error generating UTM daily full param performance files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_utm_daily_utm_id_performance(dict_config):
        _log.info("Start running create_utm_daily_utm_id_performance")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "utm_daily_utm_id_performance" not in dict_config["report"]:
            _log.info("UTM Daily UTM ID Performance needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "utm_daily_performance", "utm_daily_utm_id_performance_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [gaConnector.DIM_DATE, gaConnector.DIM_SESSION_UTM_ID]
                list_metrics = [
                    gaConnector.MET_ACTIVE_USERS, gaConnector.MET_NEW_USERS, gaConnector.MET_BOUNCE_RATE,
                    gaConnector.MET_ENGAGEMENT_RATE, gaConnector.MET_AVERAGE_SESSION_DURATION, gaConnector.MET_SESSIONS,
                ]

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None)
                num_row_count = type(response).to_dict(response)['row_count']
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_utm_performance = transform_utm_daily_utm_id_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None)
                            list_utm_performance += transform_utm_daily_utm_id_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_utm_performance)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            ga_storage.persist_by_date(df, str_client_name, "utm_daily_utm_id_performance")
        except Exception as error:
            _log.error(f"Error generating UTM daily utm id performance files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_country_performance(dict_config):
        _log.info("Start running create_country_performance")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "country_performance" not in dict_config["report"]:
            _log.info("Country Performance needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "country_performance", "country_performance_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [gaConnector.DIM_DATE, gaConnector.DIM_COUNTRY]
                list_metrics = [
                    gaConnector.MET_ACTIVE_USERS, gaConnector.MET_NEW_USERS, gaConnector.MET_BOUNCE_RATE,
                    gaConnector.MET_ENGAGEMENT_RATE, gaConnector.MET_AVERAGE_SESSION_DURATION, gaConnector.MET_SESSIONS,
                ]

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None)
                num_row_count = type(response).to_dict(response)['row_count']
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_utm_performance = transform_country_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None)
                            list_utm_performance += transform_country_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_utm_performance)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            ga_storage.persist_by_date(df, str_client_name, "country_performance")
        except Exception as error:
            _log.error(f"Error generating country performance files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_utm_ad_performance(dict_config):
        _log.info("Start running create_utm_ad_performance")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "utm_ad_performance" not in dict_config["report"]:
            _log.info("UTM Ad Performance needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "utm_ad_performance", "utm_ad_performance_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [
                    gaConnector.DIM_DATE, gaConnector.DIM_SESSION_SOURCE, gaConnector.DIM_SESSION_MEDIUM,
                    gaConnector.DIM_SESSION_CAMPAIGN_NAME, gaConnector.DIM_SESSION_UTM_ID,
                ]
                list_metrics = [
                    gaConnector.MET_AD_IMPRESSIONS, gaConnector.MET_AD_CLICKS,
                    gaConnector.MET_AD_COST, gaConnector.MET_AD_COST_PER_CLICK,
                ]

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None)
                num_row_count = type(response).to_dict(response)['row_count']
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_utm_performance = transform_utm_ad_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None)
                            list_utm_performance += transform_utm_ad_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_utm_performance)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            ga_storage.persist_by_date(df, str_client_name, "utm_ad_performance")
        except Exception as error:
            _log.error(f"Error generating UTM ad performance files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    task_get_config = get_config()
    task_utm_performance = create_utm_performance.expand(dict_config=task_get_config)
    task_utm_daily_performance = create_utm_daily_performance.expand(dict_config=task_utm_performance)
    task_utm_daily_full_param_performance = create_utm_daily_full_param_performance.expand(dict_config=task_utm_performance)
    task_utm_daily_utm_id_performance = create_utm_daily_utm_id_performance.expand(dict_config=task_utm_performance)
    task_country_performance = create_country_performance.expand(dict_config=task_utm_daily_performance)
    task_utm_ad_performance = create_utm_ad_performance.expand(dict_config=task_utm_performance)

    task_utm_performance >> [
        task_utm_ad_performance,
        task_utm_daily_performance,
        task_utm_daily_full_param_performance,
        task_utm_daily_utm_id_performance,
        task_country_performance,
    ]


click_cdp_ai_integration_ga_reports_utm()
