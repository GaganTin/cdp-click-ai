#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hybrid persistence for the GA landing DAGs.

Each landing task used to end with a block that wrote per-date parquet files to
the Azure Blob "landing" container. That block is now a single call to
``persist_by_date`` (or ``persist_funnel`` for the monthly funnel report), which:

  * writes the exact same parquet files to Blob   -> when "blob"     is enabled
  * loads the DataFrame into ga_<prefix> in Postgres -> when "postgres" is enabled

The active targets come from the ``ga_storage_targets`` Airflow Variable and
default to BOTH (see config.py), so Postgres is additive and nothing existing
breaks. Blob behaviour is byte-for-byte identical to the original tasks.
"""

from datetime import datetime
from io import BytesIO

import pendulum

from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("storage")


def _blob():
    return ga_config.get_blob_connector()


def persist_by_date(
    df,
    client,
    prefix,
    blob=None,
    date_col="date",
    dashed_source_date=False,
):
    """Persist a per-date landing DataFrame to the active targets.

    Parameters
    ----------
    df : DataFrame partitioned implicitly by ``date_col``.
    client : capsuite_ref.
    prefix : dataset prefix, e.g. ``utm_performance`` (blob file prefix and the
        ``ga_<prefix>`` Postgres table).
    dashed_source_date : when True ``date_col`` holds ``YYYY-MM-DD`` and the blob
        filename uses the ``YYYYMMDD`` form (page / website metrics); when False
        the raw ``date_col`` value is used verbatim (already ``YYYYMMDD``).
    """
    if df is None or len(df) == 0:
        _log.warning("No new data can be exported")
        # Record the 0-row run so the daily digest can flag a client that synced
        # but produced nothing (otherwise an empty load is invisible).
        if ga_config.postgres_enabled():
            from dags.click_cdp_ai_dags.lib import pg_loader
            pg_loader.record_zero_row_run(client, prefix)
        return

    view = ga_config.STR_TARGET_VIEW

    if ga_config.blob_enabled():
        connector = blob or _blob()
        for date in df[date_col].unique().tolist():
            tmp_df = df.loc[df[date_col] == date].reset_index(drop=True)
            buffer = BytesIO()
            tmp_df.to_parquet(buffer, engine="pyarrow")
            if dashed_source_date:
                date_token = datetime.strptime(date, "%Y-%m-%d").strftime("%Y%m%d")
            else:
                date_token = date
            str_blob = f"{client}/{view}/{prefix}_{date_token}.parquet"
            connector.overwrite_blob("landing", str_blob, buffer.getvalue())
            _log.info(f"Uploaded {date} parquet file to {str_blob}")

    if ga_config.postgres_enabled():
        from dags.click_cdp_ai_dags.lib import pg_loader
        scope_values = df[date_col].unique().tolist()
        pg_loader.load_dataframe(
            df,
            table_name=prefix,
            client=client,
            scope_column=date_col,
            scope_values=scope_values,
            report=prefix,
            watermark_value=max(scope_values) if scope_values else None,
        )


def persist_funnel(df, client, blob=None):
    """Persist the funnel report (partitioned monthly by ``tracking_period``).

    Reproduces the original monthly blob handling, including the
    delete-current-month-files step, and adds the scoped Postgres load keyed on
    ``tracking_period``.
    """
    if df is None or len(df) == 0:
        _log.warning("No new data can be exported")
        if ga_config.postgres_enabled():
            from dags.click_cdp_ai_dags.lib import pg_loader
            pg_loader.record_zero_row_run(client, "funnel_report")
        return

    view = ga_config.STR_TARGET_VIEW
    prefix = "funnel_report"

    if ga_config.blob_enabled():
        connector = blob or _blob()
        for month in df["tracking_period"].unique().tolist():
            df_tmp = df.loc[df["tracking_period"] == month].reset_index(drop=True)
            buffer = BytesIO()
            df_tmp.to_parquet(buffer, engine="pyarrow")
            if pendulum.now("Asia/Hong_Kong").format("YYYY-MM") == month:
                date = pendulum.now("Asia/Hong_Kong").format("YYYYMMDD")
                current_month = month.replace("-", "")
                list_files = connector.get_file_list(
                    "landing", client, view, f"{prefix}_{current_month}", "parquet"
                )
                if len(list_files) > 0:
                    for file in list_files:
                        connector.delete_blob("landing", file.name)
                        _log.info(f"Deleted {file.name}")
            else:
                date = pendulum.from_format(month, "YYYY-MM").end_of("month").format("YYYYMMDD")
            str_blob = f"{client}/{view}/{prefix}_{date}.parquet"
            connector.overwrite_blob("landing", str_blob, buffer.getvalue())
            _log.info(f"Uploaded {month} parquet file to {str_blob}")

    if ga_config.postgres_enabled():
        from dags.click_cdp_ai_dags.lib import pg_loader
        scope_values = df["tracking_period"].unique().tolist()
        pg_loader.load_dataframe(
            df,
            table_name=prefix,
            client=client,
            scope_column="tracking_period",
            scope_values=scope_values,
            report=prefix,
            watermark_value=max(scope_values) if scope_values else None,
        )
