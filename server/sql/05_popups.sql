-- ============================================================================
--  05_popups.sql - Pop-ups (bridged to the interaction-service microservice)
--  Popup DEFINITIONS live here (app-owned). They are pushed to the
--  interaction-service over HTTP; live activity/leads are read back and the
--  collected emails are cached in app.popup_email_collected.
-- ============================================================================

-- ── Pop-ups ─────────────────────────────────────────────────────────────────
CREATE TABLE app.popups (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id             UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by             UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  name                   TEXT        NOT NULL DEFAULT '',
  -- link to the interaction-service record (in the microservice's own DB)
  interaction_service_id UUID,
  interaction_type       TEXT        NOT NULL DEFAULT 'banner',  -- banner | modal | slide_in | notification
  cdp_reference_id       TEXT        NOT NULL DEFAULT '',
  segment_id             UUID        REFERENCES app.segments(id) ON DELETE SET NULL,
  rules                  JSONB       NOT NULL DEFAULT '{}',
  content                TEXT        NOT NULL DEFAULT '',
  default_recommendation JSONB       NOT NULL DEFAULT '{}',
  is_active              BOOLEAN     NOT NULL DEFAULT false,
  is_default             BOOLEAN     NOT NULL DEFAULT false,
  start_time             TIMESTAMPTZ,
  end_time               TIMESTAMPTZ,
  status                 TEXT        NOT NULL DEFAULT 'draft'    -- draft | active | paused | archived
);
CREATE INDEX popups_company_idx ON app.popups(company_id);
CREATE TRIGGER popups_updated_date BEFORE UPDATE ON app.popups
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Pop-up templates ────────────────────────────────────────────────────────
CREATE TABLE app.popup_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by    UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  name          TEXT        NOT NULL DEFAULT '',
  category      TEXT        NOT NULL DEFAULT 'Custom',
  description   TEXT        NOT NULL DEFAULT '',
  content       TEXT        NOT NULL DEFAULT '',
  builder_state JSONB,                                  -- null for HTML-imported templates
  is_builtin    BOOLEAN     NOT NULL DEFAULT false
);
CREATE INDEX popup_templates_company_idx ON app.popup_templates(company_id);
CREATE TRIGGER popup_templates_updated_date BEFORE UPDATE ON app.popup_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Collected emails (leads captured by popups; cache of microservice data) ─
CREATE TABLE app.popup_email_collected (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  collected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id         UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  popup_id           UUID        REFERENCES app.popups(id) ON DELETE SET NULL,
  popup_name         TEXT,
  popup_ref          TEXT,
  email              TEXT        NOT NULL,
  first_name         TEXT,
  last_name          TEXT,
  phone              TEXT,
  source_url         TEXT,
  page_title         TEXT,
  device_type        TEXT,
  browser            TEXT,
  os                 TEXT,
  country            TEXT,
  city               TEXT,
  region             TEXT,
  visitor_id         TEXT,        -- anonymous id → links to app.anonymous_profiles / profile_identities
  session_id         TEXT,
  ip_address         TEXT,
  utm_source         TEXT,
  utm_medium         TEXT,
  utm_campaign       TEXT,
  utm_term           TEXT,
  utm_content        TEXT,
  status             TEXT        NOT NULL DEFAULT 'new',  -- new | contacted | converted | unsubscribed
  notes              TEXT,
  -- lineage: how this email became (or matched) a customer profile
  profile_created    BOOLEAN     NOT NULL DEFAULT false,
  profile_created_at TIMESTAMPTZ,
  profile_id         TEXT,        -- member_id of the matched/created customer profile
  profile_lineage    JSONB       NOT NULL DEFAULT '{}',
  metadata           JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX popup_email_collected_company_idx   ON app.popup_email_collected(company_id);
CREATE INDEX popup_email_collected_popup_idx     ON app.popup_email_collected(popup_id);
CREATE INDEX popup_email_collected_email_idx     ON app.popup_email_collected(LOWER(email));
CREATE INDEX popup_email_collected_collected_idx ON app.popup_email_collected(collected_at DESC);

-- ── Outbound link clicks (where pop-up clicks went; cache of microservice data) ─
--  Durable projection of every `click_interaction` activity: one row per click,
--  with the destination link_url (e.g. a WhatsApp wa.me deep-link, INCLUDING its
--  prefilled ?text= so distinct messages stay distinct). Populated by the
--  interaction.project_link_click() trigger (see 11_interaction.sql), mirroring
--  the popup_email_collected projection. NOT deduped — every click is counted.
CREATE TABLE app.popup_link_clicks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clicked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  popup_id      UUID        REFERENCES app.popups(id) ON DELETE SET NULL,
  popup_name    TEXT,
  popup_ref     TEXT,
  link_url      TEXT        NOT NULL,            -- full destination href incl. query string
  link_text     TEXT,                            -- visible link text (first 100 chars)
  link_target   TEXT,                            -- _self | _blank
  open_method   TEXT,                            -- left_click | new_tab | ctrl_click | middle_click | right_click
  source_url    TEXT,                            -- the page the click happened on (post_url)
  visitor_id    TEXT,                            -- capsuite_apid (persistent browser id)
  session_id    TEXT,                            -- capsuite_sid (session id)
  metadata      JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX popup_link_clicks_company_idx ON app.popup_link_clicks(company_id);
CREATE INDEX popup_link_clicks_popup_idx   ON app.popup_link_clicks(popup_id);
CREATE INDEX popup_link_clicks_clicked_idx ON app.popup_link_clicks(clicked_at DESC);
CREATE INDEX popup_link_clicks_url_idx      ON app.popup_link_clicks(popup_id, link_url);
