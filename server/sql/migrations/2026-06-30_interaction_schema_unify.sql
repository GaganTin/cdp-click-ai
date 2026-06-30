-- 2026-06-30  Unify interaction-service onto the shared CDP database.
-- ----------------------------------------------------------------------------
-- The interaction-service microservice now connects to THIS database and
-- reads/writes the `interaction` schema directly (GORM TablePrefix "interaction.",
-- AutoMigrate disabled). The previous mirror tables had shapes that did not match
-- the GORM models (notably activities.id was BIGINT, and several GORM columns were
-- missing). This migration rebuilds the four service tables to match the models in
-- server/sql/11_interaction.sql exactly.
--
-- DESTRUCTIVE: drops existing interaction.companies/interactions/activities/customers
-- rows. Safe in unified mode because no live service data has been written to these
-- tables yet (they previously held only seed/demo rows). interaction.sync_state is
-- left untouched.
-- ----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS interaction;

DROP TABLE IF EXISTS interaction.activities    CASCADE;
DROP TABLE IF EXISTS interaction.customers     CASCADE;
DROP TABLE IF EXISTS interaction.interactions  CASCADE;
DROP TABLE IF EXISTS interaction.companies     CASCADE;

-- Companies (GORM: Company)
CREATE TABLE interaction.companies (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name           TEXT,
  cdp_company_id UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX interaction_companies_cdp_idx ON interaction.companies(cdp_company_id);

-- Interactions (GORM: Interaction)
CREATE TABLE interaction.interactions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name                   TEXT        NOT NULL DEFAULT '',
  company_id             UUID        NOT NULL REFERENCES interaction.companies(id) ON DELETE CASCADE,
  interaction_type       TEXT,
  cdp_reference_id       TEXT,
  rules                  JSONB       NOT NULL DEFAULT '{}',
  content                TEXT,
  default_recommendation JSONB       NOT NULL DEFAULT '{}',
  is_active              BOOLEAN     NOT NULL DEFAULT false,
  start_time             TIMESTAMPTZ,
  end_time               TIMESTAMPTZ,
  is_default             BOOLEAN     NOT NULL DEFAULT false,
  status                 TEXT,
  synced_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX interaction_interactions_ref_idx  ON interaction.interactions(cdp_reference_id);
CREATE INDEX interaction_interactions_company_idx     ON interaction.interactions(company_id);

-- Activities (GORM: Activity)
CREATE TABLE interaction.activities (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  capsuite_sid              TEXT,
  capsuite_apid             TEXT,
  action                    TEXT        NOT NULL,
  correlated_interaction_id UUID        REFERENCES interaction.interactions(id) ON DELETE CASCADE,
  url_parameters            TEXT,
  json_parameters           TEXT,
  page_url                  TEXT,
  page_title                TEXT,
  synced_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX interaction_activities_corr_idx   ON interaction.activities(correlated_interaction_id);
CREATE INDEX interaction_activities_action_idx ON interaction.activities(action, created_at DESC);
CREATE INDEX interaction_activities_sid_idx    ON interaction.activities(capsuite_sid);

-- Customers (GORM: Customer; extra columns support seed/demo data)
CREATE TABLE interaction.customers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recommendations TEXT[],
  capsuite_sid    TEXT,
  interaction_id  UUID,
  company_id      UUID        REFERENCES interaction.companies(id) ON DELETE CASCADE,
  capsuite_apid   TEXT,
  email           TEXT,
  first_name      TEXT,
  last_name       TEXT,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX interaction_customers_email_idx ON interaction.customers(company_id, LOWER(email)) WHERE email IS NOT NULL;

-- Project email_collection activities → app.popup_email_collected (Emails Collected tab).
CREATE OR REPLACE FUNCTION interaction.project_email_collection() RETURNS trigger AS $$
DECLARE
  v_json        jsonb;
  v_email       text;
  v_ref         text;
  v_cdp_company uuid;
  v_popup       app.popups%ROWTYPE;
BEGIN
  BEGIN
    v_json := NEW.json_parameters::jsonb;
  EXCEPTION WHEN others THEN
    v_json := '{}'::jsonb;
  END;

  v_email := NULLIF(btrim(lower(v_json->>'email')), '');
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT i.cdp_reference_id, c.cdp_company_id
    INTO v_ref, v_cdp_company
    FROM interaction.interactions i
    JOIN interaction.companies c ON c.id = i.company_id
   WHERE i.id = NEW.correlated_interaction_id;

  IF v_cdp_company IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_popup
    FROM app.popups
   WHERE company_id = v_cdp_company AND cdp_reference_id = v_ref
   LIMIT 1;

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
