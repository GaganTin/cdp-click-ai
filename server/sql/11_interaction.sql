-- ============================================================================
--  11_interaction.sql - SHARED schema for the interaction-service microservice
-- ----------------------------------------------------------------------------
--  The interaction-service is a separate Go/GORM microservice (models: Company,
--  Interaction, Activity, Customer). It connects to THIS database and reads/writes
--  the `interaction` schema directly (GORM NamingStrategy TablePrefix "interaction.",
--  AutoMigrate DISABLED). Therefore the column names and types below MUST match the
--  GORM models exactly - this file is the single source of truth for the schema.
--
--  GORM conventions assumed:
--    - BaseModel → id UUID (gen_random_uuid), created_at, updated_at
--    - struct fields → snake_case columns
--  Popup analytics in server/routes/popup.js join these tables locally:
--    interaction.companies(id, cdp_company_id)
--    interaction.interactions(id, company_id → companies.id, cdp_reference_id)
--    interaction.activities(correlated_interaction_id → interactions.id,
--                           capsuite_sid, action, created_at)
--  Workspace deletes cascade in via interaction.companies.cdp_company_id.
-- ============================================================================

-- ── Companies (service company ↔ app workspace) ─────────────────────────────
--  GORM model: Company{ ID, CreatedAt, UpdatedAt, Name, CdpCompanyId(uniqueIndex) }
CREATE TABLE interaction.companies (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),  -- interaction-service company id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name           TEXT,
  cdp_company_id UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,  -- → app workspace
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX interaction_companies_cdp_idx ON interaction.companies(cdp_company_id);

-- ── Interactions (popup definitions served by the microservice) ─────────────
--  GORM model: Interaction{ ID, CreatedAt, UpdatedAt, Name, CompanyID,
--    InteractionType, CdpReferenceId(uniqueIndex), Rules(jsonb), Content,
--    DefaultRecommendation(jsonb), IsActive, StartTime, EndTime, IsDefault }
CREATE TABLE interaction.interactions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name                   TEXT        NOT NULL DEFAULT '',
  company_id             UUID        NOT NULL REFERENCES interaction.companies(id) ON DELETE CASCADE,
  interaction_type       TEXT,
  cdp_reference_id       TEXT,                              -- ↔ app.popups.cdp_reference_id
  rules                  JSONB       NOT NULL DEFAULT '{}',
  content                TEXT,
  default_recommendation JSONB       NOT NULL DEFAULT '{}',
  is_active              BOOLEAN     NOT NULL DEFAULT false,
  start_time             TIMESTAMPTZ,
  end_time               TIMESTAMPTZ,
  is_default             BOOLEAN     NOT NULL DEFAULT false,
  status                 TEXT,                              -- extra: convenience mirror of app.popups.status
  synced_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX interaction_interactions_ref_idx  ON interaction.interactions(cdp_reference_id);
CREATE INDEX interaction_interactions_company_idx     ON interaction.interactions(company_id);

-- ── Activities (impressions/clicks/closes/email collection) ─────────────────
--  GORM model: Activity{ ID, CreatedAt, UpdatedAt, CapsuiteSid, CapsuiteApid,
--    Action, CorrelatedInteractionId, UrlParameters, JsonParameters }
--  action ∈ visit | retrieve_interaction | click_interaction | close_interaction | email_collection
--  Captured form fields (e.g. the collected email) live as JSON in json_parameters.
CREATE TABLE interaction.activities (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  capsuite_sid              TEXT,       -- session id
  capsuite_apid             TEXT,       -- anonymous/visitor id
  action                    TEXT        NOT NULL,
  correlated_interaction_id UUID        REFERENCES interaction.interactions(id) ON DELETE CASCADE,
  url_parameters            TEXT,       -- raw query-string params (debug)
  json_parameters           TEXT,       -- JSON payload: { email, link_url, post_url, ... }
  page_url                  TEXT,       -- extra (seed/reporting convenience)
  page_title                TEXT,       -- extra (seed/reporting convenience)
  synced_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX interaction_activities_corr_idx   ON interaction.activities(correlated_interaction_id);
CREATE INDEX interaction_activities_action_idx ON interaction.activities(action, created_at DESC);
CREATE INDEX interaction_activities_sid_idx    ON interaction.activities(capsuite_sid);

-- ── Customers (per-visitor recommendation overrides; rarely used) ────────────
--  GORM model: Customer{ ID, CreatedAt, UpdatedAt, Recommendations(text[]),
--    CapsuiteSid(primaryKey), InteractionID }. Extra columns below support the
--  dev seed's email-lead demo data and are ignored by the service.
CREATE TABLE interaction.customers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recommendations TEXT[],
  capsuite_sid  TEXT,
  interaction_id UUID,
  company_id    UUID        REFERENCES interaction.companies(id) ON DELETE CASCADE,  -- extra (seed)
  capsuite_apid TEXT,                                                                -- extra (seed)
  email         TEXT,                                                                -- extra (seed)
  first_name    TEXT,                                                                -- extra (seed)
  last_name     TEXT,                                                                -- extra (seed)
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX interaction_customers_email_idx ON interaction.customers(company_id, LOWER(email)) WHERE email IS NOT NULL;

-- ── Project collected emails into app.popup_email_collected ─────────────────
--  When the microservice records an `email_collection` activity, surface it as a
--  lead row on app.popup_email_collected (what the "Emails Collected" tab and the
--  create-profile flow read). The collected fields come from the activity's
--  json_parameters JSON blob (see buildJsonParameters in the Go service):
--    { email, first_name, last_name, phone, post_url, page_title, utm_* }
--  Deduped to one row per (workspace, popup, email).
CREATE OR REPLACE FUNCTION interaction.project_email_collection() RETURNS trigger AS $$
DECLARE
  v_json        jsonb;
  v_email       text;
  v_ref         text;
  v_cdp_company uuid;
  v_popup       app.popups%ROWTYPE;
BEGIN
  -- json_parameters is TEXT holding a JSON object; tolerate malformed payloads.
  BEGIN
    v_json := NEW.json_parameters::jsonb;
  EXCEPTION WHEN others THEN
    v_json := '{}'::jsonb;
  END;

  v_email := NULLIF(btrim(lower(v_json->>'email')), '');
  IF v_email IS NULL THEN
    RETURN NEW;  -- no email captured on this submit
  END IF;

  -- Resolve the owning popup: activity → interaction → service company → workspace.
  SELECT i.cdp_reference_id, c.cdp_company_id
    INTO v_ref, v_cdp_company
    FROM interaction.interactions i
    JOIN interaction.companies c ON c.id = i.company_id
   WHERE i.id = NEW.correlated_interaction_id;

  IF v_cdp_company IS NULL THEN
    RETURN NEW;  -- orphan activity, cannot attribute to a workspace
  END IF;

  SELECT * INTO v_popup
    FROM app.popups
   WHERE company_id = v_cdp_company AND cdp_reference_id = v_ref
   LIMIT 1;

  -- Dedupe: one lead row per (workspace, popup, email).
  IF EXISTS (
    SELECT 1 FROM app.popup_email_collected
     WHERE company_id = v_cdp_company
       AND lower(email) = v_email
       AND popup_ref IS NOT DISTINCT FROM v_ref
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO app.popup_email_collected (
    collected_at, company_id, popup_id, popup_name, popup_ref,
    email, first_name, last_name, phone,
    source_url, page_title, visitor_id, session_id,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    metadata
  ) VALUES (
    NEW.created_at, v_cdp_company, v_popup.id, v_popup.name, v_ref,
    v_email,
    NULLIF(v_json->>'first_name',''), NULLIF(v_json->>'last_name',''), NULLIF(v_json->>'phone',''),
    COALESCE(NULLIF(v_json->>'post_url',''), NULLIF(v_json->>'source_url','')),
    NULLIF(v_json->>'page_title',''),
    NEW.capsuite_apid, NEW.capsuite_sid,
    NULLIF(v_json->>'utm_source',''), NULLIF(v_json->>'utm_medium',''), NULLIF(v_json->>'utm_campaign',''),
    NULLIF(v_json->>'utm_term',''), NULLIF(v_json->>'utm_content',''),
    jsonb_build_object('source','interaction_activity','activity_id', NEW.id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activities_project_email ON interaction.activities;
CREATE TRIGGER activities_project_email
  AFTER INSERT ON interaction.activities
  FOR EACH ROW
  WHEN (NEW.action = 'email_collection')
  EXECUTE FUNCTION interaction.project_email_collection();

-- ── Project outbound link clicks into app.popup_link_clicks ─────────────────
--  When the microservice records a `click_interaction` activity, surface it as a
--  row on app.popup_link_clicks (what the pop-up "Top Outbound Links" breakdown
--  reads). The destination and click context come from json_parameters:
--    { link_url, link_text, link_target, open_method, post_url }
--  link_url keeps its full query string, so a WhatsApp wa.me link and its
--  prefilled ?text= are preserved verbatim. NOT deduped — one row per click.
CREATE OR REPLACE FUNCTION interaction.project_link_click() RETURNS trigger AS $$
DECLARE
  v_json        jsonb;
  v_link        text;
  v_ref         text;
  v_cdp_company uuid;
  v_popup       app.popups%ROWTYPE;
BEGIN
  -- json_parameters is TEXT holding a JSON object; tolerate malformed payloads.
  BEGIN
    v_json := NEW.json_parameters::jsonb;
  EXCEPTION WHEN others THEN
    v_json := '{}'::jsonb;
  END;

  v_link := NULLIF(btrim(v_json->>'link_url'), '');
  IF v_link IS NULL THEN
    RETURN NEW;  -- click with no destination captured (e.g. javascript: link)
  END IF;

  -- Resolve the owning popup: activity → interaction → service company → workspace.
  SELECT i.cdp_reference_id, c.cdp_company_id
    INTO v_ref, v_cdp_company
    FROM interaction.interactions i
    JOIN interaction.companies c ON c.id = i.company_id
   WHERE i.id = NEW.correlated_interaction_id;

  IF v_cdp_company IS NULL THEN
    RETURN NEW;  -- orphan activity, cannot attribute to a workspace
  END IF;

  SELECT * INTO v_popup
    FROM app.popups
   WHERE company_id = v_cdp_company AND cdp_reference_id = v_ref
   LIMIT 1;

  INSERT INTO app.popup_link_clicks (
    clicked_at, company_id, popup_id, popup_name, popup_ref,
    link_url, link_text, link_target, open_method,
    source_url, visitor_id, session_id, metadata
  ) VALUES (
    NEW.created_at, v_cdp_company, v_popup.id, v_popup.name, v_ref,
    v_link,
    NULLIF(v_json->>'link_text',''), NULLIF(v_json->>'link_target',''), NULLIF(v_json->>'open_method',''),
    COALESCE(NULLIF(v_json->>'post_url',''), NULLIF(v_json->>'source_url','')),
    NEW.capsuite_apid, NEW.capsuite_sid,
    jsonb_build_object('source','interaction_activity','activity_id', NEW.id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activities_project_link_click ON interaction.activities;
CREATE TRIGGER activities_project_link_click
  AFTER INSERT ON interaction.activities
  FOR EACH ROW
  WHEN (NEW.action = 'click_interaction')
  EXECUTE FUNCTION interaction.project_link_click();

-- ── Sync bookkeeping (vestigial: kept for compatibility; no ETL in unified mode) ─
CREATE TABLE interaction.sync_state (
  company_id     UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  entity         TEXT        NOT NULL,   -- interactions | activities | customers
  last_synced_at TIMESTAMPTZ,
  last_cursor    TEXT,
  status         TEXT        NOT NULL DEFAULT 'idle',
  error_message  TEXT,
  updated_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, entity)
);
