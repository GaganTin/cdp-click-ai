#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Resilient Postgres transaction helper for the click_cdp_ai pipeline.

The destination Postgres is reached over a local ``kubectl port-forward``, which
can drop idle/long-lived connections (psycopg2 then raises
``OperationalError`` / ``InterfaceError: connection already closed``).

``run_tx`` opens a FRESH connection, runs the given callable, commits, and on a
connection-level error retries the whole unit of work on a new connection. The
callables used here are idempotent (scoped delete -> insert -> watermark upsert),
so a retry is safe.
"""

import time
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("db")

try:
    import psycopg2
except ImportError as exc:  # pragma: no cover
    raise ImportError("psycopg2 is required. Install psycopg2-binary.") from exc


# Connection-level errors worth retrying (the link dropped). Anything else
# (ProgrammingError, DataError, ...) is a real bug and is raised immediately.
_RETRYABLE = (psycopg2.OperationalError, psycopg2.InterfaceError)


def run_tx(conn_kwargs, fn, attempts=3, delay_seconds=2):
    """Run ``fn(conn)`` inside one transaction with reconnect-on-drop retries.

    ``fn`` should issue its statements on the given connection and NOT commit;
    ``run_tx`` commits on success and rolls back / retries on a dropped link.
    """
    last_error = None
    for attempt in range(1, attempts + 1):
        conn = None
        try:
            conn = psycopg2.connect(**conn_kwargs)
            result = fn(conn)
            conn.commit()
            return result
        except _RETRYABLE as error:
            last_error = error
            _log.error(f"[db] connection lost (attempt {attempt}/{attempts}): {error}")
            if conn is not None:
                try:
                    conn.rollback()
                except Exception:
                    pass
            if attempt < attempts:
                time.sleep(delay_seconds)
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    raise last_error
