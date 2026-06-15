#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shopify incremental window + persistence glue for the click_cdp_ai pipeline.

Business landing data goes to the Data Postgres ``shopify`` schema (one table per
dataset). The per-(client, dataset) watermark lives in ``shopify.shopify_sync_control``
(the GA-style control table, reused via pg_state's ``control_table`` parameter).

- ``resolve_start_window(client, dataset)`` -> (str_start, str_end) for the GraphQL
  ``updated_at`` filter. Incremental datasets resume from the watermark (debug ->
  N months back, else last_sync_date - overlap_days); ``stock_quant`` is a FULL
  snapshot so it always pulls from epoch.
- ``persist(df, client, dataset)`` -> upsert the DataFrame by the dataset's PK and
  advance the watermark, via pg_loader.load_dataframe.
"""

from datetime import date, datetime, timedelta

import pytz

from dags.click_cdp_ai_dags.lib import config as ga_config

SHOPIFY_SCHEMA = "shopify"
SHOPIFY_CONTROL_TABLE = "shopify_sync_control"
_HK = pytz.timezone("Asia/Hong_Kong")

# Per-dataset load semantics:
#   scope_column = the upsert key (delete those keys then insert); None = full
#   client replace. ``full`` datasets always pull the whole history (snapshot).
DATASETS = {
    "order":           {"scope_column": "order_id",       "full": False},
    "order_line":      {"scope_column": "order_line_id",  "full": False},
    "product":         {"scope_column": "product_id",     "full": False},
    "product_detail":  {"scope_column": "product_id",     "full": False},
    "product_image":   {"scope_column": "product_id",     "full": False},
    "customer":        {"scope_column": "customer_id",    "full": False},
    "inventory_level": {"scope_column": None,             "full": True},
    "refund":          {"scope_column": "refund_id",      "full": False},
    "refund_line":     {"scope_column": "refund_line_id", "full": False},
}


def _end_token():
    """Yesterday 16:00 HK as the query upper bound date (YYYYMMDD watermark)."""
    return (datetime.today().astimezone(_HK) - timedelta(days=1))


def resolve_start_window(client, dataset, conn_kwargs=None, is_trial=False):
    """Return ``(str_start, str_end)`` for the Shopify ``updated_at`` filter.

    First-run backfill depth depends on the account type:
      - non-trial (contracted) -> from epoch (all history)
      - trial                  -> the default 2-month floor (pg_state)
    Both resume incrementally from the watermark once one exists, so this only
    affects the very first run. ``stock_quant`` is always a FULL snapshot.
    """
    yesterday = _end_token()
    str_end = yesterday.strftime("%Y-%m-%d+16:00:00")

    if DATASETS[dataset]["full"]:
        return "1970-01-01+00:00:00", str_end

    from dags.click_cdp_ai_dags.lib import pg_state
    # Non-trial accounts backfill all history on the first run; trial accounts
    # get a 2-month floor (first day of the month, 2 months back).
    if is_trial:
        first_run_start = pg_state._month_start_back(date.today(), 2)
    else:
        first_run_start = date(1970, 1, 1)
    start_date = pg_state.resolve_start_date(
        client, dataset,
        conn_kwargs=conn_kwargs,
        schema=SHOPIFY_SCHEMA,
        control_table=SHOPIFY_CONTROL_TABLE,
        first_run_start=first_run_start,
    )
    return f"{start_date}+00:00:00", str_end


def watermark_token():
    """The watermark value written after a successful load (yesterday, YYYYMMDD)."""
    return _end_token().strftime("%Y%m%d")


def persist(df, client, dataset):
    """Upsert ``df`` into ``shopify.<dataset>`` and advance the watermark."""
    from dags.click_cdp_ai_dags.lib import pg_loader
    reg = DATASETS[dataset]
    scope_column = reg["scope_column"]
    scope_values = None
    if scope_column is not None and df is not None and len(df) > 0:
        scope_values = df[scope_column].tolist()
    return pg_loader.load_dataframe(
        df,
        table_name=dataset,
        client=client,
        scope_column=scope_column,
        scope_values=scope_values,
        schema=SHOPIFY_SCHEMA,
        report=dataset,
        watermark_value=watermark_token(),
        control_table=SHOPIFY_CONTROL_TABLE,
    )
