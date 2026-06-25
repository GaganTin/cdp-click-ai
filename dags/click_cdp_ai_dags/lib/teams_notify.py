#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Microsoft Teams notifier for the click_cdp_ai DAG fleet.

Two notification tiers share this module:

  - Tier 1 (real-time): ``send_failure_alert`` - one card the moment a DAG run
    fails (called from the DAG-level ``on_failure_callback``, i.e. AFTER task
    retries are exhausted, so transient blips don't spam the channel).
  - Tier 2 (daily digest): ``send_adaptive_card`` posts the summary card built by
    lib/digest from the sync-control tables.

Provider-agnostic + safe-by-default
-----------------------------------
The webhook URL is read from the ``cdp_ai_teams_webhook_url`` Airflow Variable
(falling back to the ``TEAMS_WEBHOOK_URL`` env var). When NEITHER is set this
module is a NO-OP - it logs at debug and returns - so it can ship before the
Teams endpoint exists and never affects a pipeline's success/failure.

The payload is an Adaptive Card wrapped in the Bot-Framework ``attachments``
envelope, which is what both the new Power Automate "Workflows" webhook trigger
and the (legacy) Teams "Incoming Webhook" connector accept. Point
``cdp_ai_teams_webhook_url`` at whichever you create.

Notification failures are swallowed (logged, never raised): telling someone a DAG
failed must never itself fail the DAG.
"""

import os

from dags.click_cdp_ai_dags.lib.log import get_logger

_log = get_logger("teams")

_WEBHOOK_VARIABLE = "cdp_ai_teams_webhook_url"
_WEBHOOK_ENV = "TEAMS_WEBHOOK_URL"

# Adaptive Card container styles -> used for the colored status header bar.
STYLE_GOOD = "good"        # green  - all healthy
STYLE_WARNING = "warning"  # amber  - recovered-on-retry / 0-row warnings
STYLE_ATTENTION = "attention"  # red - failures


def _webhook_url():
    """Resolve the Teams webhook URL, or ``None`` when not configured."""
    try:
        from airflow.models import Variable
        url = Variable.get(_WEBHOOK_VARIABLE, default_var=os.environ.get(_WEBHOOK_ENV, ""))
    except Exception:
        url = os.environ.get(_WEBHOOK_ENV, "")
    return (url or "").strip() or None


def _post(payload):
    """POST ``payload`` to the Teams webhook. Best-effort; never raises."""
    url = _webhook_url()
    if not url:
        _log.debug("No Teams webhook configured (%s / %s); skipping notification",
                   _WEBHOOK_VARIABLE, _WEBHOOK_ENV)
        return False
    try:
        import requests
        r = requests.post(url, json=payload, timeout=30)
        if r.status_code >= 300:
            _log.error("Teams webhook -> HTTP %s: %s", r.status_code, (r.text or "")[:300])
            return False
        _log.info("Teams webhook -> %s", r.status_code)
        return True
    except Exception as exc:  # noqa: BLE001 - notifications must never break a DAG
        _log.error("Teams webhook failed: %s", exc)
        return False


# --------------------------------------------------------------------------- #
# Adaptive Card helpers
# --------------------------------------------------------------------------- #
def _envelope(card):
    """Wrap an Adaptive Card body in the attachments envelope Teams expects."""
    return {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": card,
            }
        ],
    }


def _header(title, subtitle=None, style=STYLE_GOOD):
    """A colored title bar (Container with a style) + optional subtitle."""
    items = [{
        "type": "TextBlock",
        "text": title,
        "weight": "Bolder",
        "size": "Large",
        "wrap": True,
    }]
    if subtitle:
        items.append({
            "type": "TextBlock",
            "text": subtitle,
            "isSubtle": True,
            "spacing": "None",
            "wrap": True,
        })
    return {"type": "Container", "style": style, "bleed": True, "items": items}


def send_adaptive_card(body, title=None, subtitle=None, style=STYLE_GOOD):
    """Send an Adaptive Card whose body is ``[header] + body`` (a list of card
    elements). ``title``/``subtitle``/``style`` build the colored header bar."""
    elements = []
    if title:
        elements.append(_header(title, subtitle, style))
    elements.extend(body or [])
    card = {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": elements,
    }
    return _post(_envelope(card))


# --------------------------------------------------------------------------- #
# Tier 1 - real-time failure alert
# --------------------------------------------------------------------------- #
def send_failure_alert(dag_id, integration_type=None, client=None, error=None,
                       run_id=None, task_id=None):
    """Post a single red "DAG failed" card. Called from the DAG-level
    ``on_failure_callback`` so it fires once, after retries are exhausted."""
    facts = []
    if integration_type:
        facts.append({"title": "Integration", "value": str(integration_type)})
    facts.append({"title": "DAG", "value": str(dag_id or "?")})
    if client:
        facts.append({"title": "Client", "value": str(client)})
    if task_id:
        facts.append({"title": "Task", "value": str(task_id)})
    if run_id:
        facts.append({"title": "Run", "value": str(run_id)})

    body = [{"type": "FactSet", "facts": facts}]
    if error:
        body.append({
            "type": "TextBlock",
            "text": f"**Error:** {str(error)[:800]}",
            "wrap": True,
            "color": "Attention",
            "spacing": "Medium",
        })
    return send_adaptive_card(
        body,
        title="❌ DAG failed",
        subtitle=str(client) if client else "Scheduled run (all workspaces)",
        style=STYLE_ATTENTION,
    )
