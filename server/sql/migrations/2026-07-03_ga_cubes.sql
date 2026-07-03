-- ============================================================================
--  2026-07-03_ga_cubes.sql  -  GA cube redesign: new conformed daily cube tables
--  and per-workspace report config, for EXISTING databases (idempotent).
--
--  Fresh installs get these from 09_ga_landing.sql / 03_app_core.sql. This migration
--  brings already-provisioned DBs up to the same schema + config. The DAG loader
--  also CREATEs these tables at runtime, but WITHOUT the (company_id, date) index
--  the app's UTM / channel queries need - so we declare table + index here.
--  Generated helper: python scripts/gen_ga_catalog.py
-- ============================================================================

-- 1) New cube tables + (company_id, date) indexes ---------------------------------
CREATE TABLE IF NOT EXISTS ga_landing.page_engagement_daily (
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
CREATE INDEX IF NOT EXISTS gal_page_engagement_daily_cd_idx ON ga_landing.page_engagement_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.session_quality_daily (
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
CREATE INDEX IF NOT EXISTS gal_session_quality_daily_cd_idx ON ga_landing.session_quality_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.item_performance (
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
CREATE INDEX IF NOT EXISTS gal_item_performance_cd_idx ON ga_landing.item_performance(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.item_attribution (
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
CREATE INDEX IF NOT EXISTS gal_item_attribution_cd_idx ON ga_landing.item_attribution(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.transaction_metrics (
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
CREATE INDEX IF NOT EXISTS gal_transaction_metrics_cd_idx ON ga_landing.transaction_metrics(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.acquisition_session_daily (
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
CREATE INDEX IF NOT EXISTS gal_acquisition_session_daily_cd_idx ON ga_landing.acquisition_session_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.acquisition_firstuser_daily (
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
CREATE INDEX IF NOT EXISTS gal_acquisition_firstuser_daily_cd_idx ON ga_landing.acquisition_firstuser_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.channel_daily (
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
CREATE INDEX IF NOT EXISTS gal_channel_daily_cd_idx ON ga_landing.channel_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.landing_page_daily (
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
CREATE INDEX IF NOT EXISTS gal_landing_page_daily_cd_idx ON ga_landing.landing_page_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.demographics_daily (
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
CREATE INDEX IF NOT EXISTS gal_demographics_daily_cd_idx ON ga_landing.demographics_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.audience_daily (
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
CREATE INDEX IF NOT EXISTS gal_audience_daily_cd_idx ON ga_landing.audience_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.tech_daily (
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
CREATE INDEX IF NOT EXISTS gal_tech_daily_cd_idx ON ga_landing.tech_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.geo_daily (
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
CREATE INDEX IF NOT EXISTS gal_geo_daily_cd_idx ON ga_landing.geo_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.interest_daily (
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
CREATE INDEX IF NOT EXISTS gal_interest_daily_cd_idx ON ga_landing.interest_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.returning_daily (
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
CREATE INDEX IF NOT EXISTS gal_returning_daily_cd_idx ON ga_landing.returning_daily(company_id, date);

CREATE TABLE IF NOT EXISTS ga_landing.cohort_weekly (
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
CREATE INDEX IF NOT EXISTS gal_cohort_weekly_c_idx ON ga_landing.cohort_weekly(company_id);

CREATE TABLE IF NOT EXISTS ga_landing.cohort_monthly (
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
CREATE INDEX IF NOT EXISTS gal_cohort_monthly_c_idx ON ga_landing.cohort_monthly(company_id);

-- 2) Enable the new cubes in every workspace's report config, drop the retired keys.
--    jsonb `||` ADDS the new keys (existing surviving reports keep their debug flags);
--    `- key` removes the retired flat utm/country reports. interest_daily is left out
--    pending brandingInterest apiName verification (see cube_catalog).
UPDATE app.company_report_config
SET ga_reports = (ga_reports - 'utm_performance' - 'utm_daily_performance' - 'utm_daily_full_param_performance' - 'country_performance' - 'path_exploration_duration')
  || '{"page_engagement_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "session_quality_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "item_performance": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "item_attribution": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "transaction_metrics": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "acquisition_session_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "acquisition_firstuser_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "channel_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "landing_page_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "demographics_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "audience_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "tech_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "geo_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "returning_daily": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "cohort_weekly": {"isDebugging": false, "debugStartDate": "2025-07-30"}, "cohort_monthly": {"isDebugging": false, "debugStartDate": "2025-07-30"}}'::jsonb;
