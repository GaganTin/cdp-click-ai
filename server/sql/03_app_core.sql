-- ============================================================================
--  03_app_core.sql - app control-plane tables (everything company-scoped)
--  Segments, UTM campaigns, saved reports, pinned charts, chart summaries,
--  AI conversations, skills, settings, and the per-company report/scraper config.
--  Every table is company_id NOT NULL; visibility = private(draft) | company.
-- ============================================================================

-- ── UTM Campaigns (the /utm "Campaigns" page) ───────────────────────────────
CREATE TABLE app.campaigns (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  visibility   TEXT        NOT NULL DEFAULT 'private',  -- private | company
  name         TEXT        NOT NULL DEFAULT '',
  status       TEXT        NOT NULL DEFAULT 'draft',    -- draft | active | paused | completed | archived
  base_url     TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_term     TEXT,
  utm_content  TEXT,
  metadata     JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX campaigns_company_idx ON app.campaigns(company_id);
CREATE TRIGGER campaigns_updated_date BEFORE UPDATE ON app.campaigns
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Audience Segments ───────────────────────────────────────────────────────
CREATE TABLE app.segments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id     UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by     UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  visibility     TEXT        NOT NULL DEFAULT 'private',
  name           TEXT        NOT NULL DEFAULT '',
  description    TEXT,
  estimated_size INTEGER,
  status         TEXT        NOT NULL DEFAULT 'draft',     -- draft | active | archived
  segment_type   TEXT        NOT NULL DEFAULT 'customer',  -- customer | anonymous_profile
  daily_refresh  BOOLEAN     NOT NULL DEFAULT false,
  last_refreshed TIMESTAMPTZ,
  -- filter_criteria holds the rule tree; values may be scalar OR array (consumers
  -- handle both). metadata may also carry a cached criteria copy for popups.
  filter_criteria JSONB      NOT NULL DEFAULT '{}',
  metadata       JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX segments_company_idx ON app.segments(company_id, segment_type);
CREATE TRIGGER segments_updated_date BEFORE UPDATE ON app.segments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Saved Reports (Analyst markdown reports) ────────────────────────────────
CREATE TABLE app.saved_reports (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  visibility   TEXT        NOT NULL DEFAULT 'private',
  title        TEXT        NOT NULL DEFAULT '',
  content      TEXT,                              -- markdown body
  tags         TEXT[]      NOT NULL DEFAULT '{}',
  schedule     TEXT,                              -- daily | weekly | monthly | null
  metadata     JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX saved_reports_company_idx ON app.saved_reports(company_id);
CREATE TRIGGER saved_reports_updated_date BEFORE UPDATE ON app.saved_reports
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Pinned Dashboard Charts ─────────────────────────────────────────────────
CREATE TABLE app.pinned_charts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id     UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by     UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  visibility     TEXT        NOT NULL DEFAULT 'private',
  title          TEXT        NOT NULL DEFAULT '',
  chart_type     TEXT        NOT NULL DEFAULT 'bar',   -- bar | line | area | pie
  chart_config   JSONB       NOT NULL DEFAULT '{}',    -- was TEXT-holding-JSON; now native JSONB
  description    TEXT,
  query          TEXT,
  last_refreshed TIMESTAMPTZ,
  metadata       JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX pinned_charts_company_idx ON app.pinned_charts(company_id);
CREATE TRIGGER pinned_charts_updated_date BEFORE UPDATE ON app.pinned_charts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Data Dictionary (user-managed table notes for the Analyst) ──────────────
CREATE TABLE app.data_dictionary (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  table_name   TEXT        NOT NULL,
  schema_name  TEXT        NOT NULL DEFAULT 'public',
  description  TEXT,
  columns      JSONB       NOT NULL DEFAULT '[]',   -- [{name, type, description}]
  metadata     JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX data_dictionary_company_idx ON app.data_dictionary(company_id);
CREATE TRIGGER data_dictionary_updated_date BEFORE UPDATE ON app.data_dictionary
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── UTM Chart Summaries (cached AI explanations per chart key) ──────────────
CREATE TABLE app.chart_summaries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  chart_key    TEXT        NOT NULL,
  summary      TEXT        NOT NULL DEFAULT '',
  data_hash    TEXT,        -- fingerprint of the chart data the summary was generated from; NULL forces regen
  metadata     JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX chart_summaries_company_key_idx ON app.chart_summaries(company_id, chart_key);
CREATE TRIGGER chart_summaries_updated_date BEFORE UPDATE ON app.chart_summaries
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── AI Conversations (Analyst) ──────────────────────────────────────────────
CREATE TABLE app.conversations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  visibility   TEXT        NOT NULL DEFAULT 'private',
  agent_name   TEXT        NOT NULL DEFAULT 'cdp_analyst',
  title        TEXT,
  status       TEXT        NOT NULL DEFAULT 'idle',   -- idle | processing
  messages     JSONB       NOT NULL DEFAULT '[]',     -- [{role, content, file_urls, created_date}]
  metadata     JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX conversations_company_idx ON app.conversations(company_id);
CREATE TRIGGER conversations_updated_date BEFORE UPDATE ON app.conversations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── AI Skills (context / template snippets for the Analyst) ─────────────────
CREATE TABLE app.skills (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  name         TEXT        NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  content      TEXT        NOT NULL DEFAULT '',
  type         TEXT        NOT NULL DEFAULT 'context',  -- context | template
  icon         TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT true
);
CREATE INDEX skills_company_idx ON app.skills(company_id);
CREATE TRIGGER skills_updated_date BEFORE UPDATE ON app.skills
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Settings (per-company key/value, e.g. analyst_system_prompt) ────────────
CREATE TABLE app.settings (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  key          TEXT        NOT NULL,
  value        TEXT,
  label        TEXT,
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX settings_company_key_idx ON app.settings(company_id, key);

-- ── Per-company report config (pipeline debug flags + capsuite params) ──────
CREATE TABLE app.company_report_config (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id                UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by                UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  capsuite_ref              TEXT        NOT NULL DEFAULT '',   -- denormalised copy of companies.capsuite_ref
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
    "ap_membership_profiles":  {"debugStartDate":"2025-01-01","isDebugging":false}
  }',
  -- Which Google Analytics reports the pipeline runs (presence of a key = enabled).
  -- One key per report task in the integration_ga_reports_* DAGs. The per-report
  -- {isDebugging,debugStartDate} is retained for the app's config editor, but the
  -- ACTUAL incremental window now comes from ga_landing.ga_sync_control (plan-based
  -- first-run backfill, then last_sync_date - overlap). keyword_performance is a
  -- Search Console report and lives in gsc_reports below, NOT here.
  ga_reports                JSONB       NOT NULL DEFAULT '{
    "path_exploration":                 {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "path_exploration_duration":        {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "funnel_report":                    {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "utm_performance":                  {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "utm_daily_performance":            {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "utm_daily_full_param_performance": {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "utm_daily_utm_id_performance":     {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "utm_ad_performance":               {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "country_performance":              {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "page_metrics":                     {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "page_utm_metrics":                 {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "website_metrics":                  {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "event_list":                       {"isDebugging":false,"debugStartDate":"2025-07-30"},
    "purchase_list":                    {"isDebugging":false,"debugStartDate":"2025-07-30"}
  }',
  -- Which Google Search Console reports the pipeline runs (run by the
  -- click_cdp_ai_gsc_keyword_performance DAG when GSC is connected with a site_url).
  gsc_reports               JSONB       NOT NULL DEFAULT '{
    "keyword_performance":              {"isDebugging":false,"debugStartDate":"2025-07-30"}
  }'
);
CREATE UNIQUE INDEX company_report_config_company_idx ON app.company_report_config(company_id);
CREATE TRIGGER company_report_config_updated_date BEFORE UPDATE ON app.company_report_config
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Per-company web-content scraper config ──────────────────────────────────
CREATE TABLE app.web_content_html_elements (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id               UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by               UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  capsuite_ref             TEXT        NOT NULL DEFAULT '',
  cut_off_point_after      TEXT,
  cut_off_point_before     TEXT,
  update_time_elements     TEXT        NOT NULL DEFAULT 'og:updated_time',
  error_strings            TEXT[]      NOT NULL DEFAULT '{"Error 404","ERROR 403","seem to exist","頁面可能已被刪除","找不到頁面"}',
  valid_content_min_length INTEGER     NOT NULL DEFAULT 60,
  valid_title_min_length   INTEGER     NOT NULL DEFAULT 1,
  url_pattern              TEXT        NOT NULL DEFAULT '',
  ga_lookback_days         INTEGER     NOT NULL DEFAULT 90,   -- 0 = all time
  excluded_url_patterns    TEXT[]      NOT NULL DEFAULT '{}',
  test_links_refresh_mode  TEXT        NOT NULL DEFAULT 'static',  -- static | daily (auto top-50 GA refresh)
  test_links_refreshed_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX web_content_html_elements_company_idx ON app.web_content_html_elements(company_id);
CREATE TRIGGER web_content_html_elements_updated_date BEFORE UPDATE ON app.web_content_html_elements
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();
