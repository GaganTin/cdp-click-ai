#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
from io import BytesIO
from datetime import datetime, timedelta
import json
import requests
import traceback
import pytz
import pandas as pd
from pprint import pprint
from airflow.decorators import dag, task
from airflow.models import Variable
from airflow.exceptions import AirflowException
from airflow.operators.trigger_dagrun import TriggerDagRunOperator
from dags.utils.azure_blob import AzureBlob
from dags.utils.notification import NotificationHelper
from dags.utils.mongoDB import MongoDBConnector

os.environ["no_proxy"]="*"
AZURE_BLOB_CONNECTOR = AzureBlob(Variable.get("azure_blob_conn"))
STR_CDP_ENDPOINT = Variable.get("cdp_endpoint")
MONGO = MongoDBConnector(Variable.get("mongo_db_conn"))

@dag(
    schedule=None,
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=["data_analytics", "google_analytics"],
    owner_links={"capsuite": "https://capsuite.co"},
)
def anonymous_profile_mapping():
    @task(retries = 3,retry_delay = timedelta(seconds = 5))
    def trigger_anonymous_profile_mapping():
        print("Triggering Anonymous Profile Mapping DAG")

    @task(retries = 3,retry_delay = timedelta(seconds = 5))
    def get_config(**context):
        print("Start running get_config")
        try:
            list_configs = json.loads(Variable.get("ga_client_config"))
            return list_configs
        
        except Exception as error:
            # Send error log to Teams
            # If we have retry handling, the try number will be more than max_tries (not exactly equal to max_tries)
            if context['task_instance'].try_number > context['task_instance'].max_tries:
                log_url = context['task_instance'].log_url
                NotificationHelper().send_teams_error_log(
                    "Anonymous Profile Mapping - Cannot Get Config", 
                    traceback.format_exc(),
                    [{"name": "Airflow", "value": log_url}])   
            raise AirflowException(f"\n--------------------------\n" +
                        f"error: {error}" +
                        f"\n--------------------------\n")
    
    @task(retries = 3,retry_delay = timedelta(seconds = 5))
    def generate_profile_mapping(dict_config, **context):
        print("Start running generate_profile_mapping")
        str_client_name = dict_config["client"]
        print(f"Handling client: {str_client_name}")
        
        if "profile_mapping" not in dict_config["report"]:
            print("Profile Mapping needs not to be handled")
            return dict_config
        
        try:
            # Check if mapping file exists
            try:
                latest_parquet_date = AZURE_BLOB_CONNECTOR.get_latest_parquet_date('process', str_client_name, "googleAnalytics", 'anonymous_profile_mapping_2')
                dt_start_date = datetime.strptime(latest_parquet_date, "%Y%m%d")
            except:
                dt_start_date = datetime(1970, 1, 1)
            print("Extracting data from: ", dt_start_date)

            list_mapped = []

            # Method 1: Map by GA transaction ID
            df_purchase = AZURE_BLOB_CONNECTOR.get_parquet_files_in_period("landing", str_client_name, "googleAnalytics", "purchase_list", dt_start_date)
            if len(df_purchase) > 0:
                df = pd.read_parquet(AZURE_BLOB_CONNECTOR.get_latest_parquet('landing', str_client_name, "sale", 'so_2'))
                for _ , row in df_purchase.iterrows():
                    tmp = {}
                    if len(df.loc[df['trxn_id'].str.contains(row['trxn_id'])]) > 0:
                        tmp['membershipId'] = df.loc[df['trxn_id'].str.contains(row['trxn_id'])]['member_id'].values[0]
                        tmp['SID'] = row['capsuite_sid']
                        tmp['capsuite_sid'] = row['capsuite_sid']
                        tmp['capsuite_apid'] = row['capsuite_apid']
                        tmp['capsuiteRef'] = str_client_name
                        list_mapped.append(tmp)

            # Method 2: Map by GA path exploration
            list_tracking_params = dict_config["supporting_capsuite_param"]

            df_path = AZURE_BLOB_CONNECTOR.get_parquet_files_in_period("landing", str_client_name, "googleAnalytics", "path_exploration", dt_start_date)
            if len(df_path) > 0:
                # df_path = df_path.loc[(df_path['capsuite_sid'] != '(not set)') & (df_path['capsuite_uid'] != '(not set)') & (df_path['capsuite_uid'] != 'NA')][['capsuite_sid', 'capsuite_uid']].drop_duplicates()
                df_tracked = pd.DataFrame()
                for param in list_tracking_params:
                    tmp = df_path.loc[(df_path[param] != '(not set)') & (df_path[param] != 'NA')][list_tracking_params]
                    df_tracked = pd.concat([df_tracked, tmp]).drop_duplicates()

                df = pd.read_parquet(AZURE_BLOB_CONNECTOR.get_latest_parquet('landing', str_client_name, "membership", 'mem_2'))
                for _ , row in df_path.iterrows():
                    tmp = {}
                    if not df.loc[df['member_id'].str.contains(row['capsuite_uid'])].empty:
                        tmp['membershipId'] = df.loc[df['member_id'].str.contains(row['capsuite_uid'])]['member_id'].values[0]
                        tmp['SID'] = row['capsuite_sid']
                        tmp['capsuite_sid'] = row['capsuite_sid']
                        tmp['capsuite_apid'] = row['capsuite_apid']
                        tmp['capsuiteRef'] = str_client_name
                        list_mapped.append(tmp)
            
            try:
                df_mapping = pd.DataFrame(list_mapped).drop_duplicates(subset=['membershipId', 'SID'])
            except:
                df_mapping = None

            if df_mapping is None or df_mapping.empty:
                print("No new data can be exported")
                return dict_config
                
            # Save to Azure Blob
            str_today = (datetime.today().astimezone(pytz.timezone('Asia/Hong_Kong')) - timedelta(days=1)).strftime('%Y%m%d') 
            buffer = BytesIO()
            df_mapping.to_parquet(buffer, engine='pyarrow')
            str_blob = f'{str_client_name}/googleAnalytics/anonymous_profile_mapping_{str_today}.parquet'
            AZURE_BLOB_CONNECTOR.overwrite_blob("process", str_blob, buffer.getvalue())
            print(f"Uploaded parquet file to {str_blob}")
            
            # Import to mongodb
            mongo_client = MONGO.get_mongo_client()
            db = mongo_client[MONGO.db_name]
            collection = db['membershipanonymousprofilemapping']

            list_mapping = df_mapping.to_dict('records')
            for i in range(len(list_mapping)):
                filter = {
                    "capsuiteRef": list_mapping[i]["capsuiteRef"],
                    "membershipId": list_mapping[i]["membershipId"],
                    "SID": list_mapping[i]["SID"]
                }
                update = {"$set": list_mapping[i]}
                collection.update_one(filter, update, upsert = True)
            
            print(f"Imported {len(list_mapping)} records")
            mongo_client.close()

        except Exception as error:
            # Send error log to Teams
            # If we have retry handling, the try number will be more than max_tries (not exactly equal to max_tries)
            if context['task_instance'].try_number > context['task_instance'].max_tries:
                log_url = context['task_instance'].log_url
                NotificationHelper().send_teams_error_log(
                    "Anonymous Profile Mapping - General Error", 
                    f"client: {str_client_name},\n{traceback.format_exc()}",
                    [{"name": "Airflow", "value": log_url}])   
            raise AirflowException(f"\n--------------------------\n" +
                        f"error: {error}" +
                        f"\n--------------------------\n")


    # Main execution
    task_trigger = trigger_anonymous_profile_mapping()
    task_profile_mapping = generate_profile_mapping.expand(dict_config = get_config())
    task_web_content_attributes = TriggerDagRunOperator(
        task_id='trigger_web_content_attributes',
        trigger_dag_id ='analytic_web_content_attributes',
    )

    task_trigger >> task_profile_mapping >> task_web_content_attributes

anonymous_profile_mapping()
