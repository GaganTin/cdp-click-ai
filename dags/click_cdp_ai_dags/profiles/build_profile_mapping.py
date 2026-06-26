#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Profile build + identity mapping (runs AFTER the GA landing DAGs).

Postgres / multi-tenant successor to the old Mongo trio
(``build_analytic_ap_anonymous_profile`` + ``build_process_profile_mapping`` +
``build_analytic_ap_membership_web_behavior``). It populates what the Profiles page
reads:

  * Anonymous tab  -> app.anonymous_profiles  (one row per web visitor; resolved
                     ones carry resolved_member_id so the card can show the member)
  * Customer tab   -> app.customer_profiles.ga_* caches (a member's web behaviour)

Anonymous profiles are derived FROM Google Analytics (``ga_landing.path_exploration``
grouped by ``capsuite_apid``). GSC / Search Console is aggregate keyword data with no
per-visitor id, so it does NOT feed profiles.

This DAG is TRIGGERED by the GA orchestrator (click_cdp_ai_integration_ga_reports)
once its report DAGs succeed - so profiles appear every time a GA sync completes.
It is not self-scheduled.

Two modes (the orchestrator passes ``mode`` in the trigger conf):
  * full        - manual "Sync Data" run: rebuild this workspace's AP profiles
                  completely from the last 90 days (DELETE + INSERT, prunes
                  visitors with no activity in the window).
  * incremental - daily scheduled run: only refresh visitors active in the last
                  7 days (UPSERT over the 90-day window; untouched rows are left
                  as-is). Cheaper; a full run corrects any drift.

Per workspace, in ONE transaction, in this order:
  1. BUILD   - (re)build app.anonymous_profiles for the mode's scope.
  2. MAP     - AFTER the AP profiles exist, stitch ``anonymous_id`` identity links
               into app.profile_identities via three prioritised signals:
                 1. purchase: purchase_list.trxn_id -> a commerce/manual order ->
                    that order's customer/member  (strongest: a real sale)
                 2. logged-in: path_exploration.capsuite_uid -> a known member id
                    (identity graph, prefixed id OR source id)
                 3. identifier: capsuite_identifier / capsuite_uid that looks like
                    an email -> a known member's email
               Unique (company, type, lower(value)) + ON CONFLICT DO NOTHING keep
               one member per apid and make re-runs no-ops.
  3. STAMP   - copy the resolved member onto app.anonymous_profiles.resolved_member_id
               (so a mapped visitor stays on the Anonymous tab flagged with its member).
  4. ROLLUP  - roll a member's web behaviour onto app.customer_profiles.ga_* via the
               anonymous_id links (port of refreshProfiles step 1) -> Customer tab.

The DAG OWNS these GA-derived layers. Node ``refreshProfiles()`` stays as the
on-demand fallback. Commerce membership ingest (commerce.customer ->
app.customer_profiles + member_id/email/phone identities the mapping matches against)
stays owned by the commerce flow and is assumed already run.
"""

import os
from datetime import datetime, timedelta

from airflow.decorators import dag, task
from airflow.models import Param
from psycopg2.extras import RealDictCursor

from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import db
from dags.click_cdp_ai_dags.lib import ga_reports as tf
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("profiles.mapping")

# Trailing window the AP profile metrics are computed over (full rebuild bound),
# and the "recently active" window that selects which visitors an incremental run
# refreshes.
WINDOW_DAYS = 90
RECENT_DAYS = 7


# --------------------------------------------------------------------------- #
# A valid GA anonymous id: present, not a GA placeholder, long enough to be a
# real client id (mirrors the guard in server/index.js refreshProfiles step 2).
# --------------------------------------------------------------------------- #
def _apid_ok(col):
    return f"{col} IS NOT NULL AND {col} NOT IN ('', '(not set)') AND length({col}) > 6"


# --------------------------------------------------------------------------- #
# 1. BUILD app.anonymous_profiles. The metric SELECT is shared; full mode does a
#    DELETE + plain INSERT over the 90d window, incremental mode an UPSERT limited
#    to visitors active in the last 7d (still aggregated over 90d so the numbers
#    match a full rebuild). resolved_member_id is left for step 3 (after mapping).
# --------------------------------------------------------------------------- #
_ANON_COLS = (
    "company_id, visitor_id, first_seen, last_seen, total_events, page_views, sessions, "
    "first_visits, form_starts, form_completes, scroll_events, whatsapp_clicks, file_downloads, "
    "click_events, user_engagement, top_source_medium, top_campaign, "
    "source_mediums, campaigns, events, pages_visited, last_refreshed"
)

_ANON_SELECT_EXPR = """
    %(cid)s,
    pe.capsuite_apid,
    MIN(TO_DATE(pe.date, 'YYYYMMDD')),
    MAX(TO_DATE(pe.date, 'YYYYMMDD')),
    COUNT(*),
    SUM(CASE WHEN pe.event_name = 'page_view'                                         THEN 1 ELSE 0 END),
    SUM(CASE WHEN pe.event_name = 'session_start'                                     THEN 1 ELSE 0 END),
    SUM(CASE WHEN pe.event_name = 'first_visit'                                       THEN 1 ELSE 0 END),
    SUM(CASE WHEN pe.event_name IN ('Event_Form_Start','form_start')                  THEN 1 ELSE 0 END),
    SUM(CASE WHEN pe.event_name IN ('Event_Form_Complete','form_submit','Contact_Us_Form_Complete') THEN 1 ELSE 0 END),
    SUM(CASE WHEN pe.event_name = 'scroll'                                            THEN 1 ELSE 0 END),
    SUM(CASE WHEN pe.event_name IN ('Whatsapp_Click','GTM_Whatsapp_Click')            THEN 1 ELSE 0 END),
    SUM(CASE WHEN pe.event_name = 'file_download'                                    THEN 1 ELSE 0 END),
    SUM(CASE WHEN pe.event_name IN ('click','click_button')                           THEN 1 ELSE 0 END),
    SUM(CASE WHEN pe.event_name = 'user_engagement'                                  THEN 1 ELSE 0 END),
    MODE() WITHIN GROUP (ORDER BY pe.session_source_medium),
    MODE() WITHIN GROUP (ORDER BY pe.session_campaign_name),
    ARRAY_AGG(DISTINCT pe.session_source_medium) FILTER (WHERE pe.session_source_medium IS NOT NULL AND pe.session_source_medium NOT IN ('','(not set)')),
    ARRAY_AGG(DISTINCT pe.session_campaign_name) FILTER (WHERE pe.session_campaign_name IS NOT NULL AND pe.session_campaign_name NOT IN ('','(not set)')),
    ARRAY_AGG(DISTINCT pe.event_name)            FILTER (WHERE pe.event_name IS NOT NULL),
    ARRAY_AGG(DISTINCT pe.page_location)         FILTER (WHERE pe.page_location IS NOT NULL AND pe.page_location != ''),
    NOW()
"""

_ANON_FROM_WHERE = f"""
FROM ga_landing.path_exploration pe
WHERE pe.company_id = %(cid)s
  AND {_apid_ok('pe.capsuite_apid')}
  AND pe.date >= TO_CHAR((CURRENT_DATE - INTERVAL '{WINDOW_DAYS} days'), 'YYYYMMDD')
"""

# Incremental: restrict the rebuilt set to visitors with any event in the last 7d.
_RECENT_FILTER = f"""
  AND pe.capsuite_apid IN (
      SELECT pe2.capsuite_apid
      FROM ga_landing.path_exploration pe2
      WHERE pe2.company_id = %(cid)s
        AND {_apid_ok('pe2.capsuite_apid')}
        AND pe2.date >= TO_CHAR((CURRENT_DATE - INTERVAL '{RECENT_DAYS} days'), 'YYYYMMDD')
  )
"""

_GROUP_BY = "\nGROUP BY pe.capsuite_apid\n"

# UPSERT body: replace every metric with the freshly recomputed 90d value; leave
# resolved_member_id / resolved_at untouched (step 3 owns them).
_ANON_CONFLICT = """
ON CONFLICT (company_id, visitor_id) DO UPDATE SET
    first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen,
    total_events = EXCLUDED.total_events, page_views = EXCLUDED.page_views, sessions = EXCLUDED.sessions,
    first_visits = EXCLUDED.first_visits, form_starts = EXCLUDED.form_starts, form_completes = EXCLUDED.form_completes,
    scroll_events = EXCLUDED.scroll_events, whatsapp_clicks = EXCLUDED.whatsapp_clicks, file_downloads = EXCLUDED.file_downloads,
    click_events = EXCLUDED.click_events, user_engagement = EXCLUDED.user_engagement,
    top_source_medium = EXCLUDED.top_source_medium, top_campaign = EXCLUDED.top_campaign,
    source_mediums = EXCLUDED.source_mediums, campaigns = EXCLUDED.campaigns, events = EXCLUDED.events,
    pages_visited = EXCLUDED.pages_visited, last_refreshed = EXCLUDED.last_refreshed
"""

SQL_DELETE_ANONYMOUS = "DELETE FROM app.anonymous_profiles WHERE company_id = %(cid)s"

# Incremental prune: drop visitors whose last activity has aged out of the 90d
# window. last_seen is their real last-activity date, so a row falls out the day it
# crosses the boundary. (Full mode prunes implicitly via DELETE + 90d rebuild.)
SQL_PRUNE_STALE_ANONYMOUS = f"""
DELETE FROM app.anonymous_profiles
WHERE company_id = %(cid)s
  AND last_seen IS NOT NULL
  AND last_seen < (CURRENT_DATE - INTERVAL '{WINDOW_DAYS} days')
"""

SQL_INSERT_ANON_FULL = (
    f"INSERT INTO app.anonymous_profiles ({_ANON_COLS})\nSELECT"
    + _ANON_SELECT_EXPR + _ANON_FROM_WHERE + _GROUP_BY
)

SQL_UPSERT_ANON_INCR = (
    f"INSERT INTO app.anonymous_profiles ({_ANON_COLS})\nSELECT"
    + _ANON_SELECT_EXPR + _ANON_FROM_WHERE + _RECENT_FILTER + _GROUP_BY + _ANON_CONFLICT
)


# --------------------------------------------------------------------------- #
# 2. MAP - stitch anonymous_id identity links from the three signals. One INSERT
#    over a priority-ranked UNION so the strongest signal wins per apid. In
#    incremental mode the purchase/path scans are windowed to the last 7 days
#    (only newly-arrived events can create new links) - a big cost cut on large
#    clients; a full run re-scans 90d to catch anything missed.
# --------------------------------------------------------------------------- #
def _map_identities_sql(incremental):
    pe_recent = (
        f"AND pe.date >= TO_CHAR((CURRENT_DATE - INTERVAL '{RECENT_DAYS} days'), 'YYYYMMDD')"
        if incremental else
        f"AND pe.date >= TO_CHAR((CURRENT_DATE - INTERVAL '{WINDOW_DAYS} days'), 'YYYYMMDD')"
    )
    pl_recent = (
        f"AND pl.date >= TO_CHAR((CURRENT_DATE - INTERVAL '{RECENT_DAYS} days'), 'YYYYMMDD')"
        if incremental else ""
    )
    return f"""
WITH candidates AS (
    -- 1. purchase -> commerce order -> buyer  (strongest: backed by a real sale)
    SELECT pl.capsuite_apid AS apid, o.customer_id AS member_id, 1 AS prio
    FROM ga_landing.purchase_list pl
    JOIN commerce."order" o
      ON o.company_id = %(cid)s
     AND ( o.order_ref = pl.trxn_id
        OR o.source_id = pl.trxn_id
        OR regexp_replace(COALESCE(o.order_ref, ''), '^#', '') = pl.trxn_id )
    WHERE pl.company_id = %(cid)s
      AND o.customer_id IS NOT NULL
      AND {_apid_ok('pl.capsuite_apid')}
      AND pl.trxn_id IS NOT NULL AND pl.trxn_id NOT IN ('', '(not set)')
      {pl_recent}

    UNION ALL
    -- 1b. purchase -> manual (CSV) sale -> buyer
    SELECT pl.capsuite_apid, s.member_id, 1
    FROM ga_landing.purchase_list pl
    JOIN manual.sale s
      ON s.company_id = %(cid)s
     AND ( s.trxn_ref = pl.trxn_id OR s.trxn_id = pl.trxn_id )
    WHERE pl.company_id = %(cid)s
      AND s.member_id IS NOT NULL
      AND {_apid_ok('pl.capsuite_apid')}
      AND pl.trxn_id IS NOT NULL AND pl.trxn_id NOT IN ('', '(not set)')
      {pl_recent}

    UNION ALL
    -- 2. logged-in: capsuite_uid is a known member id (prefixed id OR source id)
    SELECT pe.capsuite_apid, pi.member_id, 2
    FROM ga_landing.path_exploration pe
    JOIN app.profile_identities pi
      ON pi.company_id = %(cid)s
     AND pi.identity_type = 'member_id'
     AND ( pi.identity_value = pe.capsuite_uid OR pi.source_id = pe.capsuite_uid )
    WHERE pe.company_id = %(cid)s
      AND pe.capsuite_uid IS NOT NULL AND pe.capsuite_uid NOT IN ('', '(not set)', 'NA')
      AND {_apid_ok('pe.capsuite_apid')}
      {pe_recent}

    UNION ALL
    -- 3. identifier: capsuite_identifier is a known member's email
    SELECT pe.capsuite_apid, pi.member_id, 3
    FROM ga_landing.path_exploration pe
    JOIN app.profile_identities pi
      ON pi.company_id = %(cid)s
     AND pi.identity_type = 'email'
     AND LOWER(pi.identity_value) = LOWER(pe.capsuite_identifier)
    WHERE pe.company_id = %(cid)s
      AND pe.capsuite_identifier LIKE '%%@%%'
      AND {_apid_ok('pe.capsuite_apid')}
      {pe_recent}

    UNION ALL
    -- 3b. fallback: capsuite_uid itself is an email (some GTM setups send email as uid)
    SELECT pe.capsuite_apid, pi.member_id, 3
    FROM ga_landing.path_exploration pe
    JOIN app.profile_identities pi
      ON pi.company_id = %(cid)s
     AND pi.identity_type = 'email'
     AND LOWER(pi.identity_value) = LOWER(pe.capsuite_uid)
    WHERE pe.company_id = %(cid)s
      AND pe.capsuite_uid LIKE '%%@%%'
      AND {_apid_ok('pe.capsuite_apid')}
      {pe_recent}
),
ranked AS (
    SELECT DISTINCT ON (apid) apid, member_id, prio
    FROM candidates
    WHERE member_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM app.customer_profiles cp
        WHERE cp.company_id = %(cid)s AND cp.member_id = candidates.member_id
      )
    ORDER BY apid, prio, member_id
)
INSERT INTO app.profile_identities
    (company_id, member_id, source, source_id, identity_type, identity_value, is_primary, metadata)
SELECT %(cid)s, member_id, 'ga', apid, 'anonymous_id', apid, false,
       jsonb_build_object('match_method', prio)
FROM ranked
ON CONFLICT (company_id, identity_type, LOWER(identity_value)) DO NOTHING
"""


# --------------------------------------------------------------------------- #
# 3. STAMP the resolved member onto the AP rows (after mapping). Only the
#    anonymous_id links matter; resolved_at uses the identity's first_seen.
# --------------------------------------------------------------------------- #
SQL_STAMP_RESOLVED = """
UPDATE app.anonymous_profiles ap
SET resolved_member_id = pi.member_id,
    resolved_at        = pi.first_seen
FROM app.profile_identities pi
WHERE ap.company_id = %(cid)s
  AND pi.company_id = %(cid)s
  AND pi.identity_type = 'anonymous_id'
  AND pi.identity_value = ap.visitor_id
  AND ap.resolved_member_id IS DISTINCT FROM pi.member_id
"""


# --------------------------------------------------------------------------- #
# 4. ROLLUP - member web behaviour onto the golden record via the anonymous_id
#    links. Two layers, per the data-retention rule:
#      * ga_visitor_ids = EVERY linked anonymous id, LIFETIME (the mapping is kept
#        forever; one member can have many apids).  -> driven off `linked`.
#      * all other ga_* metrics = the member's web activity over the LAST 90 DAYS
#        only (older web events are intentionally not kept). A member whose web
#        activity has all aged out keeps the ids but zeroes the metrics (LEFT JOIN
#        + COALESCE), which also clears stale values from a prior run.
# --------------------------------------------------------------------------- #
SQL_REFRESH_CUSTOMER_GA = f"""
WITH linked AS (
    SELECT member_id, ARRAY_AGG(DISTINCT identity_value) AS visitor_ids
    FROM app.profile_identities
    WHERE company_id = %(cid)s AND identity_type = 'anonymous_id'
    GROUP BY member_id
),
ga_stats AS (
    SELECT
        pi.member_id,
        COUNT(DISTINCT pe.capsuite_apid)                                                  AS ga_sessions,
        COUNT(*)                                                                          AS ga_total_events,
        SUM(CASE WHEN pe.event_name = 'page_view'                                 THEN 1 ELSE 0 END) AS ga_page_views,
        SUM(CASE WHEN pe.event_name = 'first_visit'                               THEN 1 ELSE 0 END) AS ga_first_visits,
        SUM(CASE WHEN pe.event_name IN ('Event_Form_Start','form_start')          THEN 1 ELSE 0 END) AS ga_form_starts,
        SUM(CASE WHEN pe.event_name IN ('Event_Form_Complete','form_submit','Contact_Us_Form_Complete') THEN 1 ELSE 0 END) AS ga_form_completes,
        SUM(CASE WHEN pe.event_name = 'scroll'                                    THEN 1 ELSE 0 END) AS ga_scroll_events,
        SUM(CASE WHEN pe.event_name IN ('Whatsapp_Click','GTM_Whatsapp_Click')    THEN 1 ELSE 0 END) AS ga_whatsapp_clicks,
        SUM(CASE WHEN pe.event_name = 'file_download'                            THEN 1 ELSE 0 END) AS ga_file_downloads,
        MIN(TO_DATE(pe.date, 'YYYYMMDD'))                                                  AS ga_first_seen,
        MAX(TO_DATE(pe.date, 'YYYYMMDD'))                                                  AS ga_last_seen,
        MODE() WITHIN GROUP (ORDER BY pe.session_source_medium)                            AS ga_top_source_medium,
        MODE() WITHIN GROUP (ORDER BY pe.session_campaign_name)                            AS ga_top_campaign,
        ARRAY_AGG(DISTINCT pe.session_source_medium) FILTER (WHERE pe.session_source_medium IS NOT NULL AND pe.session_source_medium NOT IN ('','(not set)')) AS ga_source_mediums,
        ARRAY_AGG(DISTINCT pe.session_campaign_name) FILTER (WHERE pe.session_campaign_name IS NOT NULL AND pe.session_campaign_name NOT IN ('','(not set)')) AS ga_campaigns,
        ARRAY_AGG(DISTINCT pe.event_name)            FILTER (WHERE pe.event_name IS NOT NULL)               AS ga_events_list,
        ARRAY_AGG(DISTINCT pe.page_location)         FILTER (WHERE pe.page_location IS NOT NULL AND pe.page_location != '') AS ga_pages_visited
    FROM app.profile_identities pi
    JOIN ga_landing.path_exploration pe
      ON pe.company_id = pi.company_id AND pe.capsuite_apid = pi.identity_value
     AND pe.date >= TO_CHAR((CURRENT_DATE - INTERVAL '{WINDOW_DAYS} days'), 'YYYYMMDD')
    WHERE pi.company_id = %(cid)s AND pi.identity_type = 'anonymous_id'
    GROUP BY pi.member_id
)
UPDATE app.customer_profiles cp SET
    ga_sessions = COALESCE(g.ga_sessions, 0), ga_total_events = COALESCE(g.ga_total_events, 0), ga_page_views = COALESCE(g.ga_page_views, 0),
    ga_first_visits = COALESCE(g.ga_first_visits, 0), ga_form_starts = COALESCE(g.ga_form_starts, 0), ga_form_completes = COALESCE(g.ga_form_completes, 0),
    ga_scroll_events = COALESCE(g.ga_scroll_events, 0), ga_whatsapp_clicks = COALESCE(g.ga_whatsapp_clicks, 0), ga_file_downloads = COALESCE(g.ga_file_downloads, 0),
    ga_first_seen = g.ga_first_seen, ga_last_seen = g.ga_last_seen,
    ga_top_source_medium = g.ga_top_source_medium, ga_top_campaign = g.ga_top_campaign,
    ga_visitor_ids = COALESCE(l.visitor_ids, '{{}}'),
    ga_source_mediums = COALESCE(g.ga_source_mediums, '{{}}'), ga_campaigns = COALESCE(g.ga_campaigns, '{{}}'),
    ga_events_list = COALESCE(g.ga_events_list, '{{}}'), ga_pages_visited = COALESCE(g.ga_pages_visited, '{{}}'),
    last_refreshed = NOW()
FROM linked l
LEFT JOIN ga_stats g ON g.member_id = l.member_id
WHERE cp.company_id = %(cid)s AND cp.member_id = l.member_id
"""


def _discover_companies(str_client_name=None):
    """Workspaces to process: the named one, or every active GA-connected one.

    Not gated on company_report_config reports (mapping needs GA *data*, not a
    configured report); mirrors app_state.build_shopify_configs - a single named
    client is trusted, the all-workspace sweep requires a connected GA integration.
    """
    ck = ga_config.get_app_pg_conn_kwargs()
    if not ck:
        raise RuntimeError("App DB connection is not configured (cdp_ai_app_pg_conn).")

    def _do(conn):
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if str_client_name:
                where, params = ["c.capsuite_ref = %s"], [str_client_name]
            else:
                where, params = [
                    "c.is_active = TRUE",
                    "EXISTS (SELECT 1 FROM app.data_integrations di "
                    "WHERE di.company_id = c.id "
                    "AND di.integration_type = 'googleAnalytics' AND di.is_connected)",
                ], []
            cur.execute(
                "SELECT c.id AS company_id, c.capsuite_ref AS client "
                "FROM app.companies c WHERE " + " AND ".join(where),
                params,
            )
            return [
                {"client": r["client"], "company_id": str(r["company_id"])}
                for r in cur.fetchall()
            ]

    return db.run_tx(ck, _do)


@dag(
    # Not self-scheduled: the GA orchestrator triggers this once its report DAGs
    # succeed (manual "Sync Data" -> mode=full, daily schedule -> mode=incremental).
    schedule=None,
    start_date=datetime(2024, 1, 1),
    max_active_runs=4,
    max_active_tasks=8,
    catchup=False,
    tags=["cdp-click-ai", "profiles", "identity_mapping", "web_behavior"],
    owner_links={"capsuite": "https://capsuite.co"},
    on_failure_callback=tf.on_dag_failure_callback,
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        # full = rebuild last 90 days (manual sync); incremental = refresh visitors
        # active in the last 7 days (daily). Defaults to full for an ad-hoc trigger.
        "mode": Param("full", type=["string", "null"]),
        "is_debugging": Param(False, type=["boolean", "string"]),
        "dag_run_id": Param(None, type=["string", "null"]),
        "company_id": Param(None, type=["string", "null"]),
        "job_id": Param(None, type=["string", "null"]),
    },
)
def click_cdp_ai_build_profile_mapping():

    @task(retries=3, retry_delay=timedelta(seconds=5))
    def get_config(**context):
        str_client_name, _is_debugging, _ = tf.get_params(context)
        conf = (context.get("dag_run").conf or {}) if context.get("dag_run") else {}
        mode = str(conf.get("mode") or "full").lower()
        if mode not in ("full", "incremental"):
            mode = "full"
        configs = _discover_companies(str_client_name)
        for c in configs:
            c["mode"] = mode
        _log.info("[profiles.mapping] %d workspace(s), mode=%s", len(configs), mode)
        return configs

    @task(retries=2, retry_delay=timedelta(seconds=10))
    def build_map_refresh(dict_config):
        client = dict_config["client"]
        cid = dict_config["company_id"]
        mode = dict_config.get("mode", "full")
        _log.info(f"[profiles.mapping] {ctx(client)} start (company_id={cid}, mode={mode})")

        conn_kwargs = ga_config.get_pg_conn_kwargs()
        if not conn_kwargs:
            raise RuntimeError("Postgres connection is not configured (cdp_ai_app_pg_conn).")

        def _do(conn):
            params = {"cid": cid}
            with conn.cursor() as cur:
                # 1. BUILD the anonymous-profile list for this mode's scope.
                #    full: wipe + rebuild over 90d (prunes inactive implicitly).
                #    incremental: upsert last-7d visitors (new + existing), leave
                #    8-90d rows untouched, then prune rows aged past 90d.
                if mode == "incremental":
                    cur.execute(SQL_UPSERT_ANON_INCR, params)
                    anon_built = cur.rowcount
                    cur.execute(SQL_PRUNE_STALE_ANONYMOUS, params)
                    pruned = cur.rowcount
                else:
                    cur.execute(SQL_DELETE_ANONYMOUS, params)
                    cur.execute(SQL_INSERT_ANON_FULL, params)
                    anon_built = cur.rowcount
                    pruned = 0

                # 2. MAP anon -> customer (after the AP profiles exist). Scans are
                #    windowed to recent days in incremental mode.
                cur.execute(_map_identities_sql(mode == "incremental"), params)
                mapped = cur.rowcount

                # 3. STAMP the resolved member onto the AP rows.
                cur.execute(SQL_STAMP_RESOLVED, params)
                resolved = cur.rowcount

                # 4. ROLL UP member web behaviour onto the customer profiles.
                cur.execute(SQL_REFRESH_CUSTOMER_GA, params)
                customers = cur.rowcount
            return anon_built, pruned, mapped, resolved, customers

        anon_built, pruned, mapped, resolved, customers = db.run_tx(conn_kwargs, _do)
        _log.info(
            f"[profiles.mapping] {ctx(client)} done ({mode}) - "
            f"{anon_built} AP profile(s) built, {pruned} stale pruned, "
            f"{mapped} new anon->member link(s), "
            f"{resolved} AP profile(s) flagged resolved, {customers} customer profile(s) rolled up"
        )
        return dict_config

    build_map_refresh.expand(dict_config=get_config())


click_cdp_ai_build_profile_mapping()
