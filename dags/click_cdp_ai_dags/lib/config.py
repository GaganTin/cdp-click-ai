#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared configuration / connector factories for the GA landing DAGs.

All Airflow Variable reads are done lazily (inside functions) so this module can
be imported without an Airflow context and so a missing optional Variable (e.g.
the Postgres connection when Postgres is disabled) never breaks DAG parsing.
"""

import json

STR_TARGET_VIEW = "googleAnalytics"

# Airflow Variable that controls the storage behaviour for this (click_cdp_ai)
# pipeline. This folder is the Postgres path, so the default is POSTGRES ONLY
# (no Blob writes). The original DAGs remain the Blob path and are untouched.
# Override with the Variable only if you want Blob as well, e.g. ["blob","postgres"]
# or "blob,postgres".
STORAGE_TARGETS_VARIABLE = "ga_storage_targets"
DEFAULT_STORAGE_TARGETS = ["postgres"]

# Airflow Variables holding the destination Postgres connection. For the k8s
# database accessed via `kubectl port-forward`, set cdp_pg_host_name=localhost and
# cdp_pg_db_port to the forwarded port.
PG_VARIABLES = {
    "host": "cdp_pg_host_name",
    "port": "cdp_pg_db_port",
    "dbname": "cdp_pg_db_name",
    "user": "cdp_pg_db_user",
    "password": "cdp_pg_db_password",
}

# Target schema in Postgres. The canonical GA landing tables (company-scoped) live
# in ga_landing; the app, the seed data and the AI all read ga_landing.<dataset>
# (no "ga_" prefix), so the loader must write there.
PG_SCHEMA = "ga_landing"


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


def get_pg_conn_kwargs():
    """Return psycopg2 connection kwargs built from the cdp_pg_* Variables, or
    ``None`` if the host is not configured."""
    host = _get_variable(PG_VARIABLES["host"], None)
    if not host:
        return None
    return {
        "host": host,
        "port": _get_variable(PG_VARIABLES["port"], None),
        "dbname": _get_variable(PG_VARIABLES["dbname"], None),
        "user": _get_variable(PG_VARIABLES["user"], None),
        "password": _get_variable(PG_VARIABLES["password"], None),
        # Keep the (port-forwarded) connection alive so the tunnel does not drop
        # it mid-task, and fail fast if the tunnel is down.
        "connect_timeout": 10,
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5,
    }


def get_blob_connector():
    """Build the Azure Blob connector from the existing ``azure_blob_conn``
    Variable (lazy so import never requires Airflow)."""
    from dags.utils.azure_blob import AzureBlob
    return AzureBlob(_get_variable("azure_blob_conn"))


def get_ga_service_account():
    return _get_variable("ga_service_account")


def get_gsc_service_account():
    return _get_variable("gsc_service_account")
