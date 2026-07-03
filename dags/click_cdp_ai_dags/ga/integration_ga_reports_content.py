#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GA landing - Content / Page purpose group.

Handles:
  page_metrics -> page_utm_metrics -> event_list -> website_metrics

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
from dags.click_cdp_ai_dags.lib import ga_cube_runner
from dags.click_cdp_ai_dags.lib.transforms import (
    transform_page_response,
    transform_page_utm_response,
    transform_website_response,
    transform_event_response,
)
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("ga.content")

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
    tags=["cdp-click-ai", "data_extraction", "ga", "content", "integration"],
    owner_links={"capsuite": "https://capsuite.co"},
    on_failure_callback=tf.on_dag_failure_callback,
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        "is_debugging": Param(False, type=["boolean", "string"]),
        "dag_run_id": Param(None, type=["string", "null"]),
    },
)
def click_cdp_ai_integration_ga_reports_content():

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def get_config(**context):
        _log.info("Start running get_config")
        str_client_name, is_debugging, _ = tf.get_params(context)
        return tf.build_configs(str_client_name, is_debugging)

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_page_metrics(dict_config):
        _log.info("Start running create_page_metrics")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "page_metrics" not in dict_config["report"]:
            _log.info("Page Metrics needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "page_metrics", "page_metrics_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            quality = None
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [gaConnector.DIM_DATE, gaConnector.DIM_UNIFIED_PAGE_PATH, gaConnector.DIM_PAGE_TITLE]
                list_metrics = [
                    gaConnector.MET_ACTIVE_USERS, gaConnector.MET_NEW_USERS, gaConnector.MET_ENGAGEMENT_RATE,
                    gaConnector.MET_PAGE_VIEWS, gaConnector.MET_SESSIONS, gaConnector.MET_ENGAGED_SESSIONS,
                ]

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None)
                num_row_count = type(response).to_dict(response)['row_count']
                quality = GoogleAnalytics.extract_quality(response)
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_path_exploration = transform_page_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None)
                            list_path_exploration += transform_page_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_path_exploration)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            if quality is not None:
                tf.record_report_quality(str_client_name, "page_metrics", property_id, quality, df=df, start_date=str_start_date)
            ga_storage.persist_by_date(df, str_client_name, "page_metrics", dashed_source_date=True)
        except Exception as error:
            _log.error(f"Error generating page metrics files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_page_utm_metrics(dict_config):
        _log.info("Start running create_page_utm_metrics")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "page_utm_metrics" not in dict_config["report"]:
            _log.info("Page UTM Metrics needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "page_utm_metrics", "page_utm_metrics_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            quality = None
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                # Converged: page x channel_group (low-cardinality) instead of
                # page x source x medium - lowers the (other)-row risk on this page-scoped cube.
                list_dimensions = [
                    gaConnector.DIM_DATE, gaConnector.DIM_UNIFIED_PAGE_PATH,
                    gaConnector.DIM_SESSION_CHANNEL_GROUP,
                ]
                list_metrics = [gaConnector.MET_ACTIVE_USERS, gaConnector.MET_NEW_USERS, gaConnector.MET_PAGE_VIEWS]

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None)
                num_row_count = type(response).to_dict(response)['row_count']
                quality = GoogleAnalytics.extract_quality(response)
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_path_exploration = transform_page_utm_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None)
                            list_path_exploration += transform_page_utm_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_path_exploration)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            if quality is not None:
                tf.record_report_quality(str_client_name, "page_utm_metrics", property_id, quality, df=df, start_date=str_start_date)
            ga_storage.persist_by_date(df, str_client_name, "page_utm_metrics", dashed_source_date=True)
        except Exception as error:
            _log.error(f"Error generating page utm metrics files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_event_list(dict_config):
        _log.info("Start running create_event_list")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "event_list" not in dict_config["report"]:
            _log.info("Event List needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "event_list", "event_list_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            quality = None
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [gaConnector.DIM_DATE, gaConnector.DIM_EVENT_NAME, gaConnector.DIM_IS_KEY_EVENT]
                list_metrics = []

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date="today",
                    num_offset=0, list_dimension_filters=None)
                num_row_count = type(response).to_dict(response)['row_count']
                quality = GoogleAnalytics.extract_quality(response)
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_events = transform_event_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date="today", str_end_date="today",
                                num_offset=num_current_offset, list_dimension_filters=None)
                            list_events += transform_event_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_events)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            if quality is not None:
                tf.record_report_quality(str_client_name, "event_list", property_id, quality, df=df, start_date=str_start_date)
            ga_storage.persist_by_date(df, str_client_name, "event_list")
        except Exception as error:
            _log.error(f"Error generating event list files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_website_metrics(dict_config):
        _log.info("Start running create_website_metrics")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")
        if "website_metrics" not in dict_config["report"]:
            _log.info("Website Metrics needs not to be handled")
            return dict_config
        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "website_metrics", "website_metrics_2")
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            quality = None
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [gaConnector.DIM_DATE]
                list_metrics = [
                    gaConnector.MET_ACTIVE_USERS, gaConnector.MET_NEW_USERS, gaConnector.MET_SESSIONS,
                    gaConnector.MET_ENGAGED_SESSIONS, gaConnector.MET_USER_ENGAGEMENT_DURATION, gaConnector.MET_PAGE_VIEWS,
                ]
                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None)
                num_row_count = type(response).to_dict(response)['row_count']
                quality = GoogleAnalytics.extract_quality(response)
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_path_exploration = transform_website_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None)
                            list_path_exploration += transform_website_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_path_exploration)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            if quality is not None:
                tf.record_report_quality(str_client_name, "website_metrics", property_id, quality, df=df, start_date=str_start_date)
            ga_storage.persist_by_date(df, str_client_name, "website_metrics", dashed_source_date=True)
        except Exception as error:
            _log.error(f"Error generating website metrics files for {str_client_name}, error: {error}.")
            raise
        return dict_config

    task_get_config = get_config()
    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_session_quality(dict_config):
        # Catalog-driven (generic runner) - session-depth cube; no bespoke transform.
        return ga_cube_runner.run_cube(dict_config, "session_quality_daily", _log)

    task_page_metrics = create_page_metrics.expand(dict_config=task_get_config)
    task_page_utm_metrics = create_page_utm_metrics.expand(dict_config=task_page_metrics)
    task_event_list = create_event_list.expand(dict_config=task_page_utm_metrics)
    task_website_metrics = create_website_metrics.expand(dict_config=task_event_list)
    task_session_quality = create_session_quality.expand(dict_config=task_website_metrics)

    task_page_metrics >> task_page_utm_metrics >> task_event_list >> task_website_metrics >> task_session_quality


click_cdp_ai_integration_ga_reports_content()
