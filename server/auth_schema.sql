-- ============================================================
--  CDP Click AI - Authentication & Multi-tenancy Schema
--  Extend the "app" schema with users, companies, and access.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.users (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email                 TEXT        NOT NULL,
  password_hash         TEXT,
  full_name             TEXT        NOT NULL DEFAULT '',
  avatar_url            TEXT,
  is_email_verified     BOOLEAN     NOT NULL DEFAULT false,
  email_verify_token    TEXT,
  email_verify_expires  TIMESTAMPTZ,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  last_login_at         TIMESTAMPTZ,
  metadata              JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON app.users(LOWER(email));
CREATE OR REPLACE TRIGGER users_updated_date
  BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Password Reset Tokens ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.password_reset_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS prt_user_idx ON app.password_reset_tokens(user_id);

-- ── Companies ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.companies (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name            TEXT        NOT NULL DEFAULT '',
  slug            TEXT        NOT NULL DEFAULT '',
  logo_url        TEXT,
  website         TEXT,
  industry        TEXT,
  company_size    TEXT,       -- 1-10 | 11-50 | 51-200 | 201-1000 | 1000+
  plan            TEXT        NOT NULL DEFAULT 'free',  -- free | starter | pro | enterprise
  plan_expires_at TIMESTAMPTZ,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  settings        JSONB       NOT NULL DEFAULT '{}',
  metadata        JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_slug_lower_idx ON app.companies(LOWER(slug));
CREATE OR REPLACE TRIGGER companies_updated_date
  BEFORE UPDATE ON app.companies
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Company Members ───────────────────────────────────────────────────────────
-- role: owner | admin | editor | viewer
-- status: active | suspended
CREATE TABLE IF NOT EXISTS app.company_members (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  role          TEXT        NOT NULL DEFAULT 'viewer',
  status        TEXT        NOT NULL DEFAULT 'active',
  invited_by    UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_members_unique_idx ON app.company_members(company_id, user_id);
CREATE INDEX IF NOT EXISTS company_members_user_idx ON app.company_members(user_id);
CREATE OR REPLACE TRIGGER company_members_updated_date
  BEFORE UPDATE ON app.company_members
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Company Invitations ───────────────────────────────────────────────────────
-- status: pending | accepted | expired | cancelled
CREATE TABLE IF NOT EXISTS app.company_invitations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  invited_by    UUID        NOT NULL REFERENCES app.users(id),
  email         TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'viewer',
  token         TEXT        NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at   TIMESTAMPTZ,
  status        TEXT        NOT NULL DEFAULT 'pending'
);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_idx ON app.company_invitations(token);
CREATE INDEX IF NOT EXISTS invitations_email_idx    ON app.company_invitations(email);
CREATE INDEX IF NOT EXISTS invitations_company_idx  ON app.company_invitations(company_id);

-- ── User Preferences (per user per company) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS app.user_preferences (
  user_id           UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  company_id        UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  theme             TEXT        NOT NULL DEFAULT 'system',  -- light | dark | system
  language          TEXT        NOT NULL DEFAULT 'en',
  timezone          TEXT        NOT NULL DEFAULT 'UTC',
  date_format       TEXT        NOT NULL DEFAULT 'MMM d, yyyy',
  notifications     JSONB       NOT NULL DEFAULT '{"email_digest":true,"member_joined":true,"report_ready":true}',
  sidebar_collapsed BOOLEAN     NOT NULL DEFAULT false,
  dashboard_layout  JSONB       NOT NULL DEFAULT '{}',
  updated_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, company_id)
);

-- ── API Keys ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.api_keys (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by    UUID        NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  name          TEXT        NOT NULL DEFAULT '',
  key_hash      TEXT        NOT NULL,
  key_prefix    TEXT        NOT NULL,
  permissions   TEXT[]      NOT NULL DEFAULT '{"read"}',
  expires_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  metadata      JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS api_keys_company_idx ON app.api_keys(company_id);
CREATE OR REPLACE TRIGGER api_keys_updated_date
  BEFORE UPDATE ON app.api_keys
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Audit Log ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.audit_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id     UUID        REFERENCES app.companies(id) ON DELETE SET NULL,
  user_id        UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  action         TEXT        NOT NULL,    -- login | logout | create | update | delete | invite | etc.
  resource_type  TEXT,                    -- user | company | campaign | segment | report | etc.
  resource_id    TEXT,
  ip_address     TEXT,
  user_agent     TEXT,
  changes        JSONB       NOT NULL DEFAULT '{}',
  metadata       JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_log_company_idx  ON app.audit_log(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx     ON app.audit_log(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_resource_idx ON app.audit_log(resource_type, resource_id);

-- ── Multi-tenancy columns on existing tables ──────────────────────────────────
-- visibility: 'private' = draft, only creator can see; 'company' = published, all members see

ALTER TABLE app.campaigns         ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.campaigns         ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app.users(id) ON DELETE SET NULL;
ALTER TABLE app.campaigns         ADD COLUMN IF NOT EXISTS visibility  TEXT NOT NULL DEFAULT 'private';

ALTER TABLE app.segments          ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.segments          ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app.users(id) ON DELETE SET NULL;
ALTER TABLE app.segments          ADD COLUMN IF NOT EXISTS visibility  TEXT NOT NULL DEFAULT 'private';

ALTER TABLE app.saved_reports     ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.saved_reports     ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app.users(id) ON DELETE SET NULL;
ALTER TABLE app.saved_reports     ADD COLUMN IF NOT EXISTS visibility  TEXT NOT NULL DEFAULT 'private';

ALTER TABLE app.pinned_charts     ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.pinned_charts     ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app.users(id) ON DELETE SET NULL;
ALTER TABLE app.pinned_charts     ADD COLUMN IF NOT EXISTS visibility  TEXT NOT NULL DEFAULT 'private';

ALTER TABLE app.conversations     ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.conversations     ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app.users(id) ON DELETE SET NULL;
ALTER TABLE app.conversations     ADD COLUMN IF NOT EXISTS visibility  TEXT NOT NULL DEFAULT 'private';

ALTER TABLE app.edm_templates     ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.edm_templates     ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app.users(id) ON DELETE SET NULL;
ALTER TABLE app.edm_templates     ADD COLUMN IF NOT EXISTS visibility  TEXT NOT NULL DEFAULT 'private';

ALTER TABLE app.edm_campaigns     ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.edm_campaigns     ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app.users(id) ON DELETE SET NULL;
ALTER TABLE app.edm_campaigns     ADD COLUMN IF NOT EXISTS visibility  TEXT NOT NULL DEFAULT 'private';

ALTER TABLE app.edm_automations   ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.edm_automations   ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app.users(id) ON DELETE SET NULL;
ALTER TABLE app.edm_automations   ADD COLUMN IF NOT EXISTS visibility  TEXT NOT NULL DEFAULT 'private';

ALTER TABLE app.data_integrations         ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.settings                  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.company_report_config     ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.web_content_html_elements ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;

-- ── Plans ─────────────────────────────────────────────────────────────────────
-- Stores all plan definitions including pricing, limits, features, and trial config.
-- Frontend reads this table at runtime so no business rules are hardcoded in code.

CREATE TABLE IF NOT EXISTS app.plans (
  id               TEXT        PRIMARY KEY,           -- 'free' | 'pro' | 'enterprise'
  name             TEXT        NOT NULL,
  price_display    TEXT        NOT NULL DEFAULT '',   -- '$0', '$49', 'Custom'
  period           TEXT        NOT NULL DEFAULT '',   -- '1 month free', 'per month', ''
  badge            TEXT,                              -- 'Trial', null
  description      TEXT        NOT NULL DEFAULT '',
  cta_label        TEXT        NOT NULL DEFAULT 'Get started',
  cta_href         TEXT        NOT NULL DEFAULT '/register',
  cta_external     BOOLEAN     NOT NULL DEFAULT false,
  is_highlighted   BOOLEAN     NOT NULL DEFAULT false,
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  trial_days       INTEGER,                           -- NULL = no trial; 30 = 30-day trial
  warning_days     INTEGER     NOT NULL DEFAULT 7,    -- days before trial end to show warning banner
  features         JSONB       NOT NULL DEFAULT '[]', -- array of display strings
  limits           JSONB       NOT NULL DEFAULT '{}', -- {profiles, campaigns, ai_tokens, team_members} - null = unlimited
  is_active        BOOLEAN     NOT NULL DEFAULT true
);

INSERT INTO app.plans
  (id, name, price_display, period, badge, description, cta_label, cta_href, cta_external,
   is_highlighted, sort_order, trial_days, warning_days, features, limits)
VALUES
  ('free', 'Free', '$0', '1 month free', 'Trial',
   'Try everything free for 30 days. Solo use only - no team members.',
   'Start free trial', '/register', false, false, 1, 30, 7,
   '["Solo user only (no team members)","1,000 customer profiles","5 email campaigns","1,000 AI tokens","UTM tracking","Read-only access after trial ends"]'::jsonb,
   '{"profiles":1000,"campaigns":5,"ai_tokens":1000,"team_members":1}'::jsonb),

  ('pro', 'Pro', '$49', 'per month', null,
   'For growing teams that need more power and fewer limits.',
   'Get started', '/register', false, true, 2, null, 7,
   '["Up to 5 team members","100,000 customer profiles","Unlimited email campaigns","Unlimited AI tokens","Advanced segmentation","Priority support"]'::jsonb,
   '{"profiles":100000,"campaigns":null,"ai_tokens":null,"team_members":5}'::jsonb),

  ('enterprise', 'Enterprise', 'Custom', '', null,
   'Dedicated infrastructure, SLAs, and white-glove onboarding.',
   'Contact sales', 'mailto:support@clickcdp.com?subject=Enterprise inquiry', true, false, 3, null, 7,
   '["Everything in Pro","Unlimited team members","Dedicated database","SSO / SAML","99.99% uptime SLA","Dedicated success manager"]'::jsonb,
   '{"profiles":null,"campaigns":null,"ai_tokens":null,"team_members":null}'::jsonb)

ON CONFLICT (id) DO UPDATE SET
  name           = EXCLUDED.name,
  price_display  = EXCLUDED.price_display,
  period         = EXCLUDED.period,
  badge          = EXCLUDED.badge,
  description    = EXCLUDED.description,
  cta_label      = EXCLUDED.cta_label,
  cta_href       = EXCLUDED.cta_href,
  cta_external   = EXCLUDED.cta_external,
  is_highlighted = EXCLUDED.is_highlighted,
  sort_order     = EXCLUDED.sort_order,
  trial_days     = EXCLUDED.trial_days,
  warning_days   = EXCLUDED.warning_days,
  features       = EXCLUDED.features,
  limits         = EXCLUDED.limits;

-- ── Billing Invoices ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.billing_invoices (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency      TEXT        NOT NULL DEFAULT 'USD',
  status        TEXT        NOT NULL DEFAULT 'paid',  -- paid | pending | failed | refunded
  description   TEXT        NOT NULL DEFAULT '',
  invoice_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_start  TIMESTAMPTZ,
  period_end    TIMESTAMPTZ,
  invoice_url   TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS billing_invoices_company_idx
  ON app.billing_invoices(company_id, invoice_date DESC);

-- ── Usage Events ─────────────────────────────────────────────────────────────
-- Tracks quota consumption (AI tokens, profile imports, etc.)
CREATE TABLE IF NOT EXISTS app.usage_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  user_id       UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  event_type    TEXT        NOT NULL,   -- 'ai_token' | 'profile_import' | ...
  quantity      INTEGER     NOT NULL DEFAULT 1,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS usage_events_company_type_idx
  ON app.usage_events(company_id, event_type, occurred_at DESC);

-- ── Support Tickets ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.support_tickets (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        REFERENCES app.companies(id) ON DELETE SET NULL,
  user_id       UUID        REFERENCES app.users(id)    ON DELETE SET NULL,
  type          TEXT        NOT NULL DEFAULT 'feedback',  -- feedback | bug | feature_request | support
  subject       TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'open',      -- open | in_progress | resolved | closed
  priority      TEXT        NOT NULL DEFAULT 'normal',    -- low | normal | high | urgent
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  metadata      JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx
  ON app.support_tickets(user_id, created_date DESC);
CREATE INDEX IF NOT EXISTS support_tickets_company_idx
  ON app.support_tickets(company_id, created_date DESC);
CREATE OR REPLACE TRIGGER support_tickets_updated_date
  BEFORE UPDATE ON app.support_tickets
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Multi-tenancy isolation: scope all user data to company_id ────────────────
-- These ALTER TABLE / CREATE INDEX statements are idempotent (IF NOT EXISTS).

-- EDM Templates
ALTER TABLE app.edm_templates  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS edm_templates_company_idx  ON app.edm_templates(company_id);

-- EDM Campaigns
ALTER TABLE app.edm_campaigns  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS edm_campaigns_company_idx  ON app.edm_campaigns(company_id);

-- EDM Automations
ALTER TABLE app.edm_automations ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS edm_automations_company_idx ON app.edm_automations(company_id);

-- EDM Suppression: per-company do-not-send list
ALTER TABLE app.edm_suppression ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS edm_suppression_co_email_uidx ON app.edm_suppression(company_id, email) WHERE company_id IS NOT NULL;

-- Data Integrations: per-company connections (drop global unique, add per-company unique)
ALTER TABLE app.data_integrations ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
ALTER TABLE app.data_integrations DROP CONSTRAINT IF EXISTS data_integrations_integration_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS data_integrations_co_type_uidx ON app.data_integrations(company_id, integration_type) WHERE company_id IS NOT NULL;

-- Conversations: per-company AI analyst history
ALTER TABLE app.conversations ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS conversations_company_idx ON app.conversations(company_id);

-- Settings: per-company key-value store (analyst context, etc.)
ALTER TABLE app.settings ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS settings_co_key_uidx ON app.settings(company_id, key) WHERE company_id IS NOT NULL;

-- Customer profiles: tag manually imported profiles with the importing workspace
ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES app.companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS customer_profiles_company_idx ON app.customer_profiles(company_id);
