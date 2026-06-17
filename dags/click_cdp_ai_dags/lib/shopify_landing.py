#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-call Shopify dataset runner shared by the scheduled and trial-flow DAGs.

``run_dataset(dict_config, dataset)`` does the whole task body for one client and
one dataset: resolve the access token (from the App DB, by company_id - never
carried in XCom), resolve the incremental window, run the GraphQL bulk op,
transform, and upsert into Postgres + advance the watermark.

Keeping this here makes each DAG ``@task`` a two-liner and guarantees the
scheduled and trial flows behave identically.
"""

from dags.click_cdp_ai_dags.lib import app_state, shopify_state
from dags.click_cdp_ai_dags.lib import shopify_client as sc
from dags.click_cdp_ai_dags.lib import shopify_transforms as tf
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("shopify")

# dataset -> (inner-query builder, transform). The query builders take (start, end).
_DISPATCH = {
    "order":           (sc.orders_query,                      tf.transform_order),
    "order_line":      (sc.order_lines_query,                 tf.transform_order_line),
    "product":         (sc.products_query,                    tf.transform_product),
    "product_detail":  (sc.collections_query,                 tf.transform_product_detail),
    "product_image":   (sc.product_image_query,               tf.transform_product_image),
    "customer":        (sc.customers_query,                   tf.transform_customer),
    "inventory_level": (sc.product_variants_inventory_query,  tf.transform_inventory_level),
}


def run_dataset(dict_config, dataset, is_trial=False):
    """Fetch + transform + load one ``dataset`` for the client in ``dict_config``.

    ``dict_config`` carries ``client``, ``company_id`` and ``store_name`` (no
    token). ``is_trial`` caps the first-run backfill to the default 2-month
    window; non-trial (the scheduled landing flow) backfills all history.
    Returns the row count loaded.
    """
    client = dict_config["client"]
    company_id = dict_config["company_id"]
    store_name = dict_config["store_name"]
    _log.info(f"[shopify] {dataset} for client={client} store={store_name}")

    token = app_state.get_shopify_access_token(company_id)
    if not token:
        raise RuntimeError(f"No connected Shopify access token for company {company_id}")

    build_query, transform = _DISPATCH[dataset]
    str_start, str_end = shopify_state.resolve_start_window(client, dataset, is_trial=is_trial)
    _log.info(f"[shopify] {dataset}: window {str_start} .. {str_end}")

    client_api = sc.ShopifyClient(store_name, token)
    records = client_api.run_bulk_query(build_query(str_start, str_end))
    _log.info(f"[shopify] {dataset}: {len(records)} raw records")

    df = transform(records, client)
    return shopify_state.persist(df, client, dataset)


def run_refunds(dict_config, is_trial=False):
    """Fetch refunds once and load both shopify.refund and shopify.refund_line.

    A single bulk op over orders' inline refunds feeds two tables (order-level
    summary + line-item detail), so they always share one fetch/window.
    ``is_trial`` caps the first-run backfill (see ``run_dataset``).
    """
    client = dict_config["client"]
    company_id = dict_config["company_id"]
    store_name = dict_config["store_name"]
    _log.info(f"[shopify] refunds for client={client} store={store_name}")

    token = app_state.get_shopify_access_token(company_id)
    if not token:
        raise RuntimeError(f"No connected Shopify access token for company {company_id}")

    # refund + refund_line share the orders updated_at window (keyed on "refund").
    str_start, str_end = shopify_state.resolve_start_window(client, "refund", is_trial=is_trial)
    _log.info(f"[shopify] refunds: window {str_start} .. {str_end}")

    client_api = sc.ShopifyClient(store_name, token)

    # Order-level refund summary via bulk (refunds is an inline list of scalars).
    records = client_api.run_bulk_query(sc.refunds_query(str_start, str_end))
    _log.info(f"[shopify] refund: {len(records)} raw records")
    n_refund = shopify_state.persist(tf.transform_refund(records, client), client, "refund")

    # Refund line items via a regular paginated query: bulk operations can't
    # traverse refundLineItems (a connection) nested in the Order.refunds list.
    line_nodes = client_api.fetch_order_refund_lines(str_start, str_end)
    n_line = shopify_state.persist(tf.transform_refund_line(line_nodes, client), client, "refund_line")

    return {"refund": n_refund, "refund_line": n_line}
