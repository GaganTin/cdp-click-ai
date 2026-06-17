#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pure Odoo post-processing for the click_cdp_ai pipeline.

Odoo raw tables come straight from the shared SQL scripts in
``dags/sql_lib/customer/*.sql`` (selected per client via schema.json), so columns
are defined by the SQL - no fixed column list. This module only reproduces the
light post-processing the original build_odoo_landing_* DAGs applied:

  * flatten Odoo i18n jsonb fields ({"en_US": "..."} -> "...")
  * convert naive-UTC timestamps to Asia/Hong_Kong strings
  * map the sale-order status enum (cancel/sale/sent -> cancelled/completed/confirmed)

No DB / no I/O -- unit-testable.
"""

from datetime import datetime

import pandas as pd
import pytz

_HK = pytz.timezone("Asia/Hong_Kong")

# Odoo sale_order.state -> CDP trxn_order_status
_SO_STATUS = {"cancel": "cancelled", "sale": "completed", "sent": "confirmed"}


def rows_to_df(rows):
    """Build a DataFrame from PsqlConnector output (first row = column names)."""
    if not rows:
        return pd.DataFrame()
    columns = rows[0]
    return pd.DataFrame(rows[1:], columns=columns)


def _flatten_i18n(v):
    if isinstance(v, dict) and "en_US" in v:
        return v["en_US"]
    return v


def _to_hk_str(v):
    if not isinstance(v, datetime):
        return v
    if v.tzinfo is None:
        v = pytz.UTC.localize(v)
    return v.astimezone(_HK).strftime("%Y-%m-%d %H:%M:%S.%f%z")


def post_process(df, key):
    """Flatten i18n, localize timestamps, and map sale-order status (key=='so')."""
    if df is None or len(df) == 0:
        return df
    df = df.copy()
    for col in df.columns:
        s = df[col]
        if s.map(lambda v: isinstance(v, dict)).any():
            s = s.map(_flatten_i18n)
        if s.map(lambda v: isinstance(v, datetime)).any():
            s = s.map(_to_hk_str)
        df[col] = s
    if key == "so" and "trxn_order_status" in df.columns:
        df["trxn_order_status"] = df["trxn_order_status"].map(lambda x: _SO_STATUS.get(x, "draft"))
    return df
