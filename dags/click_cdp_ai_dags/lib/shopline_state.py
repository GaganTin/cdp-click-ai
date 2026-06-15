#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shopline incremental window + persistence glue (mirrors shopify_state).

Business landing data goes to the Data Postgres ``shopline`` schema; the
per-(client, dataset) watermark lives in ``shopline.shopline_sync_control``.
Shopline's API window uses the ISO-Z form (``YYYY-MM-DDTHH:MM:SSZ``).
"""

from datetime import datetime, timedelta

import pytz

SHOPLINE_SCHEMA = "shopline"
SHOPLINE_CONTROL_TABLE = "shopline_sync_control"
_HK = pytz.timezone("Asia/Hong_Kong")

DATASETS = {
    "order":           {"scope_column": "order_id",      "full": False},
    "order_line":      {"scope_column": "order_line_id", "full": False},
    "product":         {"scope_column": "product_id",    "full": False},
    "customer":        {"scope_column": "customer_id",   "full": False},
    "inventory_level": {"scope_column": None,            "full": True},
}


def _end():
    return datetime.today().astimezone(_HK) - timedelta(days=1)


def resolve_start_window(client, dataset, conn_kwargs=None):
    """Return ``(str_start, str_end)`` ISO-Z for the Shopline updated_after window."""
    str_end = _end().strftime("%Y-%m-%dT16:00:00Z")
    if DATASETS[dataset]["full"]:
        return "1970-01-01T00:00:00Z", str_end
    from dags.click_cdp_ai_dags.lib import pg_state
    start_date = pg_state.resolve_start_date(
        client, dataset, conn_kwargs=conn_kwargs,
        schema=SHOPLINE_SCHEMA, control_table=SHOPLINE_CONTROL_TABLE,
    )
    return f"{start_date}T00:00:00Z", str_end


def watermark_token():
    return _end().strftime("%Y%m%d")


def persist(df, client, dataset):
    from dags.click_cdp_ai_dags.lib import pg_loader
    reg = DATASETS[dataset]
    scope_column = reg["scope_column"]
    scope_values = None
    if scope_column is not None and df is not None and len(df) > 0:
        scope_values = df[scope_column].tolist()
    return pg_loader.load_dataframe(
        df, table_name=dataset, client=client,
        scope_column=scope_column, scope_values=scope_values,
        schema=SHOPLINE_SCHEMA, report=dataset,
        watermark_value=watermark_token(), control_table=SHOPLINE_CONTROL_TABLE,
    )
