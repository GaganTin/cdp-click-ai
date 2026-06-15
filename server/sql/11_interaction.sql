-- ============================================================================
--  11_interaction.sql - LOCAL MIRROR of interaction-service data (schema: interaction)
-- ----------------------------------------------------------------------------
--  The interaction-service is a separate Go microservice (GORM models:
--  Company, Interaction, Activity, Customer). This schema mirrors those tables
--  in the app DB so popup analytics can run SQL joins locally. COLUMN NAMES MATCH
--  the service / the queries in server/routes/popup.js exactly:
--    interaction.companies(id, cdp_company_id)
--    interaction.interactions(id, company_id → companies.id, cdp_reference_id)
--    interaction.activities(correlated_interaction_id → interactions.id,
--                           capsuite_sid, action, created_at)
--  Workspace deletes cascade in via interaction.companies.cdp_company_id.
-- ============================================================================

-- ── Companies (service company ↔ app workspace) ─────────────────────────────
CREATE TABLE interaction.companies (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),  -- interaction-service company id
  cdp_company_id UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,  -- → app workspace
  name           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX interaction_companies_cdp_idx ON interaction.companies(cdp_company_id);

-- ── Interactions (popup definitions in the service) ─────────────────────────
CREATE TABLE interaction.interactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL REFERENCES interaction.companies(id) ON DELETE CASCADE,
  cdp_reference_id TEXT,                              -- ↔ app.popups.cdp_reference_id
  name             TEXT,
  interaction_type TEXT,
  status           TEXT,
  rules            JSONB       NOT NULL DEFAULT '{}',
  content          TEXT,
  start_time       TIMESTAMPTZ,
  end_time         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX interaction_interactions_ref_idx     ON interaction.interactions(cdp_reference_id);
CREATE INDEX interaction_interactions_company_idx ON interaction.interactions(company_id);

-- ── Activities (impressions/clicks/closes/email collection) ─────────────────
-- action ∈ retrieve_interaction | click_interaction | close_interaction | email_collection
CREATE TABLE interaction.activities (
  id                        BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correlated_interaction_id UUID        REFERENCES interaction.interactions(id) ON DELETE CASCADE,
  capsuite_sid              TEXT,       -- session id
  capsuite_apid             TEXT,       -- anonymous/visitor id
  action                    TEXT        NOT NULL,
  page_url                  TEXT,
  page_title                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX interaction_activities_corr_idx   ON interaction.activities(correlated_interaction_id);
CREATE INDEX interaction_activities_action_idx ON interaction.activities(action, created_at DESC);
CREATE INDEX interaction_activities_sid_idx    ON interaction.activities(capsuite_sid);

-- ── Customers / visitors tracked by the service (email collection) ──────────
CREATE TABLE interaction.customers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES interaction.companies(id) ON DELETE CASCADE,
  capsuite_apid TEXT,
  capsuite_sid  TEXT,
  email         TEXT,
  first_name    TEXT,
  last_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX interaction_customers_email_idx ON interaction.customers(company_id, LOWER(email)) WHERE email IS NOT NULL;

-- ── Sync bookkeeping (per app workspace) ────────────────────────────────────
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
