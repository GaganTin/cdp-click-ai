-- ============================================================
--  CDP Click AI - app schema
--  All user-generated data lives in the "app" schema,
--  completely separate from ga_landing / public / metadata.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS app;

-- Auto-update updated_date on every row change
CREATE OR REPLACE FUNCTION app.set_updated_date()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_date = NOW();
  RETURN NEW;
END;
$$;

-- ── UTM Campaigns ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.campaigns (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_date   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  name           TEXT        NOT NULL    DEFAULT '',
  status         TEXT        NOT NULL    DEFAULT 'draft',  -- draft | active | paused | completed | archived
  base_url       TEXT,
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  utm_term       TEXT,
  utm_content    TEXT,
  metadata       JSONB       NOT NULL    DEFAULT '{}'
);

CREATE OR REPLACE TRIGGER campaigns_updated_date
  BEFORE UPDATE ON app.campaigns
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Audience Segments ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.segments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_date   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  name           TEXT        NOT NULL    DEFAULT '',
  description    TEXT,
  estimated_size INTEGER,
  status         TEXT        NOT NULL    DEFAULT 'draft',  -- draft | active | archived
  segment_type   TEXT        NOT NULL    DEFAULT 'customer', -- customer | anonymous_profile
  metadata       JSONB       NOT NULL    DEFAULT '{}'
);

CREATE OR REPLACE TRIGGER segments_updated_date
  BEFORE UPDATE ON app.segments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Saved Reports ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.saved_reports (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  title        TEXT        NOT NULL    DEFAULT '',
  content      TEXT,                              -- markdown body
  tags         TEXT[]      NOT NULL    DEFAULT '{}',
  schedule     TEXT,                              -- daily | weekly | monthly | null
  metadata     JSONB       NOT NULL    DEFAULT '{}'
);

CREATE OR REPLACE TRIGGER saved_reports_updated_date
  BEFORE UPDATE ON app.saved_reports
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Pinned Dashboard Charts ──────────────────────────────────
CREATE TABLE IF NOT EXISTS app.pinned_charts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_date   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  title          TEXT        NOT NULL    DEFAULT '',
  chart_type     TEXT        NOT NULL    DEFAULT 'bar',  -- bar | line | area | pie
  chart_config   TEXT        NOT NULL    DEFAULT '{}',   -- JSON string (frontend-compatible)
  description    TEXT,
  query          TEXT,
  last_refreshed TIMESTAMPTZ,
  metadata       JSONB       NOT NULL    DEFAULT '{}'
);

CREATE OR REPLACE TRIGGER pinned_charts_updated_date
  BEFORE UPDATE ON app.pinned_charts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── App Data Dictionary (user-managed table notes) ───────────
CREATE TABLE IF NOT EXISTS app.data_dictionary (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  table_name   TEXT        NOT NULL,
  schema_name  TEXT        NOT NULL    DEFAULT 'public',
  description  TEXT,
  columns      JSONB       NOT NULL    DEFAULT '[]',  -- [{name, type, description}]
  metadata     JSONB       NOT NULL    DEFAULT '{}'
);

CREATE OR REPLACE TRIGGER data_dictionary_updated_date
  BEFORE UPDATE ON app.data_dictionary
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── UTM Chart Summaries (cached AI explanations per chart key) ──
CREATE TABLE IF NOT EXISTS app.chart_summaries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  chart_key    TEXT        NOT NULL    UNIQUE,
  summary      TEXT        NOT NULL    DEFAULT '',
  metadata     JSONB       NOT NULL    DEFAULT '{}'
);

CREATE OR REPLACE TRIGGER chart_summaries_updated_date
  BEFORE UPDATE ON app.chart_summaries
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Materialized Customer Profiles ─────────────────────────────────────────────
-- Pre-joined from public.membership + GA path_exploration + custom_activity + attributes
CREATE TABLE IF NOT EXISTS app.customer_profiles (
  member_id             TEXT        PRIMARY KEY,
  capsuite_ref          TEXT,
  -- identity
  primary_email         TEXT,
  secondary_email       TEXT,
  eng_full_name         TEXT,
  eng_first_name        TEXT,
  eng_last_name         TEXT,
  chi_full_name         TEXT,
  display_name          TEXT,
  member_no             TEXT,
  title                 TEXT,
  -- membership
  member_join_date      TIMESTAMPTZ,
  member_last_update    TIMESTAMPTZ,
  member_reg_channel    TEXT,
  member_reg_location   TEXT,
  member_type           TEXT,
  is_company            BOOLEAN,
  -- demographics
  gender                TEXT,
  age                   TEXT,
  age_group             TEXT,
  birthday_year         TEXT,
  birthday_month        TEXT,
  birthday_day          TEXT,
  education_level       TEXT,
  income_level          TEXT,
  employment_status     TEXT,
  marital_status        TEXT,
  nationality           TEXT,
  -- contact & preferences
  has_email             BOOLEAN,
  has_phone             BOOLEAN,
  primary_phone         TEXT,
  preferred_language    TEXT,
  preferred_channel     TEXT,
  is_opt_in_email       BOOLEAN,
  is_opt_in_call        TEXT,
  is_opt_in_dm          TEXT,
  is_opt_in_sms         TEXT,
  is_subscriber_only    BOOLEAN,
  tags                  TEXT,
  -- GA web activity (aggregated from path_exploration via membership_ap_mapping)
  ga_sessions           INTEGER     DEFAULT 0,
  ga_total_events       INTEGER     DEFAULT 0,
  ga_page_views         INTEGER     DEFAULT 0,
  ga_first_visits       INTEGER     DEFAULT 0,
  ga_form_starts        INTEGER     DEFAULT 0,
  ga_form_completes     INTEGER     DEFAULT 0,
  ga_scroll_events      INTEGER     DEFAULT 0,
  ga_whatsapp_clicks    INTEGER     DEFAULT 0,
  ga_file_downloads     INTEGER     DEFAULT 0,
  ga_first_seen         DATE,
  ga_last_seen          DATE,
  ga_top_source_medium  TEXT,
  ga_top_campaign       TEXT,
  ga_visitor_ids        TEXT[]      DEFAULT '{}',
  ga_source_mediums     TEXT[]      DEFAULT '{}',
  ga_campaigns          TEXT[]      DEFAULT '{}',
  ga_events_list        TEXT[]      DEFAULT '{}',
  ga_pages_visited      TEXT[]      DEFAULT '{}',
  -- offline / CRM activity (membership_custom_activity)
  seminar_count         INTEGER     DEFAULT 0,
  seminars              JSONB       DEFAULT '[]',  -- [{event_name, event_date, action}]
  -- membership attributes (intended year, year group, etc.)
  attribute_count       INTEGER     DEFAULT 0,
  attributes            JSONB       DEFAULT '{}',  -- {attr_name: value}
  -- meta
  last_refreshed        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS ga_visitor_ids TEXT[] DEFAULT '{}';

-- ── Materialized Anonymous Visitor Profiles ──────────────────────────────────
-- Pre-aggregated from ga_landing.path_exploration (visitors NOT in membership_ap_mapping)
CREATE TABLE IF NOT EXISTS app.anonymous_profiles (
  visitor_id            TEXT        PRIMARY KEY,  -- capsuite_apid
  first_seen            DATE,
  last_seen             DATE,
  total_events          INTEGER     DEFAULT 0,
  page_views            INTEGER     DEFAULT 0,
  sessions              INTEGER     DEFAULT 0,
  first_visits          INTEGER     DEFAULT 0,
  form_starts           INTEGER     DEFAULT 0,
  form_completes        INTEGER     DEFAULT 0,
  scroll_events         INTEGER     DEFAULT 0,
  whatsapp_clicks       INTEGER     DEFAULT 0,
  file_downloads        INTEGER     DEFAULT 0,
  click_events          INTEGER     DEFAULT 0,
  user_engagement       INTEGER     DEFAULT 0,
  top_source_medium     TEXT,
  top_campaign          TEXT,
  source_mediums        TEXT[]      DEFAULT '{}',
  campaigns             TEXT[]      DEFAULT '{}',
  events                TEXT[]      DEFAULT '{}',
  pages_visited         TEXT[]      DEFAULT '{}',
  last_refreshed        TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════
--  EDM (Email Direct Marketing) - Klaviyo-like email platform
-- ══════════════════════════════════════════════════════════════

-- ── EDM Templates ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.edm_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name          TEXT        NOT NULL DEFAULT '',
  subject       TEXT        NOT NULL DEFAULT '',
  preview_text  TEXT,
  html_body     TEXT        NOT NULL DEFAULT '',
  text_body     TEXT,
  variables     TEXT[]      NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'draft',  -- draft | published
  metadata      JSONB       NOT NULL DEFAULT '{}'
);
CREATE OR REPLACE TRIGGER edm_templates_updated_date
  BEFORE UPDATE ON app.edm_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── EDM Campaigns ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.edm_campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name             TEXT        NOT NULL DEFAULT '',
  subject          TEXT        NOT NULL DEFAULT '',
  preview_text     TEXT,
  from_name        TEXT        NOT NULL DEFAULT '',
  from_email       TEXT        NOT NULL DEFAULT '',
  reply_to         TEXT,
  template_id      UUID        REFERENCES app.edm_templates(id) ON DELETE SET NULL,
  html_body        TEXT,
  text_body        TEXT,
  segment_id       UUID        REFERENCES app.segments(id) ON DELETE SET NULL,
  utm_campaign_id  UUID        REFERENCES app.campaigns(id) ON DELETE SET NULL,
  status           TEXT        NOT NULL DEFAULT 'draft',  -- draft | scheduled | sending | sent | cancelled
  scheduled_at     TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  total_recipients INTEGER     DEFAULT 0,
  ab_test_config   JSONB       NOT NULL DEFAULT '{}',
  metadata         JSONB       NOT NULL DEFAULT '{}'
);
CREATE OR REPLACE TRIGGER edm_campaigns_updated_date
  BEFORE UPDATE ON app.edm_campaigns
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── EDM Per-recipient Send Records ────────────────────────────
CREATE TABLE IF NOT EXISTS app.edm_sends (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  edm_campaign_id  UUID        NOT NULL REFERENCES app.edm_campaigns(id) ON DELETE CASCADE,
  email            TEXT        NOT NULL,
  member_id        TEXT,
  status           TEXT        NOT NULL DEFAULT 'queued',  -- queued | sent | delivered | bounced | failed
  sent_at          TIMESTAMPTZ,
  error_message    TEXT,
  metadata         JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS edm_sends_campaign_idx ON app.edm_sends(edm_campaign_id);
CREATE INDEX IF NOT EXISTS edm_sends_email_idx    ON app.edm_sends(email);

-- ── EDM Events (opens, clicks, bounces, unsubscribes) ─────────
CREATE TABLE IF NOT EXISTS app.edm_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edm_campaign_id  UUID        REFERENCES app.edm_campaigns(id) ON DELETE SET NULL,
  send_id          UUID        REFERENCES app.edm_sends(id) ON DELETE SET NULL,
  email            TEXT        NOT NULL,
  event_type       TEXT        NOT NULL,  -- open | click | bounce | complaint | unsubscribe | delivered
  link_url         TEXT,
  metadata         JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS edm_events_campaign_idx ON app.edm_events(edm_campaign_id);
CREATE INDEX IF NOT EXISTS edm_events_type_idx     ON app.edm_events(event_type);

-- ── EDM Suppression List ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.edm_suppression (
  email     TEXT        PRIMARY KEY,
  reason    TEXT        NOT NULL DEFAULT 'manual',  -- bounced | unsubscribed | complained | manual
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata  JSONB       NOT NULL DEFAULT '{}'
);

-- ── EDM Automations (drip flows) ──────────────────────────────
CREATE TABLE IF NOT EXISTS app.edm_automations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name            TEXT        NOT NULL DEFAULT '',
  trigger_type    TEXT        NOT NULL DEFAULT 'manual',  -- manual | schedule | segment_entry
  trigger_config  JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'draft',   -- draft | active | paused | archived
  metadata        JSONB       NOT NULL DEFAULT '{}'
);
CREATE OR REPLACE TRIGGER edm_automations_updated_date
  BEFORE UPDATE ON app.edm_automations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── EDM Automation Steps ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.edm_automation_steps (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id  UUID        NOT NULL REFERENCES app.edm_automations(id) ON DELETE CASCADE,
  step_order     INTEGER     NOT NULL DEFAULT 0,
  step_type      TEXT        NOT NULL DEFAULT 'send_email',  -- send_email | wait | condition
  step_config    JSONB       NOT NULL DEFAULT '{}',
  next_step_id   UUID,
  created_date   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── EDM Automation Enrollments ────────────────────────────────
CREATE TABLE IF NOT EXISTS app.edm_automation_enrollments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id    UUID        NOT NULL REFERENCES app.edm_automations(id) ON DELETE CASCADE,
  email            TEXT        NOT NULL,
  member_id        TEXT,
  current_step_id  UUID        REFERENCES app.edm_automation_steps(id) ON DELETE SET NULL,
  next_run_at      TIMESTAMPTZ,
  enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'active',  -- active | completed | cancelled | failed
  metadata         JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS edm_enrollments_automation_idx ON app.edm_automation_enrollments(automation_id);
CREATE INDEX IF NOT EXISTS edm_enrollments_next_run_idx   ON app.edm_automation_enrollments(next_run_at) WHERE status = 'active';

-- ── Company Report Config (replaces companyreportconfig MongoDB collection) ───
CREATE TABLE IF NOT EXISTS app.company_report_config (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  capsuite_ref              TEXT        NOT NULL DEFAULT '',
  is_trial                  BOOLEAN     NOT NULL DEFAULT false,
  url_domain                TEXT        NOT NULL DEFAULT '',
  supporting_capsuite_param TEXT[]      NOT NULL DEFAULT '{"capsuite_sid","capsuite_apid"}',
  cdp_reports               JSONB       NOT NULL DEFAULT '{
    "popup_tracking":          {"debugStartDate":"2025-01-01","isDebugging":false},
    "blast_tracking":          {"debugStartDate":"2025-01-01","isDebugging":false},
    "utm_summary":             {"debugStartDate":"2025-01-01","isDebugging":false},
    "activity_log":            {"source":["custom_activity"],"debugStartDate":"2025-01-01","isDebugging":false},
    "web_content_attributes":  {"isDebugging":false,"isInterest":true,"isReference":false},
    "ap_session_log":          {"debugStartDate":"2025-01-01","isDebugging":false},
    "ap_anonymous_profile":    {"debugStartDate":"2025-01-01","isDebugging":false},
    "ap_segment_filter":       {"debugStartDate":"2025-01-01","isDebugging":false},
    "mem_segment_filter":      {"debugStartDate":"2025-01-01","isDebugging":false},
    "ap_membership_profiles":  {"debugStartDate":"2025-01-01","isDebugging":false},
    "outbound_links_attributes":{"isDebugging":false,"debugStartDate":"2025-07-30"}
  }',
  ga_reports                JSONB       NOT NULL DEFAULT '{
    "path_exploration":                    {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "path_exploration_duration":           {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "utm_performance":                     {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "utm_daily_performance":               {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "utm_daily_full_param_performance":    {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "utm_ad_performance":                  {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "country_performance":                 {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "page_metrics":                        {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "page_utm_metrics":                    {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "website_metrics":                     {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "keyword_performance":                 {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "event_list":                          {"isDebugging":false,"debugStartDate":"2025-07-30"}
  }'
);

CREATE OR REPLACE TRIGGER company_report_config_updated_date
  BEFORE UPDATE ON app.company_report_config
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- Seed one default row if empty (single-tenant model)
INSERT INTO app.company_report_config (capsuite_ref) VALUES ('')
  ON CONFLICT DO NOTHING;

-- ── Web Content HTML Elements (replaces webcontenthtmlelements MongoDB collection) ─
CREATE TABLE IF NOT EXISTS app.web_content_html_elements (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  capsuite_ref             TEXT        NOT NULL DEFAULT '',
  cut_off_point_after      TEXT,
  cut_off_point_before     TEXT,
  update_time_elements     TEXT        NOT NULL DEFAULT 'og:updated_time',
  error_strings            TEXT[]      NOT NULL DEFAULT '{"Error 404","ERROR 403","seem to exist","頁面可能已被刪除","找不到頁面"}',
  valid_content_min_length INTEGER     NOT NULL DEFAULT 60,
  url_pattern              TEXT        NOT NULL DEFAULT ''
);

CREATE OR REPLACE TRIGGER web_content_html_elements_updated_date
  BEFORE UPDATE ON app.web_content_html_elements
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- Seed one default row if empty
INSERT INTO app.web_content_html_elements (capsuite_ref) VALUES ('')
  ON CONFLICT DO NOTHING;

-- ── Data Integrations ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.data_integrations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  integration_type      TEXT        NOT NULL UNIQUE,
  config                JSONB       NOT NULL DEFAULT '{}',
  is_connected          BOOLEAN     NOT NULL DEFAULT false,
  last_connected_date   TIMESTAMPTZ,
  is_connection_error   BOOLEAN     NOT NULL DEFAULT false,
  connection_error      TEXT,
  is_synced             BOOLEAN     NOT NULL DEFAULT false,
  last_synced_date      TIMESTAMPTZ,
  is_sync_error         BOOLEAN     NOT NULL DEFAULT false,
  sync_error            TEXT
);

CREATE OR REPLACE TRIGGER data_integrations_updated_date
  BEFORE UPDATE ON app.data_integrations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── App Settings (key-value store) ─────────────────────────
CREATE TABLE IF NOT EXISTS app.settings (
  key          TEXT        PRIMARY KEY,
  value        TEXT,
  label        TEXT,
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AI Conversations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.conversations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  agent_name   TEXT        NOT NULL    DEFAULT 'cdp_analyst',
  title        TEXT,
  status       TEXT        NOT NULL    DEFAULT 'idle',  -- idle | processing
  messages     JSONB       NOT NULL    DEFAULT '[]',    -- [{role, content, file_urls, created_date}]
  metadata     JSONB       NOT NULL    DEFAULT '{}'
);

CREATE OR REPLACE TRIGGER conversations_updated_date
  BEFORE UPDATE ON app.conversations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Imported Profile Tracking ────────────────────────────────
-- app.customer_profiles (the denormalized view)
ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

-- public.membership (the authoritative source - must match so segmentation/EDM queries work)
ALTER TABLE public.membership ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.membership ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

-- ── Pop Ups (Interaction Service) ────────────────────────────
CREATE TABLE IF NOT EXISTS app.popups (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date            TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_date            TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  company_id              UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by              UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  name                    TEXT        NOT NULL DEFAULT '',
  interaction_service_id  UUID,
  interaction_type        TEXT        NOT NULL DEFAULT 'banner',
  cdp_reference_id        TEXT        NOT NULL DEFAULT '',
  rules                   JSONB       NOT NULL DEFAULT '{}',
  content                 TEXT        NOT NULL DEFAULT '',
  default_recommendation  JSONB       NOT NULL DEFAULT '{}',
  is_active               BOOLEAN     NOT NULL DEFAULT false,
  is_default              BOOLEAN     NOT NULL DEFAULT false,
  start_time              TIMESTAMPTZ,
  end_time                TIMESTAMPTZ,
  status                  TEXT        NOT NULL DEFAULT 'draft'
);

CREATE OR REPLACE TRIGGER popups_updated_date
  BEFORE UPDATE ON app.popups
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

CREATE INDEX IF NOT EXISTS popups_company_idx ON app.popups(company_id);

-- ── Popup Templates ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.popup_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  name         TEXT        NOT NULL DEFAULT '',
  category     TEXT        NOT NULL DEFAULT 'Custom',
  description  TEXT        NOT NULL DEFAULT '',
  content      TEXT        NOT NULL DEFAULT ''
);
CREATE OR REPLACE TRIGGER popup_templates_updated_date
  BEFORE UPDATE ON app.popup_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();
CREATE INDEX IF NOT EXISTS popup_templates_company_idx ON app.popup_templates(company_id);
