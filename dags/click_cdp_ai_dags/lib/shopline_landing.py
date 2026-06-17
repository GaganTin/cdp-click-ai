#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-call Shopline dataset runner shared by the scheduled and trial-flow DAGs.

``run_dataset(dict_config, dataset)`` resolves the access token (App DB, by
company_id - never in XCom), fetches from the Shopline REST API, transforms, and
upserts into Postgres + advances the watermark.
"""

from dags.click_cdp_ai_dags.lib import app_state, shopline_state
from dags.click_cdp_ai_dags.lib import shopline_client as sc
from dags.click_cdp_ai_dags.lib import shopline_transforms as tf
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("shopline")


def run_dataset(dict_config, dataset):
    client = dict_config["client"]
    company_id = dict_config["company_id"]
    _log.info(f"[shopline] {dataset} for client={client}")

    token = app_state.get_shopline_access_token(company_id)
    if not token:
        raise RuntimeError(f"No connected Shopline access token for company {company_id}")

    start, end = shopline_state.resolve_start_window(client, dataset)
    _log.info(f"[shopline] {dataset}: window {start} .. {end}")
    api = sc.ShoplineClient(token)

    if dataset == "order":
        df = tf.transform_order(api.orders(start, end), client)
    elif dataset == "order_line":
        df = tf.transform_order_line(api.orders(start, end), client)
    elif dataset == "product":
        df = tf.transform_product(api.products(start, end), api.addon_products(), api.gifts(), client)
    elif dataset == "customer":
        df = tf.transform_customer(api.customers(start, end), client)
    elif dataset == "inventory_level":
        # full snapshot: all products -> per-product stocks
        products = api.products(start, end)
        stock_docs = [api.product_stocks(p["id"]) for p in products]
        df = tf.transform_inventory_level(stock_docs, client)
    else:
        raise ValueError(f"Unknown shopline dataset: {dataset}")

    return shopline_state.persist(df, client, dataset)
