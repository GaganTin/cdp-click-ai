#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GA / GSC response transform helpers.

These functions were previously duplicated verbatim inside
build_landing_ga_reports.py and build_landing_ga_reports_trial_flow.py.
They are pure (no Airflow / Azure / Mongo dependencies) so they live here as a
single source of truth shared by every split DAG.
"""

from datetime import datetime

import pytz
import pandas as pd


def transform_path_response(response, dimension_order):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['event_name'] = i['dimension_values'][0]['value']
        tmp['date_hour_minute'] = datetime.strptime(i['dimension_values'][1]['value'], '%Y%m%d%H%M')
        tmp['page_referrer'] = i['dimension_values'][2]['value']
        tmp['page_location'] = i['dimension_values'][3]['value']
        tmp['link_url'] = i['dimension_values'][4]['value']
        tmp['session_source_medium'] = i['dimension_values'][5]['value']
        tmp['session_campaign_name'] = i['dimension_values'][6]['value']
        if 'capsuite_sid' in dimension_order:
            tmp['capsuite_sid'] = i['dimension_values'][dimension_order['capsuite_sid']]['value']
        else:
            tmp['capsuite_sid'] = ''
        if 'capsuite_uid' in dimension_order:
            tmp['capsuite_uid'] = i['dimension_values'][dimension_order['capsuite_uid']]['value']
        else:
            tmp['capsuite_uid'] = ''
        if 'capsuite_apid' in dimension_order:
            tmp['capsuite_apid'] = i['dimension_values'][dimension_order['capsuite_apid']]['value']
        else:
            tmp['capsuite_apid'] = ''
        if 'capsuite_identifier' in dimension_order:
            tmp['capsuite_identifier'] = i['dimension_values'][dimension_order['capsuite_identifier']]['value']
        else:
            tmp['capsuite_identifier'] = ''
        list_transformed.append(tmp)
    return list_transformed


def transform_path_duration_response(response, dimension_order):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['event_name'] = i['dimension_values'][0]['value']
        tmp['date_hour_minute'] = datetime.strptime(i['dimension_values'][1]['value'], '%Y%m%d%H%M')
        tmp['page_referrer'] = i['dimension_values'][2]['value']
        tmp['page_location'] = i['dimension_values'][3]['value']
        tmp['session_source_medium'] = i['dimension_values'][4]['value']
        if 'capsuite_sid' in dimension_order:
            tmp['capsuite_sid'] = i['dimension_values'][dimension_order['capsuite_sid']]['value']
        else:
            tmp['capsuite_sid'] = ''
        if 'capsuite_uid' in dimension_order:
            tmp['capsuite_uid'] = i['dimension_values'][dimension_order['capsuite_uid']]['value']
        else:
            tmp['capsuite_uid'] = ''
        if 'capsuite_apid' in dimension_order:
            tmp['capsuite_apid'] = i['dimension_values'][dimension_order['capsuite_apid']]['value']
        else:
            tmp['capsuite_apid'] = ''
        if 'capsuite_identifier' in dimension_order:
            tmp['capsuite_identifier'] = i['dimension_values'][dimension_order['capsuite_identifier']]['value']
        else:
            tmp['capsuite_identifier'] = ''

        tmp['user_engagement_duration'] = int(i['metric_values'][0]['value'])
        list_transformed.append(tmp)
    return list_transformed


def transform_page_duration_response(response):
    """page_engagement_daily: page-level daily engagement seconds (slimmed report)."""
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = i['dimension_values'][0]['value']
        tmp['page_path'] = i['dimension_values'][1]['value']
        tmp['user_engagement_duration'] = int(i['metric_values'][0]['value'])
        list_transformed.append(tmp)
    return list_transformed


def transform_utm_response(response, tz='Asia/Hong_Kong'):
    """Transform the minute-level UTM report.

    ``tz`` should be the GA property's configured timezone so date_hour_minute (and
    the ``date`` derived from it downstream) line up with the daily reports, which
    use GA's own ``date`` dimension. Defaults to Asia/Hong_Kong for back-compat.
    """
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date_hour_minute'] = pytz.timezone(tz).localize(datetime.strptime(i['dimension_values'][0]['value'], '%Y%m%d%H%M'))
        tmp['session_source'] = i['dimension_values'][1]['value']
        tmp['session_medium'] = i['dimension_values'][2]['value']
        tmp['session_campaign_name'] = i['dimension_values'][3]['value']
        tmp['session_content'] = i['dimension_values'][4]['value']
        tmp['session_term'] = i['dimension_values'][5]['value']
        tmp['session_utm_id'] = i['dimension_values'][6]['value']
        tmp['country'] = i['dimension_values'][7]['value']
        tmp['device'] = i['dimension_values'][8]['value']

        tmp['active_users'] = int(i['metric_values'][0]['value'])
        tmp['new_users'] = int(i['metric_values'][1]['value'])
        tmp['bounce_rate'] = float(i['metric_values'][2]['value'])
        tmp['engagement_rate'] = float(i['metric_values'][3]['value'])
        tmp['average_session_duration'] = float(i['metric_values'][4]['value'])
        tmp['sessions'] = int(i['metric_values'][5]['value'])
        list_transformed.append(tmp)
    return list_transformed


def transform_utm_daily_response(response):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = i['dimension_values'][0]['value']
        tmp['session_source'] = i['dimension_values'][1]['value']
        tmp['session_medium'] = i['dimension_values'][2]['value']
        tmp['session_campaign_name'] = i['dimension_values'][3]['value']
        tmp['country'] = i['dimension_values'][4]['value']
        tmp['device'] = i['dimension_values'][5]['value']

        tmp['active_users'] = int(i['metric_values'][0]['value'])
        tmp['new_users'] = int(i['metric_values'][1]['value'])
        tmp['bounce_rate'] = float(i['metric_values'][2]['value'])
        tmp['engagement_rate'] = float(i['metric_values'][3]['value'])
        tmp['average_session_duration'] = float(i['metric_values'][4]['value'])
        tmp['sessions'] = int(i['metric_values'][5]['value'])
        list_transformed.append(tmp)
    return list_transformed


def transform_utm_daily_full_param_response(response):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = i['dimension_values'][0]['value']
        tmp['session_source'] = i['dimension_values'][1]['value']
        tmp['session_medium'] = i['dimension_values'][2]['value']
        tmp['session_campaign_name'] = i['dimension_values'][3]['value']
        tmp['session_content'] = i['dimension_values'][4]['value']
        tmp['session_term'] = i['dimension_values'][5]['value']
        tmp['session_utm_id'] = i['dimension_values'][6]['value']
        tmp['country'] = i['dimension_values'][7]['value']
        tmp['device'] = i['dimension_values'][8]['value']

        tmp['active_users'] = int(i['metric_values'][0]['value'])
        tmp['new_users'] = int(i['metric_values'][1]['value'])
        tmp['bounce_rate'] = float(i['metric_values'][2]['value'])
        tmp['engagement_rate'] = float(i['metric_values'][3]['value'])
        tmp['average_session_duration'] = float(i['metric_values'][4]['value'])
        tmp['sessions'] = int(i['metric_values'][5]['value'])
        list_transformed.append(tmp)
    return list_transformed


def transform_utm_daily_utm_id_response(response):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = i['dimension_values'][0]['value']
        tmp['session_utm_id'] = i['dimension_values'][1]['value']

        tmp['active_users'] = int(i['metric_values'][0]['value'])
        tmp['new_users'] = int(i['metric_values'][1]['value'])
        tmp['bounce_rate'] = float(i['metric_values'][2]['value'])
        tmp['engagement_rate'] = float(i['metric_values'][3]['value'])
        tmp['average_session_duration'] = float(i['metric_values'][4]['value'])
        tmp['sessions'] = int(i['metric_values'][5]['value'])
        list_transformed.append(tmp)
    return list_transformed


def transform_country_response(response):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = i['dimension_values'][0]['value']
        tmp['country'] = i['dimension_values'][1]['value']

        tmp['active_users'] = int(i['metric_values'][0]['value'])
        tmp['new_users'] = int(i['metric_values'][1]['value'])
        tmp['bounce_rate'] = float(i['metric_values'][2]['value'])
        tmp['engagement_rate'] = float(i['metric_values'][3]['value'])
        tmp['average_session_duration'] = float(i['metric_values'][4]['value'])
        tmp['sessions'] = int(i['metric_values'][5]['value'])
        list_transformed.append(tmp)
    return list_transformed


def transform_utm_ad_response(response):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = i['dimension_values'][0]['value']
        tmp['session_source'] = i['dimension_values'][1]['value']
        tmp['session_medium'] = i['dimension_values'][2]['value']
        tmp['session_campaign_name'] = i['dimension_values'][3]['value']
        tmp['session_utm_id'] = i['dimension_values'][4]['value']

        tmp['advertiser_ad_impressions'] = int(i['metric_values'][0]['value'])
        tmp['advertiser_ad_clicks'] = int(i['metric_values'][1]['value'])
        tmp['advertiser_ad_cost'] = float(i['metric_values'][2]['value'])
        tmp['advertiser_ad_cost_per_click'] = float(i['metric_values'][3]['value'])
        tmp['key_events'] = int(float(i['metric_values'][4]['value']))
        tmp['return_on_ad_spend'] = float(i['metric_values'][5]['value'])
        list_transformed.append(tmp)
    return list_transformed


def transform_keyword_response(response, list_dimensions):
    df = pd.DataFrame()
    for dim in list_dimensions:
        df[dim] = [i['keys'][list_dimensions.index(dim)] for i in response['rows']]
        df['clicks'] = [i['clicks'] for i in response['rows']]
        df['impressions'] = [i['impressions'] for i in response['rows']]
        df['ctr'] = [i['ctr'] for i in response['rows']]
        df['position'] = [i['position'] for i in response['rows']]
    return df


def transform_page_response(response):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = datetime.strptime(i['dimension_values'][0]['value'], '%Y%m%d').strftime('%Y-%m-%d')
        tmp['page_path'] = i['dimension_values'][1]['value']
        tmp['page_title'] = i['dimension_values'][2]['value']
        tmp['active_users'] = int(i['metric_values'][0]['value'])
        tmp['new_users'] = int(i['metric_values'][1]['value'])
        tmp['engagement_rate'] = float(i['metric_values'][2]['value'])
        tmp['page_views'] = int(i['metric_values'][3]['value'])
        tmp['sessions'] = int(i['metric_values'][4]['value'])
        tmp['engaged_sessions'] = int(i['metric_values'][5]['value'])
        tmp['bounced_sessions'] = int(i['metric_values'][4]['value']) - int(i['metric_values'][5]['value'])
        list_transformed.append(tmp)
    return list_transformed


def transform_page_utm_response(response):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = datetime.strptime(i['dimension_values'][0]['value'], '%Y%m%d').strftime('%Y-%m-%d')
        tmp['page_path'] = i['dimension_values'][1]['value']
        tmp['channel_group'] = i['dimension_values'][2]['value']
        tmp['active_users'] = int(i['metric_values'][0]['value'])
        tmp['new_users'] = int(i['metric_values'][1]['value'])
        tmp['page_views'] = int(i['metric_values'][2]['value'])
        list_transformed.append(tmp)
    return list_transformed


def transform_website_response(response):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = datetime.strptime(i['dimension_values'][0]['value'], '%Y%m%d').strftime('%Y-%m-%d')
        tmp['active_users'] = int(i['metric_values'][0]['value'])
        tmp['new_users'] = int(i['metric_values'][1]['value'])
        tmp['sessions'] = int(i['metric_values'][2]['value'])
        tmp['engaged_sessions'] = int(i['metric_values'][3]['value'])
        tmp['user_engagement_duration'] = int(i['metric_values'][4]['value'])
        tmp['page_views'] = int(i['metric_values'][5]['value'])
        tmp['engaged_sessions_per_active_user'] = tmp['engaged_sessions'] / tmp['active_users'] if tmp['active_users'] != 0 else 0
        tmp['average_engagement_time_per_session'] = tmp['user_engagement_duration'] / tmp['sessions'] if tmp['sessions'] != 0 else 0
        tmp['average_engagement_time_per_user'] = tmp['user_engagement_duration'] / tmp['active_users'] if tmp['active_users'] != 0 else 0
        list_transformed.append(tmp)
    return list_transformed


def transform_purchase_response(response, dimension_order):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = i['dimension_values'][0]['value']
        tmp['trxn_id'] = i['dimension_values'][1]['value']
        if 'capsuite_sid' in dimension_order:
            tmp['capsuite_sid'] = i['dimension_values'][dimension_order['capsuite_sid']]['value']
        else:
            tmp['capsuite_sid'] = ''
        if 'capsuite_uid' in dimension_order:
            tmp['capsuite_uid'] = i['dimension_values'][dimension_order['capsuite_uid']]['value']
        else:
            tmp['capsuite_uid'] = ''
        if 'capsuite_apid' in dimension_order:
            tmp['capsuite_apid'] = i['dimension_values'][dimension_order['capsuite_apid']]['value']
        else:
            tmp['capsuite_apid'] = ''
        if 'capsuite_identifier' in dimension_order:
            tmp['capsuite_identifier'] = i['dimension_values'][dimension_order['capsuite_identifier']]['value']
        else:
            tmp['capsuite_identifier'] = ''
        list_transformed.append(tmp)
    return list_transformed


def transform_event_response(response):
    list_transformed = []
    for i in type(response).to_dict(response)['rows']:
        tmp = {}
        tmp['date'] = i['dimension_values'][0]['value']
        tmp['event_name'] = i['dimension_values'][1]['value']
        tmp['is_key_event'] = i['dimension_values'][2]['value']
        list_transformed.append(tmp)
    return list_transformed
