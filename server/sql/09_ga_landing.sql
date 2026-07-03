-- ============================================================================
--  09_ga_landing.sql - Google Analytics + Google Search Console data source
-- ----------------------------------------------------------------------------
--  Landing zone for the GA4 / GSC pipelines, now COMPANY-SCOPED (was a single
--  global capsuite_ref). The external Airflow DAGs map capsuite_ref → company_id
--  via app.companies and write company_id on every row. Anonymous web activity
--  here (captured via the interaction-service tracker) feeds app.anonymous_profiles.
--
--  Every table keeps capsuite_ref for pipeline compatibility but company_id is
--  the authoritative tenant key.
-- ============================================================================

-- ── Event-level navigation log (the core behavioral table) ──────────────────
CREATE TABLE ga_landing.path_exploration (
  id                    BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id            UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  event_name            TEXT,
  date_hour_minute      TIMESTAMP,                 -- naive, GA property tz
  date                  TEXT,                      -- YYYYMMDD partition key
  page_referrer         TEXT,
  page_location         TEXT,
  link_url              TEXT,
  session_source_medium TEXT,
  session_campaign_name TEXT,
  capsuite_sid          TEXT,                      -- session id
  capsuite_uid          TEXT,                      -- user id
  capsuite_apid         TEXT,                      -- anonymous/visitor id
  capsuite_identifier   TEXT,
  capsuite_ref          TEXT,
  property_id           TEXT,
  property_name         TEXT,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_pe_company_apid_idx ON ga_landing.path_exploration(company_id, capsuite_apid);
CREATE INDEX gal_pe_company_date_idx ON ga_landing.path_exploration(company_id, date);
CREATE INDEX gal_pe_company_event_idx ON ga_landing.path_exploration(company_id, event_name);
-- profile-mapping: capsuite_uid lookup (logged-in visitor -> known member)
CREATE INDEX gal_pe_company_uid_idx ON ga_landing.path_exploration(company_id, capsuite_uid);

-- ── Same, with engagement duration (dwell-time analysis) ────────────────────
CREATE TABLE ga_landing.path_exploration_duration (
  id                       BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id               UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  event_name               TEXT,
  date_hour_minute         TIMESTAMP,
  date                     TEXT,
  page_referrer            TEXT,
  page_location            TEXT,
  session_source_medium    TEXT,
  user_engagement_duration INTEGER,
  capsuite_sid             TEXT,
  capsuite_uid             TEXT,
  capsuite_apid            TEXT,
  capsuite_identifier      TEXT,
  capsuite_ref             TEXT,
  property_id              TEXT,
  property_name            TEXT,
  synced_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_ped_company_date_idx ON ga_landing.path_exploration_duration(company_id, date);

-- ── Outbound-link clicks (event_name = 'click', external link_url) ───────────
--  Same event grain as path_exploration; written by the GA path/outbound DAG.
CREATE TABLE ga_landing.outbound_links_attributes (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id       UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  event_name       TEXT,
  date_hour_minute TIMESTAMP,                 -- naive, GA property tz
  date             TEXT,
  page_location    TEXT,
  link_url         TEXT,
  capsuite_ref     TEXT,
  property_id      TEXT,
  property_name    TEXT,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_ola_company_date_idx ON ga_landing.outbound_links_attributes(company_id, date);

-- ── UTM performance (minute / full-param) ───────────────────────────────────
CREATE TABLE ga_landing.utm_performance (
  id                    BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id            UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date_hour_minute      TIMESTAMPTZ,
  date                  TEXT,
  session_source        TEXT,
  session_medium        TEXT,
  session_campaign_name TEXT,
  session_content       TEXT,
  session_term          TEXT,
  session_utm_id        TEXT,
  country               TEXT,
  device                TEXT,
  active_users          INTEGER,
  new_users             INTEGER,
  bounce_rate           REAL,
  engagement_rate       REAL,
  average_session_duration REAL,
  sessions              INTEGER,
  capsuite_ref          TEXT,
  property_id           TEXT,
  property_name         TEXT,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_utmp_company_date_idx ON ga_landing.utm_performance(company_id, date);

-- ── UTM daily performance (no content/term) ─────────────────────────────────
CREATE TABLE ga_landing.utm_daily_performance (
  id                    BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id            UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                  TEXT,
  session_source        TEXT,
  session_medium        TEXT,
  session_campaign_name TEXT,
  country               TEXT,
  device                TEXT,
  active_users          INTEGER,
  new_users             INTEGER,
  bounce_rate           REAL,
  engagement_rate       REAL,
  average_session_duration REAL,
  sessions              INTEGER,
  capsuite_ref          TEXT,
  property_id           TEXT,
  property_name         TEXT,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_utmd_company_date_idx ON ga_landing.utm_daily_performance(company_id, date);

-- ── UTM daily full-param performance ────────────────────────────────────────
CREATE TABLE ga_landing.utm_daily_full_param_performance (
  id                    BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id            UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                  TEXT,
  session_source        TEXT,
  session_medium        TEXT,
  session_campaign_name TEXT,
  session_content       TEXT,
  session_term          TEXT,
  session_utm_id        TEXT,
  country               TEXT,
  device                TEXT,
  active_users          INTEGER,
  new_users             INTEGER,
  bounce_rate           REAL,
  engagement_rate       REAL,
  average_session_duration REAL,
  sessions              INTEGER,
  capsuite_ref          TEXT,
  property_id           TEXT,
  property_name         TEXT,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_utmdf_company_date_idx ON ga_landing.utm_daily_full_param_performance(company_id, date);

-- ── UTM daily performance by UTM ID ─────────────────────────────────────────
CREATE TABLE ga_landing.utm_daily_utm_id_performance (
  id                    BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id            UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                  TEXT,
  session_utm_id        TEXT,
  active_users          INTEGER,
  new_users             INTEGER,
  bounce_rate           REAL,
  engagement_rate       REAL,
  average_session_duration REAL,
  sessions              INTEGER,
  capsuite_ref          TEXT,
  property_id           TEXT,
  property_name         TEXT,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_utmid_company_date_idx ON ga_landing.utm_daily_utm_id_performance(company_id, date);

-- ── Paid ad cost / impressions ──────────────────────────────────────────────
CREATE TABLE ga_landing.utm_ad_performance (
  id                          BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                  UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                        TEXT,
  session_source              TEXT,
  session_medium              TEXT,
  session_campaign_name       TEXT,
  session_utm_id              TEXT,
  advertiser_ad_impressions   INTEGER,
  advertiser_ad_clicks        INTEGER,
  advertiser_ad_cost          REAL,
  advertiser_ad_cost_per_click REAL,
  capsuite_ref                TEXT,
  property_id                 TEXT,
  property_name               TEXT,
  synced_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);

-- ── Country performance ─────────────────────────────────────────────────────
CREATE TABLE ga_landing.country_performance (
  id                       BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id               UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                     TEXT,
  country                  TEXT,
  active_users             INTEGER,
  new_users                INTEGER,
  bounce_rate              REAL,
  engagement_rate          REAL,
  average_session_duration REAL,
  sessions                 INTEGER,
  capsuite_ref             TEXT,
  property_id              TEXT,
  property_name            TEXT,
  synced_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_cp_company_date_idx ON ga_landing.country_performance(company_id, date);

-- ── Page metrics ────────────────────────────────────────────────────────────
CREATE TABLE ga_landing.page_metrics (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id       UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date             TEXT,
  page_path        TEXT,
  active_users     INTEGER,
  new_users        INTEGER,
  engagement_rate  REAL,
  page_views       INTEGER,
  sessions         INTEGER,
  engaged_sessions INTEGER,
  bounced_sessions BIGINT,                    -- pg_loader infers int64 → BIGINT
  capsuite_ref     TEXT,
  property_id      TEXT,
  property_name    TEXT,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_pm_company_date_idx ON ga_landing.page_metrics(company_id, date);

-- ── Page × source/medium metrics ────────────────────────────────────────────
CREATE TABLE ga_landing.page_utm_metrics (
  id             BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id     UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date           TEXT,
  page_path      TEXT,
  session_source TEXT,
  session_medium TEXT,
  active_users   INTEGER,
  new_users      INTEGER,
  page_views     INTEGER,
  capsuite_ref   TEXT,
  property_id    TEXT,
  property_name  TEXT,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);

-- ── Website-wide daily metrics (KPI summary) ────────────────────────────────
CREATE TABLE ga_landing.website_metrics (
  id                       BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id               UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                     TEXT,
  active_users             INTEGER,
  new_users                INTEGER,
  sessions                 INTEGER,
  engaged_sessions         INTEGER,
  user_engagement_duration INTEGER,
  page_views               INTEGER,
  engaged_sessions_per_active_user    DOUBLE PRECISION,
  average_engagement_time_per_session DOUBLE PRECISION,
  average_engagement_time_per_user    DOUBLE PRECISION,
  capsuite_ref             TEXT,
  property_id              TEXT,
  property_name            TEXT,
  synced_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_wm_company_date_idx ON ga_landing.website_metrics(company_id, date);

-- ── Event catalog ───────────────────────────────────────────────────────────
CREATE TABLE ga_landing.event_list (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date          TEXT,
  event_name    TEXT,
  is_key_event  TEXT,
  capsuite_ref  TEXT,
  property_id   TEXT,
  property_name TEXT,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);

-- ── GSC organic keyword performance ─────────────────────────────────────────
CREATE TABLE ga_landing.keyword_performance (
  id                  BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id          UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  query               TEXT,
  date                TEXT,
  clicks              REAL,
  impressions         REAL,
  ctr                 REAL,
  position            REAL,
  rank_by_impressions INTEGER,
  rank_by_clicks      INTEGER,
  capsuite_ref        TEXT,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_kw_company_date_idx ON ga_landing.keyword_performance(company_id, date);

-- ── Monthly conversion funnel (Session → Page view → Scroll → Purchase) ──────
--  Partitioned monthly by tracking_period ('YYYY-MM'); two breakdowns per month
--  (tracking_type = 'source_medium' | 'campaign'). Written by the path_funnel DAG.
CREATE TABLE ga_landing.funnel_report (
  id                           BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  funnel_step                  TEXT,
  funnel_step_name             TEXT,
  session_source               TEXT,
  session_medium               TEXT,
  session_campaign             TEXT,
  active_users                 INTEGER,
  funnel_step_completion_rate  REAL,
  funnel_step_abandonments     INTEGER,
  funnel_step_abandonment_rate REAL,
  tracking_type                TEXT,       -- 'source_medium' | 'campaign'
  tracking_period              TEXT,       -- 'YYYY-MM' monthly partition key
  capsuite_ref                 TEXT,
  property_id                  TEXT,
  property_name                TEXT,
  synced_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_fr_company_period_idx ON ga_landing.funnel_report(company_id, tracking_period);

-- ── Purchase transactions (event_name = 'purchase', identity-stamped) ────────
--  Partitioned by date (YYYYMMDD). Written by the purchase DAG; feeds profile
--  identity resolution via the capsuite_* ids.
CREATE TABLE ga_landing.purchase_list (
  id                  BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id          UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                TEXT,       -- YYYYMMDD partition key
  trxn_id             TEXT,
  capsuite_sid        TEXT,
  capsuite_apid       TEXT,
  capsuite_uid        TEXT,
  capsuite_identifier TEXT,
  capsuite_ref        TEXT,
  property_id         TEXT,
  property_name       TEXT,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_pl_company_date_idx ON ga_landing.purchase_list(company_id, date);
-- profile-mapping: trxn_id lookup (GA purchase -> commerce/manual order -> buyer)
CREATE INDEX gal_pl_company_trxn_idx ON ga_landing.purchase_list(company_id, trxn_id);

-- ── GA cube tables (conformed daily cubes from the redesign) ─────────────────
--  GENERATED from dags/click_cdp_ai_dags/lib/cube_catalog.py (the pipeline's single
--  source of truth). Regenerate with:  python scripts/gen_ga_catalog.py
--  The DAG loader auto-creates these (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT
--  EXISTS) but does NOT create the (company_id, date) index the app's UTM / channel
--  queries rely on - that is why the tables + indexes are declared here.
-- >>> BEGIN GENERATED CUBE TABLES
CREATE TABLE ga_landing.page_engagement_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  page_path                  TEXT,
  user_engagement_duration   BIGINT,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_page_engagement_daily_cd_idx ON ga_landing.page_engagement_daily(company_id, date);

CREATE TABLE ga_landing.session_quality_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  device                     TEXT,
  sessions                   BIGINT,
  engaged_sessions           BIGINT,
  screen_page_views_per_session DOUBLE PRECISION,
  average_session_duration   DOUBLE PRECISION,
  bounce_rate                DOUBLE PRECISION,
  engagement_rate            DOUBLE PRECISION,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_session_quality_daily_cd_idx ON ga_landing.session_quality_daily(company_id, date);

CREATE TABLE ga_landing.item_performance (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  item_id                    TEXT,
  item_name                  TEXT,
  item_brand                 TEXT,
  item_category              TEXT,
  items_viewed               BIGINT,
  items_added_to_cart        BIGINT,
  items_purchased            BIGINT,
  item_revenue               DOUBLE PRECISION,
  cart_to_view_rate          DOUBLE PRECISION,
  purchase_to_view_rate      DOUBLE PRECISION,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_item_performance_cd_idx ON ga_landing.item_performance(company_id, date);

CREATE TABLE ga_landing.item_attribution (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  item_id                    TEXT,
  channel_group              TEXT,
  item_revenue               DOUBLE PRECISION,
  items_purchased            BIGINT,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_item_attribution_cd_idx ON ga_landing.item_attribution(company_id, date);

CREATE TABLE ga_landing.transaction_metrics (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  channel_group              TEXT,
  transactions               BIGINT,
  purchase_revenue           DOUBLE PRECISION,
  ecommerce_purchases        BIGINT,
  first_time_purchasers      BIGINT,
  average_purchase_revenue   DOUBLE PRECISION,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_transaction_metrics_cd_idx ON ga_landing.transaction_metrics(company_id, date);

CREATE TABLE ga_landing.acquisition_session_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  session_source_medium      TEXT,
  session_campaign_name      TEXT,
  active_users               BIGINT,
  new_users                  BIGINT,
  engaged_sessions           BIGINT,
  engagement_rate            DOUBLE PRECISION,
  sessions                   BIGINT,
  key_events                 BIGINT,
  total_revenue              DOUBLE PRECISION,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_acquisition_session_daily_cd_idx ON ga_landing.acquisition_session_daily(company_id, date);

CREATE TABLE ga_landing.acquisition_firstuser_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  first_user_source_medium   TEXT,
  first_user_channel_group   TEXT,
  new_users                  BIGINT,
  total_users                BIGINT,
  active_users               BIGINT,
  key_events                 BIGINT,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_acquisition_firstuser_daily_cd_idx ON ga_landing.acquisition_firstuser_daily(company_id, date);

CREATE TABLE ga_landing.channel_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  channel_group              TEXT,
  sessions                   BIGINT,
  engaged_sessions           BIGINT,
  engagement_rate            DOUBLE PRECISION,
  active_users               BIGINT,
  new_users                  BIGINT,
  key_events                 BIGINT,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_channel_daily_cd_idx ON ga_landing.channel_daily(company_id, date);

CREATE TABLE ga_landing.landing_page_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  landing_page               TEXT,
  sessions                   BIGINT,
  engaged_sessions           BIGINT,
  engagement_rate            DOUBLE PRECISION,
  key_events                 BIGINT,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_landing_page_daily_cd_idx ON ga_landing.landing_page_daily(company_id, date);

CREATE TABLE ga_landing.demographics_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  age_bracket                TEXT,
  gender                     TEXT,
  active_users               BIGINT,
  new_users                  BIGINT,
  sessions                   BIGINT,
  key_events                 BIGINT,
  total_revenue              DOUBLE PRECISION,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_demographics_daily_cd_idx ON ga_landing.demographics_daily(company_id, date);

CREATE TABLE ga_landing.audience_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  audience_name              TEXT,
  active_users               BIGINT,
  sessions                   BIGINT,
  key_events                 BIGINT,
  total_revenue              DOUBLE PRECISION,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_audience_daily_cd_idx ON ga_landing.audience_daily(company_id, date);

CREATE TABLE ga_landing.tech_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  device                     TEXT,
  operating_system           TEXT,
  browser                    TEXT,
  active_users               BIGINT,
  sessions                   BIGINT,
  engagement_rate            DOUBLE PRECISION,
  page_views                 BIGINT,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_tech_daily_cd_idx ON ga_landing.tech_daily(company_id, date);

CREATE TABLE ga_landing.geo_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  country                    TEXT,
  region                     TEXT,
  active_users               BIGINT,
  sessions                   BIGINT,
  key_events                 BIGINT,
  total_revenue              DOUBLE PRECISION,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_geo_daily_cd_idx ON ga_landing.geo_daily(company_id, date);

CREATE TABLE ga_landing.interest_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  interest                   TEXT,
  active_users               BIGINT,
  sessions                   BIGINT,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_interest_daily_cd_idx ON ga_landing.interest_daily(company_id, date);

CREATE TABLE ga_landing.returning_daily (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  date                       TEXT,
  new_vs_returning           TEXT,
  active_users               BIGINT,
  sessions                   BIGINT,
  key_events                 BIGINT,
  total_revenue              DOUBLE PRECISION,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_returning_daily_cd_idx ON ga_landing.returning_daily(company_id, date);

CREATE TABLE ga_landing.cohort_weekly (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  cohort                     TEXT,
  cohort_nth_week            BIGINT,
  cohort_active_users        BIGINT,
  cohort_total_users         BIGINT,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_cohort_weekly_c_idx ON ga_landing.cohort_weekly(company_id);

CREATE TABLE ga_landing.cohort_monthly (
  id                         BIGINT      GENERATED ALWAYS AS IDENTITY,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  cohort                     TEXT,
  cohort_nth_month           BIGINT,
  cohort_active_users        BIGINT,
  cohort_total_users         BIGINT,
  capsuite_ref               TEXT,
  property_id                TEXT,
  property_name              TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX gal_cohort_monthly_c_idx ON ga_landing.cohort_monthly(company_id);
-- <<< END GENERATED CUBE TABLES

-- ── Sync control / incremental watermark (one row per workspace × report) ────
--  The DAGs read this BEFORE each fetch to decide the start date, and advance
--  last_sync_date in the SAME transaction as the data load (idempotent re-runs).
--  Resume logic (see dags/click_cdp_ai/lib/pg_state.py):
--    is_debugging = TRUE  -> 1st of (today - debug_months)
--    last_sync_date set   -> last_sync_date - overlap_days   (daily incremental)
--    first run            -> plan-based backfill: 3 years for every tier by default
--  Keyed by capsuite_ref (1:1 with a workspace) so the external ETL stays
--  decoupled from app UUIDs. Created here so the schema is authoritative; the
--  DAG also ensures it at runtime (CREATE IF NOT EXISTS) for safety.
CREATE TABLE ga_landing.ga_sync_control (
  capsuite_ref   TEXT        NOT NULL,
  report         TEXT        NOT NULL,
  is_debugging   BOOLEAN     NOT NULL DEFAULT FALSE,
  debug_months   INTEGER     NOT NULL DEFAULT 2,
  overlap_days   INTEGER     NOT NULL DEFAULT 7,
  last_sync_date DATE,
  last_run_at    TIMESTAMPTZ,
  last_status    TEXT,
  error_message  TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (capsuite_ref, report)
);
