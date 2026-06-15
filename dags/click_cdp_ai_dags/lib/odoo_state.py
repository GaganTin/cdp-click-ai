#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Odoo persistence glue for the click_cdp_ai pipeline.

Odoo raw tables land in the Data Postgres ``odoo`` schema. Each table is a FULL
snapshot (the SQL scripts are full extracts), so we full-replace the client's
rows. Only the CORE-RAW tables are migrated -- summary/aggregate tables
(sales_summary, member_summary, so_daily, etc.) are skipped per scope.
"""

from datetime import datetime, timedelta

import pytz

ODOO_SCHEMA = "odoo"
ODOO_CONTROL_TABLE = "odoo_sync_control"
_HK = pytz.timezone("Asia/Hong_Kong")

# Core-raw tables per view (skip summaries/aggregates).
CORE_RAW = {
    "sale": ["so", "sol", "product"],
    "membership": ["mem"],
    "purchase": ["po", "pol"],
    "inventory": ["stock_move", "stock_move_line", "stock_picking", "stock_quant"],
}


def _token():
    return (datetime.today().astimezone(_HK) - timedelta(days=1)).strftime("%Y%m%d")


def persist(df, client, key):
    """Full-replace the client's rows in ``odoo.<key>`` and advance the watermark."""
    from dags.click_cdp_ai_dags.lib import pg_loader
    return pg_loader.load_dataframe(
        df, table_name=key, client=client,
        scope_column=None, scope_values=None,
        schema=ODOO_SCHEMA, report=key,
        watermark_value=_token(), control_table=ODOO_CONTROL_TABLE,
    )
