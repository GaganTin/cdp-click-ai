#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Consistent structured logging for ALL click_cdp_ai DAGs (GA, GSC, Shopify,
Shopline, Odoo, commerce, attributes) and their lib helpers.

Airflow captures stdout into the per-task log, but bare ``print`` gives no level,
timestamp or component, which makes 40-50 concurrent client runs impossible to
read. ``get_logger`` returns a module-scoped logger that emits

    2026-06-15 09:00:00 INFO  cdp.shopify | [acme] sync done

Every logger is a child of the single ``cdp`` root, so one handler/format applies
everywhere. ``component`` is a short dotted path (e.g. ``shopify``, ``ga.utm``,
``pg_loader``). Use ``ctx(client, report)`` to build the ``[client/report]`` tag
uniformly so logs from every workspace/report line up and are greppable.
"""

import logging
import sys

_ROOT = "cdp"
_CONFIGURED = False


def _configure_root_once():
    global _CONFIGURED
    if _CONFIGURED:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-5s %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    root = logging.getLogger(_ROOT)
    # Avoid duplicate handlers when Airflow re-imports the module.
    if not root.handlers:
        root.addHandler(handler)
    root.setLevel(logging.INFO)
    root.propagate = False
    _CONFIGURED = True


def get_logger(component):
    """Return a logger named ``cdp.<component>`` (e.g. ``cdp.shopify``)."""
    _configure_root_once()
    return logging.getLogger(f"{_ROOT}.{component}")


def ctx(client=None, report=None):
    """Build a uniform ``[client/report]`` tag for log messages."""
    if client and report:
        return f"[{client}/{report}]"
    if client:
        return f"[{client}]"
    return ""
