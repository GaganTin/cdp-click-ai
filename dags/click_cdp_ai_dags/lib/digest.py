#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Daily sync digest (Tier 2) for the click_cdp_ai DAG fleet.

Builds ONE Teams Adaptive Card summarising the last day's syncs, assembled from
two sources:

  - the sync-control tables (one per platform: ``ga_landing.ga_sync_control``,
    ``shopify.shopify_sync_control``, ``shopline.shopline_sync_control``,
    ``odoo.odoo_sync_control``) -> which (client, report) ran and how many rows it
    loaded, so we can flag clients that *synced but loaded 0 rows* (a silent
    "connection returns nothing" failure, distinct from a hard error);

  - the Airflow metadata DB -> which DAG runs FAILED outright, and which tasks
    FAILED at least once but SUCCEEDED on retry (the "flaky but healthy" bucket).

The card is intentionally a glance: red failures first, amber warnings next, a
green healthy summary last. Real-time hard-failure alerts are Tier 1
(lib/teams_notify.send_failure_alert); this digest is the daily health snapshot.
"""

from datetime import timedelta

from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import teams_notify
from dags.click_cdp_ai_dags.lib.log import get_logger

_log = get_logger("digest")

# GSC shares the GA control table (ga_landing.ga_sync_control) but is a distinct
# integration, so we split it out by report name into its own digest line.
GSC_REPORTS = ["keyword_performance"]

# Per-platform control-table sources. Each entry is a dict so GA and GSC can read
# the SAME table but partition it by report (exclude_reports / include_reports).
CONTROL_TABLES = [
    {"schema": "ga_landing", "table": "ga_sync_control", "label": "GA",
     "exclude_reports": GSC_REPORTS},
    {"schema": "ga_landing", "table": "ga_sync_control", "label": "GSC",
     "include_reports": GSC_REPORTS},
    {"schema": "shopify", "table": "shopify_sync_control", "label": "Shopify"},
    {"schema": "shopline", "table": "shopline_sync_control", "label": "Shopline"},
    {"schema": "odoo", "table": "odoo_sync_control", "label": "Odoo"},
]

# The integration DAGs whose runs this digest reports on (for the Airflow-metadata
# failed / recovered-on-retry scan). NOTE these are the real dag_ids:
#   - the GA child report DAGs carry the precise failing task, so we scan THEM
#     (not the GA orchestrator, whose rollup failure would just double-count a
#     child failure; orchestrator own-task failures still fire a Tier 1 alert);
#   - GSC's dag_id is click_cdp_ai_gsc_keyword_performance (no "integration_").
FLEET_DAG_IDS = [
    "click_cdp_ai_integration_ga_reports_path_funnel",
    "click_cdp_ai_integration_ga_reports_content",
    "click_cdp_ai_integration_ga_reports_purchase",
    "click_cdp_ai_integration_ga_reports_ecommerce",
    "click_cdp_ai_integration_ga_reports_acquisition",
    "click_cdp_ai_integration_ga_reports_audience",
    "click_cdp_ai_integration_ga_reports_retention",
    "click_cdp_ai_gsc_keyword_performance",
    "click_cdp_ai_integration_shopify",
    "click_cdp_ai_integration_shopline",
    "click_cdp_ai_integration_odoo",
]

DEFAULT_LOOKBACK_HOURS = 24


# --------------------------------------------------------------------------- #
# Source 1: sync-control tables (volumes + zero-row clients)
# --------------------------------------------------------------------------- #
def _collect_control(conn_kwargs, lookback_hours):
    """Per-platform per-client roll-up of what ran in the lookback window.

    Returns ``{label: {"clients": int, "reports": int, "rows": int,
    "zero_row_clients": [client, ...]}}``. A client lands in ``zero_row_clients``
    when it ran one or more reports in the window but every one loaded 0 rows -
    i.e. the sync "succeeded" but produced nothing.
    """
    from dags.click_cdp_ai_dags.lib import db
    from psycopg2 import sql

    out = {}

    def _do(conn):
        for entry in CONTROL_TABLES:
            schema, table, label = entry["schema"], entry["table"], entry["label"]
            # WHERE: only the lookback window, plus an optional report partition so
            # GA and GSC can share ga_sync_control yet report separately.
            conds = [sql.SQL("last_run_at >= now() - %s::interval")]
            params = [f"{lookback_hours} hours"]
            if entry.get("include_reports"):
                conds.append(sql.SQL("report = ANY(%s)"))
                params.append(list(entry["include_reports"]))
            if entry.get("exclude_reports"):
                conds.append(sql.SQL("NOT (report = ANY(%s))"))
                params.append(list(entry["exclude_reports"]))
            with conn.cursor() as cur:
                # Skip platforms whose control table doesn't exist yet.
                cur.execute("SELECT to_regclass(%s)", (f"{schema}.{table}",))
                if cur.fetchone()[0] is None:
                    continue
                cur.execute(
                    sql.SQL(
                        """
                        SELECT capsuite_ref,
                               COUNT(*)                          AS reports,
                               COALESCE(SUM(COALESCE(rows_loaded, 0)), 0) AS rows
                        FROM {}.{}
                        WHERE {}
                        GROUP BY capsuite_ref
                        """
                    ).format(sql.Identifier(schema), sql.Identifier(table),
                             sql.SQL(" AND ").join(conds)),
                    params,
                )
                rows = cur.fetchall()
            clients = len(rows)
            total_reports = sum(r[1] for r in rows)
            total_rows = sum(int(r[2]) for r in rows)
            zero_clients = [r[0] for r in rows if int(r[2]) == 0]
            out[label] = {
                "clients": clients,
                "reports": total_reports,
                "rows": total_rows,
                "zero_row_clients": zero_clients,
            }
        return out

    try:
        return db.run_tx(conn_kwargs, _do)
    except Exception as exc:  # noqa: BLE001
        _log.error("digest: control-table collection failed: %s", exc)
        return {}


# --------------------------------------------------------------------------- #
# Source 2: Airflow metadata (failures + recovered-on-retry)
# --------------------------------------------------------------------------- #
def _collect_airflow(lookback_hours):
    """Return ``(failed, recovered)`` from the Airflow metadata DB.

    ``failed``    -> [{dag_id, task_id, run_id, error}] for tasks whose final
                     state is failed in the window.
    ``recovered`` -> [{dag_id, task_id, run_id, tries}] for tasks that ended
                     successful but took more than one try (failed then passed).
                     ``try_number > 1`` is a heuristic that holds across Airflow
                     2.x for finished task instances.
    """
    failed, recovered = [], []
    try:
        from airflow.models import TaskInstance
        from airflow.utils.timezone import utcnow
        from airflow.utils.session import create_session

        cutoff = utcnow() - timedelta(hours=lookback_hours)
        # Build the result lists INSIDE the session: _short_reason reads ti.note,
        # which in Airflow >=2.5 is a lazy relationship (association proxy). Reading
        # it after the session closes raises DetachedInstanceError - not an
        # AttributeError, so getattr(..., None) doesn't catch it - which would bubble
        # up to the except below and silently drop every failure. Keep it attached.
        with create_session() as session:
            tis = (
                session.query(TaskInstance)
                .filter(TaskInstance.dag_id.in_(FLEET_DAG_IDS))
                .filter(TaskInstance.start_date >= cutoff)
                .all()
            )
            for ti in tis:
                if ti.state == "failed":
                    failed.append({
                        "dag_id": ti.dag_id,
                        "task_id": ti.task_id,
                        "run_id": ti.run_id,
                        "error": _short_reason(ti),
                    })
                elif ti.state == "success" and (ti.try_number or 1) > 1:
                    recovered.append({
                        "dag_id": ti.dag_id,
                        "task_id": ti.task_id,
                        "run_id": ti.run_id,
                        "tries": ti.try_number,
                    })
    except Exception as exc:  # noqa: BLE001
        _log.error("digest: Airflow-metadata collection failed: %s", exc)
    return failed, recovered


def _short_reason(ti):
    """Best-effort one-line failure reason for a task instance.

    ``ti.note`` is a lazy relationship (Airflow >=2.5) - reading it can raise if
    the instance is detached, so never let it abort the surrounding scan.
    """
    try:
        note = getattr(ti, "note", None)
    except Exception:  # noqa: BLE001 - detached/relationship load failure
        note = None
    if note:
        return str(note)[:160]
    return "task failed (see Airflow logs)"


# --------------------------------------------------------------------------- #
# Assemble + send
# --------------------------------------------------------------------------- #
def collect(conn_kwargs=None, lookback_hours=DEFAULT_LOOKBACK_HOURS):
    """Gather the full digest report dict from both sources."""
    conn_kwargs = conn_kwargs or ga_config.get_pg_conn_kwargs()
    control = _collect_control(conn_kwargs, lookback_hours) if conn_kwargs else {}
    failed, recovered = _collect_airflow(lookback_hours)
    return {
        "lookback_hours": lookback_hours,
        "control": control,
        "failed": failed,
        "recovered": recovered,
    }


def _bullet_list(lines):
    return {"type": "TextBlock", "wrap": True, "text": "\n".join(f"- {ln}" for ln in lines)}


def build_card(report):
    """Return ``(title, subtitle, style, body_elements)`` for the digest card."""
    control = report.get("control", {})
    failed = report.get("failed", [])
    recovered = report.get("recovered", [])
    zero_pairs = [
        (label, client)
        for label, info in control.items()
        for client in info.get("zero_row_clients", [])
    ]

    total_clients = sum(i.get("clients", 0) for i in control.values())
    total_reports = sum(i.get("reports", 0) for i in control.values())
    total_rows = sum(i.get("rows", 0) for i in control.values())

    if failed:
        style = teams_notify.STYLE_ATTENTION
        emoji = "🔴"
    elif recovered or zero_pairs:
        style = teams_notify.STYLE_WARNING
        emoji = "🟠"
    else:
        style = teams_notify.STYLE_GOOD
        emoji = "🟢"

    title = f"{emoji} CDP Daily Sync Digest"
    subtitle = (f"{total_clients} clients · {total_reports} datasets · "
                f"{total_rows:,} rows · last {report.get('lookback_hours', 24)}h")

    body = []

    if failed:
        body.append({"type": "TextBlock", "weight": "Bolder", "color": "Attention",
                     "text": f"❌ Failed ({len(failed)})", "spacing": "Medium"})
        body.append(_bullet_list([
            f"**{f['dag_id'].replace('click_cdp_ai_integration_', '')}** — "
            f"{f['task_id']} — {f['error']}"
            for f in failed[:25]
        ]))

    if recovered:
        body.append({"type": "TextBlock", "weight": "Bolder",
                     "text": f"⚠️ Recovered on retry ({len(recovered)})", "spacing": "Medium"})
        body.append(_bullet_list([
            f"**{r['dag_id'].replace('click_cdp_ai_integration_', '')}** — "
            f"{r['task_id']} (passed on try {r['tries']})"
            for r in recovered[:25]
        ]))

    if zero_pairs:
        body.append({"type": "TextBlock", "weight": "Bolder",
                     "text": f"🕳️ Synced but 0 rows ({len(zero_pairs)})", "spacing": "Medium"})
        body.append(_bullet_list([f"{label} — {client}" for label, client in zero_pairs[:25]]))

    # Per-platform healthy roll-up.
    facts = [
        {"title": label, "value": f"{info['clients']} clients · {info['rows']:,} rows"}
        for label, info in control.items() if info.get("clients", 0) > 0
    ]
    if facts:
        body.append({"type": "TextBlock", "weight": "Bolder", "text": "📊 By platform",
                     "spacing": "Medium"})
        body.append({"type": "FactSet", "facts": facts})

    if not failed and not recovered and not zero_pairs:
        body.append({"type": "TextBlock", "wrap": True,
                     "text": "✅ All connected workspaces synced cleanly."})

    return title, subtitle, style, body


def run_and_send(conn_kwargs=None, lookback_hours=DEFAULT_LOOKBACK_HOURS):
    """Collect the digest and post it to Teams. Returns the report dict."""
    report = collect(conn_kwargs=conn_kwargs, lookback_hours=lookback_hours)
    title, subtitle, style, body = build_card(report)
    teams_notify.send_adaptive_card(body, title=title, subtitle=subtitle, style=style)
    _log.info("digest sent: %d failed, %d recovered, %d zero-row",
              len(report["failed"]), len(report["recovered"]),
              sum(len(i.get("zero_row_clients", [])) for i in report["control"].values()))
    return report
