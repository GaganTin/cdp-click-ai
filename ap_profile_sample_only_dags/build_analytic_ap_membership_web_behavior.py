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
from bson.objectid import ObjectId
import random
from pprint import pprint

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
def analytic_ap_membership_web_behavior():
    @task(retries = 3, retry_delay = timedelta(seconds = 5))
    def get_clients():
        list_configs = json.loads(Variable.get("client_config"))
        return list_configs

    @task(retries = 3, retry_delay = timedelta(seconds = 5))
    def generate_analytic_membership_profile(dict_config):
        str_client_name = dict_config["client"]
        print(f"Handling client: {str_client_name}")
        
        if "ap_membership_profiles" not in dict_config["report"]:
            print("No need to generate AP membership profiles for this client.")
            return dict_config
        
        if "dev_mode" in dict_config and dict_config["dev_mode"]:
            str_client_name = "test_" + str_client_name
            print(f"Running in dev mode, using test client name: {str_client_name}.")
        
        mongo_client = mongo.get_mongo_client()
        db = mongo_client[mongo.db_name]
        collection_anonymousprofilelist = db['anonymousprofilelist']
        collection_membershipanonymousprofilemapping = db['membershipanonymousprofilemapping']
        collection_membershipprofiles = db['membershipprofiles']
        collection_membershipprofiles.delete_many({'capsuiteRef': str_client_name})
        print('delete membership webbehaviour old data')

        temp_membership_anonymous_profile_mapping = list(collection_membershipanonymousprofilemapping.find({'capsuiteRef': str_client_name}))
        df_temp_membership_anonymous_profile_mapping = pd.DataFrame(temp_membership_anonymous_profile_mapping)
        so_flag = True
        try:
            df_temp_so = pd.read_parquet(ab.get_latest_parquet('landing', str_client_name, 'sale', 'so_2'))
            df_temp_sol =  pd.read_parquet(ab.get_latest_parquet("landing", str_client_name, "sale", "sol_2"))
        except:
            print('so_2 not found')
            so_flag = False
        # get anonymous profile list
        list_anonymous_profile = list(collection_anonymousprofilelist.find({'capsuiteRef': str_client_name}))
        df_anonymous_profile = pd.DataFrame(list_anonymous_profile)

        collection_memberships = db['memberships']
        list_membership = list(collection_memberships.find({'capsuiteRef': str_client_name}, {'membershipId': 1}))
        df_membership = pd.DataFrame(list_membership)

        df_temp_membership_anonymous_profile_mapping = pd.merge(df_temp_membership_anonymous_profile_mapping, df_membership, on='membershipId', how='right')

        final_result = []
        timePeriod = [7, 14, 30, 60, 90]
        grouped = df_temp_membership_anonymous_profile_mapping.groupby('membershipId')
        for membershipId, group in grouped:
            for temp_timePeriod in timePeriod:
                print(f'group sid: {group["SID"].tolist()}')
                anonymous_profile_flag = True
                try:
                    temp_anonymous_profile = df_anonymous_profile[df_anonymous_profile['SID'].isin(group['SID'].tolist())]
                    temp_anonymous_profile = temp_anonymous_profile[temp_anonymous_profile['timePeriod'] == temp_timePeriod]
                    print(f'file length: {len(temp_anonymous_profile)}')
                    if len(temp_anonymous_profile) == 0:
                        print(f'no data for membershipId: {membershipId}, timePeriod: {temp_timePeriod}')
                        anonymous_profile_flag = False
                except:
                    anonymous_profile_flag = False
                temp_result = {
                    'membershipId': membershipId,
                    'SID': [],
                    'capsuiteRef': str_client_name,
                    'timePeriod': temp_timePeriod,
                    'lastVisitDate': None,
                    'visitCount': 0,
                    'visitDuration': 0,
                    'interestInProducts': [],
                    'interestInProductCategory': [],
                    'topUTMSource': [],
                    'topUTMMedium': [],
                    'averageVisitDuration': 0.0,
                    'transactionCount': 0,
                    'additionalAttributes': {}
                }
                if anonymous_profile_flag == False:
                    continue
                else:
                    try:
                        temp_result['SID'] = group['SID'].tolist()
                    except:
                        temp_result['SID'] = []
                    try:
                        temp_result['lastVisitDate'] = str(temp_anonymous_profile['lastVisitDate'].max())
                    except:
                        temp_result['lastVisitDate'] = None
                    try:
                        temp_result['visitCount'] = float(temp_anonymous_profile['visitCount'].sum())
                    except:
                        temp_result['visitCount'] = 0
                    try:
                        temp_result['visitDuration'] = float(temp_anonymous_profile['visitDuration'].sum())
                    except:
                        temp_result['visitDuration'] = 0
                    try:
                        temp_result['averageVisitDuration'] = float(temp_anonymous_profile['averageVisitDuration'].mean())
                    except:
                        temp_result['averageVisitDuration'] = 0.0
                    try:
                        temp_result['interestInProducts'] = temp_anonymous_profile['interestInProduct'].sum()
                    except:
                        temp_result['interestInProducts'] = []
                    try:
                        temp_result['interestInProductCategory'] = temp_anonymous_profile['interestInProductCategory'].sum()
                    except:
                        temp_result['interestInProductCategory'] = []
                    try:
                        temp_result['topUTMSource'] = temp_anonymous_profile['topUTMSource'].sum()
                    except:
                        temp_result['topUTMSource'] = []
                    try:
                        temp_result['topUTMMedium'] = temp_anonymous_profile['topUTMMedium'].sum()
                    except:
                        temp_result['topUTMMedium'] = []
                # get transaction data
                if so_flag == True:
                    temp_membership_so = df_temp_so[df_temp_so['member_id'] == membershipId]
                    temp_membership_so['trxn_date'] = pd.to_datetime(temp_membership_so['trxn_date']).dt.date
                    # timePeriod
                    temp_membership_so = temp_membership_so[temp_membership_so['trxn_date'] > (datetime.now() - timedelta(days=temp_timePeriod+1)).date()]
                    temp_membership_sol = df_temp_sol[df_temp_sol['trxn_id'].isin(temp_membership_so['trxn_id'].tolist())]
                
                    temp_result["transactions"] = {
                        "totalSpend": 0,
                        "averageSpend": 0,
                        "noOfTrxn": 0,
                        "products": [],
                        "productCategories": [],
                    }
                    if len(temp_membership_so) > 0:
                        temp_result['transactionCount'] = len(temp_membership_so)
                        temp_membership_products = temp_membership_sol.groupby('prod_id').agg({'prod_name': 'first', 'prod_category': 'first', 'trxn_item_qty': 'sum', 'trxn_item_target_curr_unit_price': 'first', 'trxn_id': 'nunique'})
                        temp_membership_products['total_spend'] = temp_membership_products['trxn_item_qty'] * temp_membership_products['trxn_item_target_curr_unit_price']
                        temp_membership_categories = temp_membership_products.groupby('prod_category').agg({'total_spend': 'sum', 'trxn_id': 'sum'})
                        for index, row in temp_membership_products.iterrows():
                            temp_result['transactions']['products'].append({
                                "productId": index,
                                "productName": row['prod_name'],
                                "productCategory": row['prod_category'],
                                "totalSpend": float(row['total_spend']),
                                "averageSpend": float(row['total_spend'] / row['trxn_id']),
                                "noOfTrxn": int(row['trxn_id']),
                            })
                        for index, row in temp_membership_categories.iterrows():
                            temp_result['transactions']['productCategories'].append({
                                "productCategory": index,
                                "totalSpend": float(row['total_spend']),
                                "averageSpend": float(row['total_spend'] / row['trxn_id']),
                                "noOfTrxn": int(row['trxn_id']),
                            })
                    else:
                        temp_result['transactionCount'] = 0
                else:
                    temp_result['transactionCount'] = 0

                temp_addtional_attributes = {}
                for k in temp_anonymous_profile['additionalAttributes']:
                    for j in k:
                        if j not in temp_addtional_attributes:
                            temp_addtional_attributes[j] = []
                        for i in k[j]:
                            temp_addtional_attributes[j].append({
                                'attributeValue': i['attributeValue'],
                                'attributeId': i['attributeId'],
                                'attributeCount': i['attributeCount']
                            })
                combined_attributes = {}
                for item in temp_addtional_attributes:
                    if item not in combined_attributes:
                        combined_attributes[item] = {}
                    for attr in temp_addtional_attributes[item]:
                        key = str(attr['attributeValue']+','+attr['attributeId'])
                        if key not in combined_attributes[item]:
                            combined_attributes[item][key] = 0
                        combined_attributes[item][key] += attr['attributeCount']
                # sort the attributes by attributeCount in descending order
                for key, value in combined_attributes.items():
                    combined_attributes[key] = dict(sorted(value.items(), key=lambda item: item[1], reverse=True))
                # transform the combined_attributes to the required format
                temp_result['additionalAttributes'] = {}
                for key, value in combined_attributes.items():
                    temp_result['additionalAttributes'][key] = []
                    for attr_value, count in value.items():
                        temp_result['additionalAttributes'][key].append({
                            'attributeValue': attr_value.split(',')[0],
                            'attributeId': attr_value.split(',')[1],
                            'attributeCount': count
                        })
                # sort the additionalAttributes by attributeCount in descending order
                for key in temp_result['additionalAttributes']:
                    temp_result['additionalAttributes'][key].sort(key=lambda x: x['attributeCount'], reverse=True)
                
                
                # get rfm data
                temp_result["rfm"] = {
                    "customerType": None,
                    "customerStatus": None,
                    "clv": 0
                }
                collection = db['dashboardsummary']
                query = {
                    "capsuiteRef": str_client_name,
                    "groupType": "rfmClvMem",
                    "timePeriod": f"recent{temp_timePeriod}Days",
                    "rfmClvMem": {"$exists": True}
                }
                projection = {
                    "_id": 0,
                    "rfmClvMem": 1,
                }
                data = list(collection.find(query, projection))
                # pprint(data)
                if len(data) > 0:
                    for mem in data[0]['rfmClvMem']:
                        if mem["membershipId"]==membershipId:
                            temp_result['rfm']["customerType"] = mem["customerType"]
                            temp_result['rfm']["customerStatus"] = mem["tempCustomerStatus"]
                            temp_result['rfm']["clv"] = mem["clv"]
                            if "transactions" in temp_result:
                                temp_result['transactions']["totalSpend"] = mem["totalSpend"]
                                temp_result['transactions']["averageSpend"] = mem["averageSpend"]
                                temp_result['transactions']["noOfTrxn"] = mem["totalNoOfTrxn"]
                            break
                
                # get demographics and recommendations
                temp_result["recommendations"] = {
                    "products": [],
                    "productCategories": [],
                    "replenishment": []
                }
                temp_result["demographics"] = {
                    "ageGroup": None
                }
                collection = db['membershiptags']
                query = {
                    "capsuiteRef": str_client_name,
                    "membershipId": membershipId,
                }
                projection = {
                    "_id": 0,
                }
                data = list(collection.find(query, projection))
                list_tags = [ObjectId(item['tagDetailId']) for item in data]

                collection = db['membershiptagdetails']
                query = {
                    "capsuiteRef": str_client_name,
                    "_id": {"$in": list_tags},
                }
                projection = {
                    "_id": 0,
                    "tagText": 1
                }
                data = list(collection.find(query, projection))
                if len(data) > 0:
                    list_prod_recommendations = [item['tagText'].split(":")[1].strip() for item in data if "Product Recommendation:" in item['tagText']]
                    list_cat_recommendations = [item['tagText'].split(":")[1].strip() for item in data if "Category Recommendation:" in item['tagText']]
                    temp_result["recommendations"]["products"] = list_prod_recommendations
                    temp_result["recommendations"]["productCategories"] = list_cat_recommendations
                    list_age_group = [item['tagText'].split(":")[1].strip() for item in data if "Age Group:" in item['tagText']]
                    temp_result["demographics"]["ageGroup"] = list_age_group[0] if list_age_group else None

                # get replenishment data
                collection = db['segmentreplenishments']
                query = {
                    "capsuiteRef": str_client_name,
                    "membershipId": membershipId,
                }
                projection = {
                    "_id": 0,
                    "product": 1,
                    "nextPredictedPurchaseDateByOrder": 1
                }
                data = list(collection.find(query, projection))
                if len(data) > 0:
                    data = [{"product": item["product"], "nextPurchaseDate": item["nextPredictedPurchaseDateByOrder"]} for item in data]
                    temp_result["recommendations"]["replenishment"] = data

                final_result.append(temp_result)

        # pprint(final_result)
        batch_size = 1000
        batch = []
        temp_count = 0
        for i, temp_log in enumerate(final_result):
            batch.append(temp_log)
            temp_count += 1
            if len(batch) >= batch_size:
                collection_membershipprofiles.insert_many(batch)
                print(f'insert {temp_count * batch_size} records')
                batch = []
        if batch:
            collection_membershipprofiles.insert_many(batch)
        print(f'insert {temp_count * batch_size + len(batch)} records')
        print('insert membership webbehaviour data done')
        mongo_client.close()

    @task(retries = 3, retry_delay = timedelta(seconds = 5))
    def generate_web_behavior_tags(dict_config):
        str_client_name = dict_config["client"]
        mongo_client = mongo.get_mongo_client()
        db = mongo_client[mongo.db_name]

        collection_membershipprofiles = db['membershipprofiles']
        temp_membership_web_behaviour = list(collection_membershipprofiles.find({'capsuiteRef': str_client_name}))

        tag_result = []
        for i in temp_membership_web_behaviour:
            temp_membership_id = i['membershipId']
            for j in i['additionalAttributes']:
                for k in i['additionalAttributes'][j]:
                    if k['attributeCount'] > 0:
                        temp = {}
                        temp['capsuiteRef'] = str_client_name
                        temp['membershipId'] = temp_membership_id
                        j_replace = j.replace(' ', '_').replace('-', '_').replace('.', '_').replace('_', ' ').title()
                        j_replace = j_replace[0].upper() + j_replace[1:]
                        temp['tagDetailName'] = f"{j_replace}:{k['attributeValue']}"
                        temp['tagType'] = 'Auto'
                        tag_result.append(temp)
            for j in i['topUTMMedium']:
                try:
                    if j['attributeCount'] > 0:
                        temp = {}
                        temp['capsuiteRef'] = str_client_name
                        temp['membershipId'] = temp_membership_id
                        temp['tagDetailName'] = f"Top UTM Medium:{j['attributeValue']}"
                        temp['tagType'] = 'Auto'
                        tag_result.append(temp)
                except:
                    pass
            for j in i['topUTMSource']:
                try:
                    if j['attributeCount'] > 0:
                        temp = {}
                        temp['capsuiteRef'] = str_client_name
                        temp['membershipId'] = temp_membership_id
                        temp['tagDetailName'] = f"Top UTM Source:{j['attributeValue']}"
                        temp['tagType'] = 'Auto'
                        tag_result.append(temp)
                except:
                    pass
            for j in i['interestInProducts']:
                try:
                    if j['attributeCount'] > 0:
                        temp = {}
                        temp['capsuiteRef'] = str_client_name
                        temp['membershipId'] = temp_membership_id
                        temp['tagDetailName'] = f"Interest In Product:{j['attributeValue']}"
                        temp['tagType'] = 'Auto'
                        tag_result.append(temp)
                except:
                    pass
            for j in i['interestInProductCategory']:
                try:
                    if j['attributeCount'] > 0:
                        temp = {}
                        temp['capsuiteRef'] = str_client_name
                        temp['membershipId'] = temp_membership_id
                        temp['tagDetailName'] = f"Interest In Product Category:{j['attributeValue']}"
                        temp['tagType'] = 'Auto'
                        tag_result.append(temp)
                except:
                    pass



        # drop duplicates
        tag_result = pd.DataFrame(tag_result).drop_duplicates(subset=['capsuiteRef', 'membershipId', 'tagDetailName', 'tagType'])
        if tag_result.empty:
            return
        tag_text_list = tag_result['tagDetailName'].unique().tolist()
        tag_result = tag_result[['capsuiteRef', 'membershipId', 'tagDetailName', 'tagType']].to_dict('records')
        create_tag = {}
        create_tag[str_client_name] = []
        for tag_text in tag_text_list:
            temp = {}
            temp['tagText'] = tag_text
            temp['type'] = 'Auto'
            create_tag[str_client_name].append(temp)

        collection_membershiptagdetails = db['membershiptagdetails']
        exist_tags = collection_membershiptagdetails.find({'capsuiteRef': str_client_name, 'type': 'Auto', 'contentTag': True})
        exist_tag_texts = {tag['tagText'] for tag in exist_tags}
        exist_tag_texts_list = list(exist_tag_texts)
        for tag in create_tag[str_client_name]:
            bg_color = "%06x" % random.randint(0, 0xFFFFFF)
            bg_color = "#" + bg_color
            r, g, b = int(bg_color[1:3], 16), int(bg_color[3:5], 16), int(bg_color[5:], 16)
            luminance = 0.2126 * r + 0.7152 * g + 0.0722* b
            tx_color = '#000000' if luminance > 140 else '#ffffff'
            membershiptagdetails = {
                "_id": ObjectId(),
                "tagText": tag['tagText'],
                "tagBgColor": bg_color,
                "tagTxColor": tx_color,
                "capsuiteRef": str_client_name,
                "type": tag['type'],
                "active": True,
                "createDate": datetime.now(),
                "writeDate": datetime.now(),
                "__v": 0,
                "contentTag": True
            }
            if tag['tagText'] not in exist_tag_texts_list:
                collection_membershiptagdetails.insert_one(membershiptagdetails)
        
        

        collection_membership_tags = db['membershiptags']
        collection_membereship_tag_details = db['membershiptagdetails']

        dict_filter1 = {
                'capsuiteRef': str_client_name,
                'type': 'Auto'
            }
        tag_details = collection_membereship_tag_details.find(dict_filter1)
        tag_details = {tag['tagText']: tag['_id'] for tag in tag_details}

        tag_temp = []
        for tag in tag_result:
            if tag['capsuiteRef'] == str_client_name:
                membershiptag = {
                        "_id": ObjectId(),
                        "membershipId": tag["membershipId"],
                        "tagDetailId": str(tag_details[tag["tagDetailName"]]),
                        "type": tag["tagType"],
                        "capsuiteRef": str_client_name,
                        "createDate": datetime.now(),
                        "writeDate": datetime.now(),
                        "__v": 0,
                        "contentTag": True
                    }
                tag_temp.append(membershiptag)
        collection_membership_tags.delete_many({'capsuiteRef': str_client_name, 'contentTag': True})
        collection_membership_tags.insert_many(tag_temp)
        mongo_client.close()


    task_generate_analytic_membership_profile = generate_analytic_membership_profile.expand(dict_config = get_clients())
    task_generate_web_behavior_tags = generate_web_behavior_tags.expand(dict_config = get_clients())

    task_generate_analytic_membership_profile >> task_generate_web_behavior_tags

analytic_ap_membership_web_behavior_dag = analytic_ap_membership_web_behavior()