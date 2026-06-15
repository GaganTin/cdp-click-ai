#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Odoo source connector for the click_cdp_ai pipeline.

Odoo data is pulled by running the shared SQL scripts in
``dags/sql_lib/customer/*.sql`` against each client's OWN Odoo Postgres. We reuse
the existing ``dags.utils.psql.PsqlConnector`` (it handles the optional SSH
tunnel and the per-script column-existence patching); the connection details come
from the App DB via ``app_state.get_odoo_conn_kwargs`` and the SSH credentials
from the per-client ``pg_ssh_username_<client>`` / ``pg_ssh_pkey_<client>``
Airflow Variables (unchanged from the original).
"""

from dags.click_cdp_ai_dags.lib import app_state

# view -> the PsqlConnector method that loads + runs that view's SQL scripts.
_METHOD = {
    "sale": "get_sale_data",
    "purchase": "get_purchase_data",
    "inventory": "get_inventory_data",
    "membership": "get_membership_data",
}


def _ssh_creds(client):
    try:
        from airflow.models import Variable
        user = Variable.get(f"pg_ssh_username_{client}", default_var=None)
        pkey = Variable.get(f"pg_ssh_pkey_{client}", default_var=None)
    except Exception:
        user = pkey = None
    return (user, pkey) if (user and pkey) else (None, None)


def build_connector(company_id, client):
    """Open a PsqlConnector to the client's Odoo Postgres (App DB-sourced creds)."""
    ck = app_state.get_odoo_conn_kwargs(company_id)
    if not ck or not ck.get("host"):
        raise RuntimeError(f"No connected Odoo connection for company {company_id}")
    from dags.utils.psql import PsqlConnector
    ssh_user, ssh_pkey = _ssh_creds(client)
    return PsqlConnector(
        ck["host"], ck["dbname"], ck["port"], ck["user"], ck["password"],
        ssh_tunnel=bool(ssh_user and ssh_pkey),
        str_ssh_username=ssh_user, str_ssh_pkey=ssh_pkey,
    )


def run_script(connector, view, client, script_name, index=0):
    """Run one SQL script for a client; returns rows (first row = column names
    when index == 0), matching PsqlConnector's contract."""
    method = getattr(connector, _METHOD[view])
    return method(client, script_name, index)
