#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-call Odoo view runner shared by the scheduled and trial-flow DAGs.

``run_view(dict_config, view)`` reads the client's ``docs/clients/<client>/schema.json``,
runs the CORE-RAW SQL scripts for that view against the client's Odoo Postgres,
post-processes (i18n / timestamps / status), and full-replaces each ``odoo.<key>``
table in the Data Postgres.
"""

import json
import os

from dags.click_cdp_ai_dags.lib import odoo_client, odoo_state
from dags.click_cdp_ai_dags.lib import odoo_transforms as ot
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("odoo")


def _schema_path(client):
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    return os.path.join(repo_root, "docs", "clients", client, "schema.json")


def run_view(dict_config, view):
    client = dict_config["client"]
    company_id = dict_config["company_id"]
    _log.info(f"[odoo] {view} for client={client}")

    path = _schema_path(client)
    if not os.path.exists(path):
        _log.warning(f"[odoo] no schema.json for {client}, skipping")
        return
    with open(path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    if view not in schema:
        _log.warning(f"[odoo] client {client} has no '{view}' schema, skipping")
        return

    scripts = schema[view]
    core = odoo_state.CORE_RAW[view]
    connector = odoo_client.build_connector(company_id, client)
    try:
        for key, script in scripts.items():
            if key not in core:
                continue  # skip summary/aggregate tables
            if isinstance(script, list):
                rows = []
                for i, name in enumerate(script):
                    rows += odoo_client.run_script(connector, view, client, name, index=i)
            else:
                rows = odoo_client.run_script(connector, view, client, script, index=0)

            df = ot.post_process(ot.rows_to_df(rows), key)
            if df is not None and len(df) > 0 and "capsuite_ref" not in df.columns:
                df["capsuite_ref"] = client
            n = odoo_state.persist(df, client, key)
            _log.info(f"[odoo] {view}/{key}: loaded {n} rows")
    finally:
        try:
            connector.close()
        except Exception:
            pass
