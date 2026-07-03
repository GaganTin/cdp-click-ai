#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GA landing - Path & Funnel purpose group.

Handles:
  path_exploration -> page_engagement_daily -> funnel_report

Triggered (with conf) by the click_cdp_ai_integration_ga_reports orchestrator, or runnable
on its own. Writes to Azure Blob and/or Postgres per the ga_storage_targets
Variable (hybrid).
"""

import os
from datetime import datetime, timedelta

import pendulum
import pandas as pd
from airflow.decorators import dag, task
from airflow.models import Param

from dags.utils.google_analytics import GoogleAnalytics
from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import storage as ga_storage
from dags.click_cdp_ai_dags.lib import ga_reports as tf
from dags.click_cdp_ai_dags.lib import pg_state
from dags.click_cdp_ai_dags.lib.transforms import (
    transform_path_response,
    transform_page_duration_response,
)
from google.analytics.data_v1alpha.types import (
    FunnelEventFilter,
    FunnelFieldFilter,
    FunnelFilterExpression,
    FunnelStep,
    StringFilter,
)
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("ga.path_funnel")

# Cap GA API concurrency via an Airflow pool: set the ga_api_pool Airflow
# Variable (UI), or the GA_API_POOL env var; unset = no pool (create pool first).
_DEFAULT_ARGS = ga_config.pool_default_args("cdp_ai_ga_api_pool", "GA_API_POOL")


# GA4 Data API allows at most 9 dimensions per request. path_exploration already
# uses 7 base dims, so at most 2 capsuite dims fit; honour them by priority
# (anonymous id and member id matter most for identity stitching) and never exceed
# the limit - otherwise a workspace configured with 3-4 capsuite params crashes.
_GA4_MAX_DIMENSIONS = 9
_CAPSUITE_PRIORITY = ["capsuite_apid", "capsuite_uid", "capsuite_identifier", "capsuite_sid"]


def _add_capsuite_param_dims(dict_config, gaConnector, list_dimensions):
    """Append supporting capsuite custom dimensions (priority-ordered, 9-dim-capped)."""
    dict_dim_order = {}
    params = dict_config.get("supportingCapsuiteParam") or []
    const = {
        "capsuite_sid": gaConnector.DIM_CAPSUITE_SID,
        "capsuite_uid": gaConnector.DIM_CAPSUITE_UID,
        "capsuite_apid": gaConnector.DIM_CAPSUITE_APID,
        "capsuite_identifier": gaConnector.DIM_CAPSUITE_IDENTIFIER,
    }
    ordered = ([p for p in _CAPSUITE_PRIORITY if p in params]
               + [p for p in params if p not in _CAPSUITE_PRIORITY])
    for param in ordered:
        if param not in const:
            continue
        if len(list_dimensions) >= _GA4_MAX_DIMENSIONS:
            _log.warning("Skipping capsuite dim %s: GA4 9-dimension limit reached", param)
            continue
        list_dimensions.append(const[param])
        dict_dim_order[param] = len(list_dimensions) - 1
    return dict_dim_order


def _conversion_funnel_step(dict_config):
    """Final funnel step = a conversion, defined generically.

    Default: ANY GA4 key event (isKeyEvent = true), so the funnel's conversion step
    adapts to whatever each workspace marked as a key event (purchase, generate_lead,
    form_submit, ...) - no hardcoded per-merchant screen name. A workspace can pin a
    specific event by setting ``conversion_event`` in its funnel_report config.
    """
    cfg = dict_config.get("funnel_report") or {}
    event = cfg.get("conversion_event")
    if event:
        return FunnelStep(
            name=f"Conversion ({event})",
            filter_expression=FunnelFilterExpression(
                funnel_event_filter=FunnelEventFilter(event_name=event)))
    return FunnelStep(
        name="Conversion (key event)",
        filter_expression=FunnelFilterExpression(
            funnel_field_filter=FunnelFieldFilter(
                field_name="isKeyEvent",
                string_filter=StringFilter(
                    match_type=StringFilter.MatchType.EXACT,
                    case_sensitive=False, value="true"))))


@dag(
    schedule=None,
    start_date=datetime(2024, 1, 1),
    max_active_runs=16,
    max_active_tasks=8,
    catchup=False,
    default_args=_DEFAULT_ARGS,
    tags=["cdp-click-ai", "data_extraction", "ga", "path_funnel", "integration"],
    owner_links={"capsuite": "https://capsuite.co"},
    on_failure_callback=tf.on_dag_failure_callback,
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        "is_debugging": Param(False, type=["boolean", "string"]),
        "dag_run_id": Param(None, type=["string", "null"]),
    },
)
def click_cdp_ai_integration_ga_reports_path_funnel():

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def get_config(**context):
        _log.info("Start running get_config")
        str_client_name, is_debugging, _ = tf.get_params(context)
        return tf.build_configs(str_client_name, is_debugging)

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_path_exploration(dict_config):
        _log.info("Start running create_path_exploration")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")

        if "path_exploration" not in dict_config["report"]:
            _log.info("Path Exploration needs not to be handled")
            return dict_config

        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "path_exploration", "path_exploration_2"
            )
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            quality = None
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                list_dimensions = [
                    gaConnector.DIM_EVENT_NAME, gaConnector.DIM_DATE_HOUR_MINUTE,
                    gaConnector.DIM_PAGE_REFERRER, gaConnector.DIM_PAGE_LOCATION,
                    gaConnector.DIM_LINK_URL, gaConnector.DIM_SESSION_SOURCE_MEDIUM,
                    gaConnector.DIM_SESSION_CAMPAIGN_NAME,
                ]
                dict_dim_order = _add_capsuite_param_dims(dict_config, gaConnector, list_dimensions)
                list_metrics = []

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None,
                )
                num_row_count = type(response).to_dict(response)['row_count']
                quality = GoogleAnalytics.extract_quality(response)
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_path_exploration = transform_path_response(response, dict_dim_order)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None,
                            )
                            list_path_exploration += transform_path_response(response, dict_dim_order)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_path_exploration)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    tmp_df['date'] = tmp_df['date_hour_minute'].dt.date.apply(lambda x: x.strftime('%Y%m%d'))
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            if quality is not None:
                tf.record_report_quality(str_client_name, "path_exploration", property_id, quality, df=df, start_date=str_start_date)
            ga_storage.persist_by_date(df, str_client_name, "path_exploration")
        except Exception as error:
            _log.error(f"Error generating path exploration files for {str_client_name}, error: {error}.")
            raise

        return dict_config

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_page_engagement(dict_config):
        _log.info("Start running create_page_engagement")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")

        if "page_engagement_daily" not in dict_config["report"]:
            _log.info("Page Engagement Daily needs not to be handled")
            return dict_config

        try:
            str_start_date = tf.resolve_incremental_start_date(
                dict_config, "page_engagement_daily", "page_engagement_daily_2"
            )
            _log.info(f"Getting records from: {str_start_date}")

            df = pd.DataFrame()
            quality = None
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)
                # Slimmed: page-level daily engagement. This used to be a near-duplicate
                # of the path_exploration event log (same event/referrer/source dims,
                # minute grain). path_exploration keeps the raw events; this table now
                # just carries engagement seconds per page per day - far smaller, no overlap.
                list_dimensions = [gaConnector.DIM_DATE, gaConnector.DIM_UNIFIED_PAGE_PATH]
                list_metrics = [gaConnector.MET_USER_ENGAGEMENT_DURATION]

                response = gaConnector.get_base_report(
                    list_dimensions=list_dimensions, list_metrics=list_metrics,
                    str_start_date=str_start_date, str_end_date='today',
                    num_offset=0, list_dimension_filters=None,
                )
                num_row_count = type(response).to_dict(response)['row_count']
                quality = GoogleAnalytics.extract_quality(response)
                _log.info(f"Total rows found: {num_row_count}")

                if num_row_count > 0:
                    list_path_exploration = transform_page_duration_response(response)
                    if num_row_count > 100000:
                        num_requests = (num_row_count // 100000) + (1 if num_row_count % 100000 != 0 else 0)
                        for request_num in range(1, num_requests):
                            num_current_offset = request_num * 100000
                            response = gaConnector.get_base_report(
                                list_dimensions=list_dimensions, list_metrics=list_metrics,
                                str_start_date=str_start_date, str_end_date='today',
                                num_offset=num_current_offset, list_dimension_filters=None,
                            )
                            list_path_exploration += transform_page_duration_response(response)
                            num_current_offset += 100000

                    tmp_df = pd.json_normalize(list_path_exploration)
                    tmp_df['capsuite_ref'] = str_client_name
                    tmp_df['property_id'] = property_id
                    tmp_df['property_name'] = property_name
                    df = pd.concat([df, tmp_df])
                else:
                    _log.info(f"No new data found in {property_id}")

            if quality is not None:
                tf.record_report_quality(str_client_name, "page_engagement_daily", property_id, quality, df=df, start_date=str_start_date)
            ga_storage.persist_by_date(df, str_client_name, "page_engagement_daily")
        except Exception as error:
            _log.error(f"Error generating page engagement daily files for {str_client_name}, error: {error}.")
            raise

        return dict_config

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def create_funnel_report(dict_config):
        _log.info("Start running create_funnel_report")
        str_client_name = dict_config["client"]
        _log.info(f"Handling client: {str_client_name}")

        if "funnel_report" not in dict_config["report"]:
            _log.info("Funnel Report needs not to be handled")
            return dict_config

        try:
            # Resume point comes from the ga_sync_control table (Postgres), then
            # snapped to the start of the month for the monthly funnel report.
            str_start_date = pg_state.resolve_start_date(str_client_name, "funnel_report")
            dt_start_date = pendulum.from_format(str_start_date, 'YYYY-MM-DD', tz='Asia/Hong_Kong').start_of('month')
            dt_end_date = pendulum.now('Asia/Hong_Kong')
            date_range = pendulum.period(dt_start_date, dt_end_date)
            list_first_dates = [dt.to_date_string() for dt in date_range if dt.day == 1]

            df = pd.DataFrame()
            quality = None
            for property in dict_config["property"]:
                property_id = property["property_id"]
                property_name = property["property_name"]
                _log.info(f"Handling property: {property_id}")

                gaConnector = GoogleAnalytics(ga_config.get_ga_service_account(), property_id)

                for first_date in list_first_dates:
                    end_date = pendulum.from_format(first_date, 'YYYY-MM-DD', tz='Asia/Hong_Kong').end_of('month').strftime('%Y-%m-%d')
                    _log.info(f"Getting records from: {first_date} to {end_date}")

                    list_funnel_steps = [
                        FunnelStep(name="Session start", filter_expression=FunnelFilterExpression(
                            funnel_event_filter=FunnelEventFilter(event_name="session_start"))),
                        FunnelStep(name="Page view", filter_expression=FunnelFilterExpression(
                            funnel_event_filter=FunnelEventFilter(event_name="page_view"))),
                        FunnelStep(name="Page scroll", filter_expression=FunnelFilterExpression(
                            funnel_event_filter=FunnelEventFilter(event_name="scroll"))),
                        # Generic conversion step: any GA4 key event (adapts per client -
                        # purchase, generate_lead, form_submit, etc. - instead of a
                        # hardcoded per-merchant screen name). Optionally override with a
                        # specific event via the funnel_report config's "conversion_event".
                        _conversion_funnel_step(dict_config),
                    ]

                    _log.info("Getting funnel report by Source/Medium")
                    response = gaConnector.get_funnel_report(
                        str_start_date=first_date, str_end_date=end_date,
                        str_breakdown_dimension=gaConnector.DIM_SESSION_SOURCE_MEDIUM,
                        list_steps=list_funnel_steps,
                    )
                    list_dimension_values = [i['dimension_values'] for i in type(response).to_dict(response)['funnel_table']['rows']]
                    list_metric_values = [i['metric_values'] for i in type(response).to_dict(response)['funnel_table']['rows']]

                    df_tmp = pd.DataFrame()
                    df_tmp['funnel_step'] = [[x[0]['value']][0].split('. ')[0] for x in list_dimension_values]
                    df_tmp['funnel_step_name'] = [[x[0]['value']][0].split('. ')[1] for x in list_dimension_values]
                    df_tmp['session_source'] = [[x[1]['value']][0].split('/')[0] if '/' in [x[1]['value']][0] else [x[1]['value']][0] for x in list_dimension_values]
                    df_tmp['session_medium'] = [[x[1]['value']][0].split('/')[1] if '/' in [x[1]['value']][0] else [x[1]['value']][0] for x in list_dimension_values]
                    df_tmp['active_users'] = [int([x[0]['value']][0]) for x in list_metric_values]
                    df_tmp['funnel_step_completion_rate'] = [float([x[1]['value']][0]) for x in list_metric_values]
                    df_tmp['funnel_step_abandonments'] = [int([x[2]['value']][0]) for x in list_metric_values]
                    df_tmp['funnel_step_abandonment_rate'] = [float([x[3]['value']][0]) for x in list_metric_values]
                    df_tmp['tracking_type'] = 'source_medium'
                    df_tmp['tracking_period'] = datetime.strptime(first_date, "%Y-%m-%d").strftime("%Y-%m")
                    df_tmp['property_id'] = property_id
                    df_tmp['property_name'] = property_name
                    df_tmp['capsuite_ref'] = str_client_name
                    df = pd.concat([df, df_tmp])

                    _log.info("Getting funnel report by Campaign")
                    response = gaConnector.get_funnel_report(
                        str_start_date=first_date, str_end_date=end_date,
                        str_breakdown_dimension=gaConnector.DIM_SESSION_CAMPAIGN_NAME,
                        list_steps=list_funnel_steps,
                    )
                    list_dimension_values = [i['dimension_values'] for i in type(response).to_dict(response)['funnel_table']['rows']]
                    list_metric_values = [i['metric_values'] for i in type(response).to_dict(response)['funnel_table']['rows']]

                    df_tmp = pd.DataFrame()
                    df_tmp['funnel_step'] = [[x[0]['value']][0].split('. ')[0] for x in list_dimension_values]
                    df_tmp['funnel_step_name'] = [[x[0]['value']][0].split('. ')[1] for x in list_dimension_values]
                    df_tmp['session_campaign'] = [[x[1]['value']][0] for x in list_dimension_values]
                    df_tmp['active_users'] = [int([x[0]['value']][0]) for x in list_metric_values]
                    df_tmp['funnel_step_completion_rate'] = [float([x[1]['value']][0]) for x in list_metric_values]
                    df_tmp['funnel_step_abandonments'] = [int([x[2]['value']][0]) for x in list_metric_values]
                    df_tmp['funnel_step_abandonment_rate'] = [float([x[3]['value']][0]) for x in list_metric_values]
                    df_tmp['tracking_type'] = 'campaign'
                    df_tmp['tracking_period'] = datetime.strptime(first_date, "%Y-%m-%d").strftime("%Y-%m")
                    df_tmp['property_id'] = property_id
                    df_tmp['property_name'] = property_name
                    df_tmp['capsuite_ref'] = str_client_name
                    df = pd.concat([df, df_tmp])

            ga_storage.persist_funnel(df, str_client_name)
        except Exception as error:
            _log.error(f"Error generating funnel report files for {str_client_name}, error: {error}.")
            raise

        return dict_config

    task_get_config = get_config()
    task_path_exploration = create_path_exploration.expand(dict_config=task_get_config)
    task_page_engagement = create_page_engagement.expand(dict_config=task_path_exploration)
    task_funnel_report = create_funnel_report.expand(dict_config=task_page_engagement)

    task_path_exploration >> task_page_engagement >> task_funnel_report


click_cdp_ai_integration_ga_reports_path_funnel()
