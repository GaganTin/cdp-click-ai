#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared configuration / connector factories for the GA landing DAGs.

All Airflow Variable reads are done lazily (inside functions) so this module can
be imported without an Airflow context and so a missing optional Variable (e.g.
the Postgres connection when Postgres is disabled) never breaks DAG parsing.
"""

import json
import os

STR_TARGET_VIEW = "googleAnalytics"

# Airflow Variable that controls the storage behaviour for this (click_cdp_ai)
# pipeline. This folder is the Postgres path, so the default is POSTGRES ONLY
# (no Blob writes). The original DAGs remain the Blob path and are untouched.
# Override with the Variable only if you want Blob as well, e.g. ["blob","postgres"]
# or "blob,postgres".
STORAGE_TARGETS_VARIABLE = "cdp_ai_ga_storage_targets"
DEFAULT_STORAGE_TARGETS = ["postgres"]

# Target schema in Postgres. The canonical GA landing tables (company-scoped) live
# in ga_landing; the app, the seed data and the AI all read ga_landing.<dataset>
# (no "ga_" prefix), so the loader must write there.
PG_SCHEMA = "ga_landing"

# The App DB schema holding tenancy + integration config + sync-job status
# (app.companies, app.data_integrations, app.company_report_config,
# app.integration_sync_jobs). Read by lib/app_state for the commerce DAGs.
APP_SCHEMA = "app"


def _get_variable(key, default=None):
    """Read an Airflow Variable, returning ``default`` if Airflow is unavailable
    or the key is not set. Imported lazily so the module stays import-safe."""
    try:
        from airflow.models import Variable
    except Exception:
        return default
    return Variable.get(key, default_var=default)


def get_storage_targets():
    """Return the active storage targets as a lower-cased list, e.g.
    ``["blob", "postgres"]``."""
    raw = _get_variable(STORAGE_TARGETS_VARIABLE, None)
    if not raw:
        return list(DEFAULT_STORAGE_TARGETS)

    if isinstance(raw, (list, tuple)):
        values = list(raw)
    else:
        text = str(raw).strip()
        try:
            parsed = json.loads(text)
            values = parsed if isinstance(parsed, (list, tuple)) else [parsed]
        except (ValueError, TypeError):
            values = [chunk.strip() for chunk in text.split(",")]

    return [str(v).strip().lower() for v in values if str(v).strip()]


def blob_enabled():
    return "blob" in get_storage_targets()


def postgres_enabled():
    return "postgres" in get_storage_targets()


def get_app_pg_conn_kwargs():
    """psycopg2 connection kwargs for the CDP Postgres, built from the single
    ``cdp_ai_app_pg_conn`` Airflow Variable (a ``postgresql://`` URL). Returns
    ``None`` if it is not set. lib/db.run_tx does ``psycopg2.connect(**kwargs)``,
    and psycopg2 accepts the full URL via the ``dsn`` keyword."""
    dsn = _get_variable("cdp_ai_app_pg_conn", None)
    if not dsn:
        return None
    return {
        "dsn": dsn,
        "connect_timeout": 10,
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5,
    }


# The CDP uses ONE Postgres for everything (app config in the ``app`` schema AND
# the GA landing tables in ``ga_landing``), so the GA/GSC loaders share the same
# single connection Variable - no separate cdp_pg_* host/port/user/password set.
get_pg_conn_kwargs = get_app_pg_conn_kwargs


def pool_default_args(variable_name, env_name=None):
    """``default_args`` fragment that pins a DAG's tasks to an Airflow pool, so the
    source API's concurrency is capped across ALL runs (manual + daily).

    The pool NAME is read from the ``<variable_name>`` Airflow Variable (preferred -
    set it in the UI: Admin -> Variables), falling back to the optional
    ``<env_name>`` environment variable. Returns ``{}`` when neither is set (no
    pool). NOTE: the pool itself must be created first (Admin -> Pools)."""
    name = _get_variable(variable_name, None)
    if not name and env_name:
        name = os.environ.get(env_name)
    return {"pool": name} if name else {}


def get_blob_connector():
    """Build the Azure Blob connector from the existing ``azure_blob_conn``
    Variable (lazy so import never requires Airflow)."""
    from dags.utils.azure_blob import AzureBlob
    return AzureBlob(_get_variable("cdp_ai_azure_blob_conn"))


def get_ga_service_account():
    return _get_variable("cdp_ai_ga_service_account")


def get_gsc_service_account():
    return _get_variable("cdp_ai_gsc_service_account")
