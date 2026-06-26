import pandas as pd
import pendulum
from airflow.decorators import dag, task
from airflow.models import Variable
from airflow.exceptions import AirflowException
from airflow.operators.trigger_dagrun import TriggerDagRunOperator
import json
import os
from datetime import datetime, timedelta
from dags.utils.azure_blob import AzureBlob
from dags.utils.mongoDB import MongoDBConnector
import bson
from tqdm import tqdm

os.environ["no_proxy"] = "*"
azure_blob = AzureBlob(Variable.get("azure_blob_conn"))
ab = azure_blob
mongo = MongoDBConnector(Variable.get("mongo_db_conn"))

@dag(
    schedule = None,
    start_date = pendulum.datetime(2022, 1, 1, tz = "UTC"),
    max_active_runs=1,
    catchup = False,
    tags = ["data_analytics"],
    owner_links = {"capsuite": "https://capsuite.co"},
)
def analytic_ap_anonymous_profile():
    @task(retries = 3,retry_delay = timedelta(seconds = 5))
    def trigger_anonymous_profile():
        print("Triggering Anonymous Profile DAG")

    @task(retries = 3, retry_delay = timedelta(seconds = 5))
    def get_clients():
        list_configs = json.loads(Variable.get("client_config"))
        return list_configs
    
    @task(retries = 3, retry_delay = timedelta(seconds = 5))
    def generate_analytic_ap_anonymous_profile(dict_config):
        str_client_name = dict_config["client"]
        print("Handling client:", str_client_name)
        
        if 'ap_anonymous_profile' not in dict_config['report']:
            print("No need to execute analytic_ap_anonymous_profile for this client, skipping...")
            return str_client_name

        mongo_client = mongo.get_mongo_client()
        db = mongo_client[mongo.db_name]
        collection1 = db['anonymousprofilelist']
        collection2 = db['anonymoussessionlog']
        temp_session_log = list(collection2.find({"capsuiteRef": str_client_name}))
        final_result = []
        timePeriod = [7, 14, 30, 60, 90]
        df_temp_session_log = pd.DataFrame(temp_session_log, columns = ['SID', 'capsuiteRef', 'visitDate','visitTime', 'visitDuration', 'product', 'productCategory', 'UTMSource', 'UTMMedium','additionalAttributes'])
        print('finish loading data')
        grouped = df_temp_session_log.groupby('SID')
        print('grouped data')
        
        print('start processing')
        for SID, group in tqdm(grouped, total=len(grouped), desc='Processing groups'):
            group['visitDate'] = pd.to_datetime(group['visitDate']).dt.date
            for temp_timePeriod in timePeriod:
                temp_group = group[group['visitDate'] > (datetime.now() - timedelta(days=temp_timePeriod+1)).date()]
                if len(temp_group) == 0:
                    continue
                else:
                    data = {
                        "apId": SID,
                        "SID": SID,
                        "capsuiteRef": str_client_name,
                        "timePeriod": temp_timePeriod,
                        "lastVisitDate": str(temp_group['visitDate'].max()),
                        "lastVisitTime": temp_group[temp_group['visitDate'] == temp_group['visitDate'].max()]['visitTime'].max(),
                        "visitCount": len(temp_group),
                        "visitDuration": int(temp_group['visitDuration'].sum()),
                        "averageVisitDuration": temp_group['visitDuration'].mean(),
                        "interestInProduct": [],
                        "interestInProductCategory": [],
                        "topUTMSource": [],
                        "topUTMMedium": [],
                        "additionalAttributes": {}
                    }
                    # interestInProduct get the max value of product, if there are multiple max value, get them all like [{'product1': 5}, {'product2': 5}]
                    temp_product_list = []
                    for i in temp_group['product']:
                        temp_product_list += i
                    product_count = pd.Series(temp_product_list).value_counts()
                    if not product_count.empty: 
                        max_product_count = float(product_count.max())
                        max_product = product_count[product_count == max_product_count].index.tolist()
                        interestInProduct = [{product: max_product_count} for product in max_product]
                        dict_interestInProduct = []
                        for item in interestInProduct:
                            temp_dict = {
                                'attributeValue': list(item.keys())[0],
                                'attributeId': None,
                                'attributeCount': list(item.values())[0]
                            }
                            dict_interestInProduct.append(temp_dict)
                        data['interestInProduct'] = dict_interestInProduct
                    # interestInProductCategory get the max value of productCategory, if there are multiple max value, get them all like [{'productCategory1': 5}, {'productCategory2': 5}]
                    temp_product_category_list = []
                    for i in temp_group['productCategory']:
                        temp_product_category_list += i
                    product_category_count = pd.Series(temp_product_category_list).value_counts()
                    if not product_category_count.empty:
                        max_product_category_count = float(product_category_count.max())
                        max_product_category = product_category_count[product_category_count == max_product_category_count].index.tolist()
                        interestInProductCategory = [{product_category: max_product_category_count} for product_category in max_product_category]
                        dict_interestInProductCategory = []
                        for item in interestInProductCategory:
                            temp_dict = {
                                'attributeValue': list(item.keys())[0],
                                'attributeId': None,
                                'attributeCount': list(item.values())[0]
                            }
                            dict_interestInProductCategory.append(temp_dict)
                        data['interestInProductCategory'] = dict_interestInProductCategory
                    # topUTMSource get the max value of UTMSource, if there are multiple max value, get them all like [{'source1': 5}, {'source2': 5}]
                    source_count = temp_group['UTMSource'].value_counts()
                    if not source_count.empty:
                        max_source_count = float(source_count.max())
                        max_source = source_count[source_count == max_source_count].index.tolist()
                        topUTMSource = [{source: max_source_count} for source in max_source]
                        dict_topUTMSource = []
                        for item in topUTMSource:
                            temp_dict = {
                                'attributeValue': list(item.keys())[0],
                                'attributeId': None,
                                'attributeCount': list(item.values())[0]
                            }
                            dict_topUTMSource.append(temp_dict)
                        data['topUTMSource'] = dict_topUTMSource
                    # topUTMMedium get the max value of UTMSource, if there are multiple max value, get them all like [{'source1': 5}, {'source2': 5}]
                    medium_count = temp_group['UTMMedium'].value_counts()
                    if not medium_count.empty:
                        max_medium_count = float(medium_count.max())
                        max_medium = medium_count[medium_count == max_medium_count].index.tolist()
                        topUTMMedium = [{medium: max_medium_count} for medium in max_medium]
                        dict_topUTMMedium = []
                        for item in topUTMMedium:
                            temp_dict = {
                                'attributeValue': list(item.keys())[0],
                                'attributeId': None,
                                'attributeCount': list(item.values())[0]
                            }
                            dict_topUTMMedium.append(temp_dict)
                        data['topUTMMedium'] = dict_topUTMMedium
                    # additionalAttributes
                    try:
                        for i in temp_group['additionalAttributes']:
                            for key, value in i.items():
                                if isinstance(value, list):
                                    for item in value:
                                        if key not in data['additionalAttributes']:
                                            data['additionalAttributes'][key] = []
                                        data['additionalAttributes'][key].append({
                                            'attributeValue': item['attributeValue'],
                                            'attributeId': item['attributeId'],
                                            'attributeCount': item['attributeCount']
                                        })
                        combined_attributes = {}
                        for item in data['additionalAttributes']:
                            if item not in combined_attributes:
                                combined_attributes[item] = {}
                            for attr in data['additionalAttributes'][item]:
                                key = str(attr['attributeValue']+','+attr['attributeId'])
                                if key not in combined_attributes[item]:
                                    combined_attributes[item][key] = 0
                                combined_attributes[item][key] += attr['attributeCount']
                        # sort the attributes by attributeCount in descending order and get the top values (it maybe 2 are equal)
                        for key, value in combined_attributes.items():
                            temp_sorted = sorted(value.items(), key=lambda item: item[1], reverse=True)
                            temp_max_value = temp_sorted[0][1] if temp_sorted else 0
                            combined_attributes[key] = {k: v for k, v in temp_sorted if v == temp_max_value}            # transform the combined_attributes to the required format
                        data['additionalAttributes'] = {}
                        for key, value in combined_attributes.items():
                            data['additionalAttributes'][key] = []
                            for attr_value, count in value.items():
                                data['additionalAttributes'][key].append({
                                    'attributeValue': attr_value.split(',')[0],
                                    'attributeId': attr_value.split(',')[-1],
                                    'attributeCount': count
                                })
                        # sort the additionalAttributes by attributeCount in descending order
                        for key in data['additionalAttributes']:
                            data['additionalAttributes'][key].sort(key=lambda x: x['attributeCount'], reverse=True)
                    except:
                        data['additionalAttributes'] = {}
                    # add the data to final_result
                    final_result.append(data)

        collection1.delete_many({'capsuiteRef': str_client_name})
        print('delete old data in anonymousprofilelist')
        batch_size = 1000
        batch = []
        temp_count = 0
        for i, temp_log in enumerate(final_result):
            batch.append(temp_log)
            temp_count += 1
            if len(batch) >= batch_size:
                collection1.insert_many(batch)
                print(f'insert {temp_count} records')
                batch = []
        if batch:
            collection1.insert_many(batch)
        print('insert anonymousprofilelist data done')
        print(f'insert {temp_count + len(batch)} records')


    task_trigger = trigger_anonymous_profile()
    task_generate_analytic_ap_anonymous_profile = generate_analytic_ap_anonymous_profile.expand(dict_config = get_clients())
    task_trigger_ap_membership_web_behavior = TriggerDagRunOperator(
        task_id='trigger_ap_membership_web_behavior',
        trigger_dag_id ='analytic_ap_membership_web_behavior',
        trigger_rule='all_done',
        retries=3,
    )
    task_trigger >> task_generate_analytic_ap_anonymous_profile >> task_trigger_ap_membership_web_behavior

analytic_ap_anonymous_profile = analytic_ap_anonymous_profile()


