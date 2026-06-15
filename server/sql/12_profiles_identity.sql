-- ============================================================================
--  12_profiles_identity.sql - UNIFIED customer profiles + identity map
-- ----------------------------------------------------------------------------
--  The master person list and the mapping layer that stitches together
--  membership from every source (manual, shopify) plus web identity (GA
--  anonymous ids, popup-collected emails).
--
--        app.customer_profiles      ← golden record, one per resolved person/company
--                ▲
--                │ app.profile_identities  (the identity graph)
--                │
--   ┌────────────┼───────────────┬──────────────────┬───────────────────────┐
--  manual.membership   shopify.membership   ga_landing (anonymous_id)   interaction.customers
--                                                                        (collected email)
--
--  app.anonymous_profiles holds visitors not yet resolved to a customer; when an
--  identity link appears (email capture / manual mapping with anonymous_id) the
--  anonymous row is linked to a customer profile via app.profile_identities.
-- ============================================================================

-- ── Master customer profile (golden record) ────────────────────────────────
-- member_id is the resolved person key, unique per company. member_source tells
-- where the primary record came from; 'mixed' when stitched from >1 source.
CREATE TABLE app.customer_profiles (
  company_id            UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  member_id             TEXT        NOT NULL,
  created_date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  member_source         TEXT        NOT NULL DEFAULT 'manual',  -- manual | shopify | ga | mixed
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
  -- contact & preferences (booleans are native BOOLEAN now, not TEXT)
  has_email             BOOLEAN,
  has_phone             BOOLEAN,
  primary_phone         TEXT,
  preferred_language    TEXT,
  preferred_channel     TEXT,
  is_opt_in_email       BOOLEAN,
  is_opt_in_call        BOOLEAN,
  is_opt_in_dm          BOOLEAN,
  is_opt_in_sms         BOOLEAN,
  is_subscriber_only    BOOLEAN,
  tags                  TEXT,
  -- GA web activity (aggregated; display cache)
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
  -- commerce (aggregated from manual/shopify sales; display cache)
  order_count           INTEGER     DEFAULT 0,
  total_spend           NUMERIC     DEFAULT 0,
  first_order_date      TIMESTAMPTZ,
  last_order_date       TIMESTAMPTZ,
  -- offline / CRM activity
  seminar_count         INTEGER     DEFAULT 0,
  seminars              JSONB       DEFAULT '[]',
  -- attributes (display cache; source of truth = app.profile_attribute_values)
  attribute_count       INTEGER     DEFAULT 0,
  attributes            JSONB       DEFAULT '{}',
  -- provenance
  is_manual             BOOLEAN     NOT NULL DEFAULT false,
  last_refreshed        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (company_id, member_id)
);
CREATE INDEX customer_profiles_company_email_idx ON app.customer_profiles(company_id, LOWER(primary_email)) WHERE primary_email IS NOT NULL;
CREATE INDEX customer_profiles_company_phone_idx ON app.customer_profiles(company_id, primary_phone) WHERE primary_phone IS NOT NULL;
CREATE INDEX customer_profiles_source_idx        ON app.customer_profiles(company_id, member_source);
CREATE TRIGGER customer_profiles_updated_date BEFORE UPDATE ON app.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Identity map (the mapping layer to every source) ────────────────────────
-- Each row links a master profile to one contributing identity. A profile can
-- have many identities (an email, a phone, a shopify member_id, several GA
-- anonymous ids). identity_value is unique per (company, identity_type) so the
-- same email/anonymous id can't point at two profiles in one workspace.
CREATE TABLE app.profile_identities (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  member_id     TEXT        NOT NULL,                 -- → app.customer_profiles.member_id (same company)
  source        TEXT        NOT NULL,                 -- manual | shopify | ga | interaction | popup
  source_id     TEXT,                                 -- natural key in the source table (e.g. shopify member_id, trxn customerId)
  identity_type TEXT        NOT NULL CHECK (identity_type IN ('email','phone','member_id','anonymous_id')),
  identity_value TEXT       NOT NULL,
  is_primary    BOOLEAN     NOT NULL DEFAULT false,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata      JSONB       NOT NULL DEFAULT '{}',
  FOREIGN KEY (company_id, member_id) REFERENCES app.customer_profiles(company_id, member_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX profile_identities_unique_idx
  ON app.profile_identities(company_id, identity_type, LOWER(identity_value));
CREATE INDEX profile_identities_member_idx ON app.profile_identities(company_id, member_id);
CREATE INDEX profile_identities_source_idx ON app.profile_identities(company_id, source, source_id);
CREATE TRIGGER profile_identities_updated_date BEFORE UPDATE ON app.profile_identities
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Anonymous visitor profiles (unresolved web visitors) ────────────────────
-- Built from ga_landing.path_exploration (and interaction.activities) for
-- visitors not yet linked to a customer profile. resolved_member_id is set when
-- an identity link is found (email capture / manual anonymous_id mapping).
CREATE TABLE app.anonymous_profiles (
  company_id          UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  visitor_id          TEXT        NOT NULL,           -- capsuite_apid
  first_seen          DATE,
  last_seen           DATE,
  total_events        INTEGER     DEFAULT 0,
  page_views          INTEGER     DEFAULT 0,
  sessions            INTEGER     DEFAULT 0,
  first_visits        INTEGER     DEFAULT 0,
  form_starts         INTEGER     DEFAULT 0,
  form_completes      INTEGER     DEFAULT 0,
  scroll_events       INTEGER     DEFAULT 0,
  whatsapp_clicks     INTEGER     DEFAULT 0,
  file_downloads      INTEGER     DEFAULT 0,
  click_events        INTEGER     DEFAULT 0,
  user_engagement     INTEGER     DEFAULT 0,
  top_source_medium   TEXT,
  top_campaign        TEXT,
  source_mediums      TEXT[]      DEFAULT '{}',
  campaigns           TEXT[]      DEFAULT '{}',
  events              TEXT[]      DEFAULT '{}',
  pages_visited       TEXT[]      DEFAULT '{}',
  -- set once stitched to a known customer (via profile_identities)
  resolved_member_id  TEXT,
  resolved_at         TIMESTAMPTZ,
  last_refreshed      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (company_id, visitor_id)
);
CREATE INDEX anonymous_profiles_resolved_idx ON app.anonymous_profiles(company_id, resolved_member_id) WHERE resolved_member_id IS NOT NULL;

-- ── Profile merge candidates (review queue for cross-source duplicates) ─────
CREATE TABLE app.profile_merge_candidates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  member_id_a   TEXT        NOT NULL,   -- existing / kept profile
  source_a      TEXT,
  member_id_b   TEXT        NOT NULL,   -- newer / incoming profile
  source_b      TEXT,
  match_type    TEXT        NOT NULL,   -- email | phone | email+phone | anonymous_id
  match_value   TEXT,
  confidence    TEXT        NOT NULL DEFAULT 'exact',   -- exact | fuzzy
  status        TEXT        NOT NULL DEFAULT 'pending', -- pending | merged | dismissed
  resolved_into TEXT,                   -- surviving member_id after a merge
  resolved_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ,
  metadata      JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX profile_merge_candidates_pair_idx
  ON app.profile_merge_candidates(company_id, LEAST(member_id_a, member_id_b), GREATEST(member_id_a, member_id_b), match_type);
CREATE INDEX profile_merge_candidates_status_idx ON app.profile_merge_candidates(company_id, status);
CREATE TRIGGER profile_merge_candidates_updated_date BEFORE UPDATE ON app.profile_merge_candidates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();
