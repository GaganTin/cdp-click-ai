-- ============================================================================
--  02_accounts_auth.sql - tenancy root: Account → Workspace(company) → Member
-- ----------------------------------------------------------------------------
--  Hierarchy:
--    app.accounts        one per signup; owns billing/plan and N workspaces
--      └ app.users           login identities, each belongs to ONE account
--      └ app.companies       "workspaces"; each has its own capsuite_ref +
--                            interaction_service_company_id; fully data-isolated
--          └ app.company_members   (user × company × role) = per-company access
--
--  Every tenant-scoped table elsewhere references app.companies(id) and is
--  NOT NULL on company_id. account_id is denormalised only where account-level
--  uniqueness is required (see 07_integrations.sql).
--
--  DELETION SEMANTICS (the whole point of the FK choices below):
--    • Delete a WORKSPACE (app.companies row): every company-scoped row in app.*
--      AND in the source schemas (manual/ga_landing/shopify/interaction) is
--      removed via ON DELETE CASCADE on company_id. Audit rows are kept but
--      detached (company_id → NULL) so the "workspace deleted" history survives
--      for the remaining admins.
--    • Delete an ACCOUNT (app.accounts row): cascades to users, companies (and
--      therefore all company-scoped data), members, invitations, integrations,
--      audit_log and support_tickets via account_id ON DELETE CASCADE - i.e.
--      ALL data for the account is removed.
--
--  ROLES (app.company_members.role): admin | contributor | viewer
--    • admin       - sees and controls everything in the workspace, AND sets the
--                    `permissions` overrides that gate what contributors/viewers
--                    may view/edit.
--    • contributor - view + edit, but only where admin granted it in permissions.
--    • viewer      - read-only; never edits (enforced in app middleware).
--  The account creator is the account owner (app.accounts.owner_user_id) and is
--  always an admin on every workspace.
-- ============================================================================

-- ── Plans (catalog; account.plan references this by id) ─────────────────────
--  Only two plans exist: 'free' (a 30-day trial that goes read-only on expiry)
--  and 'paid' (unlocked by contacting sales - there is no in-app payment flow,
--  so the upgrade is applied out-of-band by setting app.accounts.plan = 'paid').
CREATE TABLE app.plans (
  id             TEXT        PRIMARY KEY,            -- 'free' | 'paid'
  name           TEXT        NOT NULL,
  price_display  TEXT        NOT NULL DEFAULT '',
  period         TEXT        NOT NULL DEFAULT '',
  badge          TEXT,
  description    TEXT        NOT NULL DEFAULT '',
  cta_label      TEXT        NOT NULL DEFAULT 'Get started',
  cta_href       TEXT        NOT NULL DEFAULT '/register',
  cta_external   BOOLEAN     NOT NULL DEFAULT false,
  is_highlighted BOOLEAN     NOT NULL DEFAULT false,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  trial_days     INTEGER,
  warning_days   INTEGER     NOT NULL DEFAULT 7,
  features       JSONB       NOT NULL DEFAULT '[]',
  limits         JSONB       NOT NULL DEFAULT '{}',  -- {profiles, campaigns, ai_tokens, team_members, workspaces}
  is_active      BOOLEAN     NOT NULL DEFAULT true
);

INSERT INTO app.plans
  (id, name, price_display, period, badge, description, cta_label, cta_href, cta_external,
   is_highlighted, sort_order, trial_days, warning_days, features, limits)
VALUES
  ('free', 'Free', '$0', '1 month free', 'Trial',
   'Try everything free for 30 days. Solo use only - no team members.',
   'Start free trial', '/register', false, false, 1, 30, 7,
   '["Solo user only (no team members)","5 workspaces","1,000 customer profiles","5 email campaigns","1,000 AI tokens","UTM tracking"]'::jsonb,
   '{"profiles":1000,"campaigns":5,"ai_tokens":1000,"team_members":1,"workspaces":5}'::jsonb),
  ('paid', 'Paid', 'Contact sales', '', null,
   'For growing teams that need more power and fewer limits. Talk to our team to get set up.',
   'Contact sales', 'mailto:support@clickcdp.com?subject=Upgrade to Paid', true, true, 2, null, 7,
   '["Up to 5 team members","5 workspaces","100,000 customer profiles","Unlimited email campaigns","Unlimited AI tokens","Advanced segmentation","Priority support"]'::jsonb,
   '{"profiles":100000,"campaigns":null,"ai_tokens":null,"team_members":5,"workspaces":5}'::jsonb);

-- ── Accounts (the org / billing root) ───────────────────────────────────────
CREATE TABLE app.accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name            TEXT        NOT NULL DEFAULT '',
  slug            TEXT        NOT NULL DEFAULT '',
  plan            TEXT        NOT NULL DEFAULT 'free' REFERENCES app.plans(id),
  plan_expires_at TIMESTAMPTZ,                    -- free-trial end; null once on a paid plan
  plan_upgraded_at TIMESTAMPTZ,                   -- when the account moved to 'paid' (stamped by trigger below)
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  -- the account creator / billing owner; FK added after app.users exists below.
  owner_user_id   UUID,
  settings        JSONB       NOT NULL DEFAULT '{}',
  metadata        JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX accounts_slug_lower_idx ON app.accounts(LOWER(slug));
CREATE TRIGGER accounts_updated_date BEFORE UPDATE ON app.accounts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- Stamp plan_upgraded_at the moment an account moves onto the paid plan (and
-- clear the now-irrelevant trial expiry). The upgrade itself is applied
-- out-of-band (sales sets app.accounts.plan = 'paid'); this keeps the date
-- accurate no matter how the change is made. Reverting to free clears the stamp.
CREATE OR REPLACE FUNCTION app.stamp_plan_upgraded_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan = 'paid' AND COALESCE(OLD.plan, '') <> 'paid' THEN
    NEW.plan_upgraded_at := NOW();
    NEW.plan_expires_at  := NULL;
  ELSIF NEW.plan = 'free' AND OLD.plan <> 'free' THEN
    NEW.plan_upgraded_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_stamp_plan_upgraded
  BEFORE INSERT OR UPDATE OF plan ON app.accounts
  FOR EACH ROW EXECUTE FUNCTION app.stamp_plan_upgraded_at();

-- ── Users (login identities; one account each) ──────────────────────────────
CREATE TABLE app.users (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id           UUID        NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  email                TEXT        NOT NULL,
  password_hash        TEXT,
  full_name            TEXT        NOT NULL DEFAULT '',
  avatar_url           TEXT,
  is_email_verified    BOOLEAN     NOT NULL DEFAULT false,
  email_verify_token   TEXT,
  email_verify_expires TIMESTAMPTZ,
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  -- platform-owner flag: sits ABOVE per-workspace roles. true = full access to
  -- the Studio admin console (/api/admin/*) and every client account.
  is_platform_admin    BOOLEAN     NOT NULL DEFAULT false,
  -- email-OTP two-factor: when true, password sign-in requires a second factor
  -- (a 6-digit code emailed via app.mfa_challenges). Opt-in from Settings.
  mfa_enabled          BOOLEAN     NOT NULL DEFAULT false,
  last_login_at        TIMESTAMPTZ,
  -- set on password change/reset; tokens issued before this are rejected by
  -- authenticate (so a password change signs out all other sessions).
  password_changed_at  TIMESTAMPTZ,
  metadata             JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX users_email_lower_idx ON app.users(LOWER(email));
CREATE INDEX users_account_idx ON app.users(account_id);
CREATE INDEX users_platform_admin_idx ON app.users(is_platform_admin) WHERE is_platform_admin;
CREATE TRIGGER users_updated_date BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- now that app.users exists, wire the account owner FK
ALTER TABLE app.accounts
  ADD CONSTRAINT accounts_owner_fk
  FOREIGN KEY (owner_user_id) REFERENCES app.users(id) ON DELETE SET NULL;

-- ── Password reset tokens ───────────────────────────────────────────────────
CREATE TABLE app.password_reset_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX prt_user_idx ON app.password_reset_tokens(user_id);

-- ── Pending email verifications (code-based sign-up) ────────────────────────
--  Sign-up is parked here until the emailed 6-digit code is confirmed; ONLY
--  then is the account → user → workspace chain provisioned (see
--  POST /api/auth/register/verify). One pending row per email: the address is
--  stored lowercased as the PK, so re-submitting sign-up just replaces it.
CREATE TABLE app.email_verifications (
  email         TEXT        PRIMARY KEY,            -- lowercased
  password_hash TEXT        NOT NULL,
  full_name     TEXT        NOT NULL,
  company_name  TEXT        NOT NULL,
  code_hash     TEXT        NOT NULL,               -- sha256 of the 6-digit code
  attempts      INTEGER     NOT NULL DEFAULT 0,     -- wrong-code guesses (capped)
  expires_at    TIMESTAMPTZ NOT NULL,              -- code TTL (15 min)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── MFA challenges (email-OTP second factor) ────────────────────────────────
--  Short-lived 6-digit codes for two-factor auth. purpose distinguishes:
--    'login'  - issued after a correct password when mfa_enabled; the challenge
--               id (an unguessable UUID) is handed to the client and completed
--               via POST /api/auth/login/mfa. No session exists until then.
--    'enable' - issued from Settings to confirm the user can receive codes
--               before mfa_enabled is flipped on (POST /api/auth/mfa/enable).
--  The raw code is never stored (sha256 only). Codes expire (10 min) and the
--  attempt counter caps brute-force guessing. Rows are deleted on use/expiry.
CREATE TABLE app.mfa_challenges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  purpose     TEXT        NOT NULL DEFAULT 'login'
                CHECK (purpose IN ('login','enable')),
  code_hash   TEXT        NOT NULL,                -- sha256 of the 6-digit code
  attempts    INTEGER     NOT NULL DEFAULT 0,      -- wrong-code guesses (capped at 5)
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,                         -- set when the code is accepted
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mfa_challenges_user_idx ON app.mfa_challenges(user_id);

-- ── Companies (= workspaces) ────────────────────────────────────────────────
CREATE TABLE app.companies (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id                      UUID        NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  name                            TEXT        NOT NULL DEFAULT '',
  slug                            TEXT        NOT NULL DEFAULT '',
  -- one workspace ↔ one capsuite_ref; the source schemas (manual/ga_landing/
  -- shopify/interaction) are partitioned by company_id, and the external ETL
  -- maps capsuite_ref → company_id via this column.
  capsuite_ref                    TEXT        NOT NULL,
  logo_url                        TEXT,
  website                         TEXT,
  industry                        TEXT,
  company_size                    TEXT,
  -- workspace-level active flag (a workspace can be deactivated independently)
  is_active                       BOOLEAN     NOT NULL DEFAULT true,
  -- denormalised copy of the owning account's plan, for display in the workspace
  -- switcher / settings; account.plan remains the source of truth for billing.
  plan                            TEXT,
  -- each workspace gets its own interaction-service company id
  interaction_service_company_id  UUID,
  interaction_service_synced_at   TIMESTAMPTZ,
  settings                        JSONB       NOT NULL DEFAULT '{}',
  metadata                        JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX companies_capsuite_ref_idx ON app.companies(capsuite_ref);
CREATE UNIQUE INDEX companies_account_slug_idx ON app.companies(account_id, LOWER(slug));
CREATE UNIQUE INDEX companies_is_company_id_idx
  ON app.companies(interaction_service_company_id) WHERE interaction_service_company_id IS NOT NULL;
CREATE INDEX companies_account_idx ON app.companies(account_id);
CREATE TRIGGER companies_updated_date BEFORE UPDATE ON app.companies
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Company members (per-company access grid) ───────────────────────────────
-- A user sees only the companies they have a row for. role governs edit rights;
-- `permissions` holds the admin-configured overrides that gate exactly what a
-- contributor may edit and what a viewer may see. Convention:
--   {} (empty)  → use role defaults (admin=full, contributor=view+edit,
--                 viewer=view-only).
--   otherwise   → { "resources": { "<page>": { "view": bool, "edit": bool } } }
--   pages: dashboard, analyst, campaigns, segments, profiles, edm, popups,
--          attributes, integrations, reports, settings.
-- Viewers never get edit=true regardless of overrides (enforced in middleware).
CREATE TABLE app.company_members (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id   UUID        NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL DEFAULT 'viewer'
                 CHECK (role IN ('admin','contributor','viewer')),
  permissions  JSONB       NOT NULL DEFAULT '{}',       -- admin-set view/edit overrides
  status       TEXT        NOT NULL DEFAULT 'active',   -- active | suspended
  invited_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX company_members_unique_idx ON app.company_members(company_id, user_id);
CREATE INDEX company_members_user_idx ON app.company_members(user_id);
CREATE INDEX company_members_account_idx ON app.company_members(account_id);
CREATE TRIGGER company_members_updated_date BEFORE UPDATE ON app.company_members
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Company invitations ─────────────────────────────────────────────────────
CREATE TABLE app.company_invitations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id   UUID        NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  invited_by   UUID        NOT NULL REFERENCES app.users(id),
  email        TEXT        NOT NULL,
  role         TEXT        NOT NULL DEFAULT 'viewer'
                 CHECK (role IN ('admin','contributor','viewer')),
  permissions  JSONB       NOT NULL DEFAULT '{}',   -- pre-set overrides applied on accept
  token        TEXT        NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at  TIMESTAMPTZ,
  status       TEXT        NOT NULL DEFAULT 'pending'   -- pending | accepted | expired | cancelled
);
CREATE UNIQUE INDEX invitations_token_idx ON app.company_invitations(token);
CREATE INDEX invitations_email_idx   ON app.company_invitations(email);
CREATE INDEX invitations_company_idx ON app.company_invitations(company_id);

-- ── User preferences (per user per company) ─────────────────────────────────
CREATE TABLE app.user_preferences (
  user_id           UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  company_id        UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  theme             TEXT        NOT NULL DEFAULT 'system',
  language          TEXT        NOT NULL DEFAULT 'en',
  timezone          TEXT        NOT NULL DEFAULT 'UTC',
  date_format       TEXT        NOT NULL DEFAULT 'MMM d, yyyy',
  notifications     JSONB       NOT NULL DEFAULT '{"campaign_completed":true,"sync_status":true,"new_leads":true}',
  sidebar_collapsed BOOLEAN     NOT NULL DEFAULT false,
  dashboard_layout  JSONB       NOT NULL DEFAULT '{}',
  updated_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, company_id)
);

-- ── API keys (per company) ──────────────────────────────────────────────────
CREATE TABLE app.api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  -- SET NULL (not RESTRICT) so deleting an account/user never blocks; the key is
  -- still removed by the company_id cascade when the workspace/account is deleted.
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  name         TEXT        NOT NULL DEFAULT '',
  key_hash     TEXT        NOT NULL,
  key_prefix   TEXT        NOT NULL,
  permissions  TEXT[]      NOT NULL DEFAULT '{"read"}',
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  metadata     JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX api_keys_company_idx ON app.api_keys(company_id);
CREATE TRIGGER api_keys_updated_date BEFORE UPDATE ON app.api_keys
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Audit log (account + company scoped) ────────────────────────────────────
-- Every member action is recorded here. account_id CASCADEs (account delete wipes
-- its audit too); company_id SET NULL so a workspace deletion keeps the history
-- detached at the account level for remaining admins.
--   action: create | update | delete | export | import | view | login | logout |
--           invite | role_change | connect | disconnect | sync | send | ...
--   resource_type: account | workspace | user | member | segment | campaign |
--           profile | edm_campaign | template | popup | attribute | integration |
--           report | suppression | upload | ...
CREATE TABLE app.audit_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id    UUID        REFERENCES app.accounts(id) ON DELETE CASCADE,
  company_id    UUID        REFERENCES app.companies(id) ON DELETE SET NULL,
  user_id       UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  action        TEXT        NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  ip_address    TEXT,
  user_agent    TEXT,
  changes       JSONB       NOT NULL DEFAULT '{}',
  metadata      JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_company_idx  ON app.audit_log(company_id, occurred_at DESC);
CREATE INDEX audit_log_account_idx  ON app.audit_log(account_id, occurred_at DESC);
CREATE INDEX audit_log_resource_idx ON app.audit_log(resource_type, resource_id);

-- ── Blocked emails ──────────────────────────────────────────────────────────
-- Emails that owned/belonged to a DELETED account. They may never sign up or
-- sign in again, on any provider (password, Google, Microsoft). Deliberately has
-- NO foreign key: the row must survive the account-deletion cascade that removes
-- the original user. Populated by the account-delete paths; checked by register
-- and OAuth provisioning. Remove a row to let an email be used again.
CREATE TABLE app.blocked_emails (
  email      TEXT        PRIMARY KEY,          -- stored lowercased
  reason     TEXT        NOT NULL DEFAULT 'account_deleted',
  account_id UUID,                             -- the now-deleted account (no FK)
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Support tickets (account scoped) ────────────────────────────────────────
CREATE TABLE app.support_tickets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID        REFERENCES app.accounts(id) ON DELETE CASCADE,
  company_id   UUID        REFERENCES app.companies(id) ON DELETE SET NULL,
  user_id      UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  type         TEXT        NOT NULL DEFAULT 'feedback',  -- feedback | bug | feature_request | support
  subject      TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'open',      -- open | in_progress | resolved | closed
  priority     TEXT        NOT NULL DEFAULT 'normal',    -- low | normal | high | urgent
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  metadata     JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX support_tickets_user_idx    ON app.support_tickets(user_id, created_date DESC);
CREATE INDEX support_tickets_company_idx ON app.support_tickets(company_id, created_date DESC);
CREATE TRIGGER support_tickets_updated_date BEFORE UPDATE ON app.support_tickets
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Usage events (quota consumption: ai_token, profile_import, ...) ─────────
CREATE TABLE app.usage_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  event_type  TEXT        NOT NULL,   -- ai_token | profile_import | ...
  quantity    INTEGER     NOT NULL DEFAULT 1,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX usage_events_company_type_idx ON app.usage_events(company_id, event_type, occurred_at DESC);

-- ── AI usage + cost tracking (per user / per workspace / per account) ───────
--  usage_events above tracks the ai_token QUOTA (company-scoped, plan limits).
--  The tables below track billable COST: every AI call records its token split
--  and a frozen dollar cost (rate × tokens at insert time). account_ai_costs is
--  the per-account rollup. Rates live in app.ai_model_pricing and are editable
--  in Studio. (Mirrored in server/sql/migrations/2026-06-23_ai_usage_cost.sql
--  for existing databases - keep the two in sync.)
CREATE TABLE app.ai_model_pricing (
  model         TEXT          PRIMARY KEY,
  input_per_1m  NUMERIC(12,4) NOT NULL DEFAULT 0,   -- $ per 1M input/prompt tokens
  output_per_1m NUMERIC(12,4) NOT NULL DEFAULT 0,   -- $ per 1M output/completion tokens
  currency      TEXT          NOT NULL DEFAULT 'USD',
  updated_date  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
INSERT INTO app.ai_model_pricing (model, input_per_1m, output_per_1m, currency) VALUES
  ('gpt-5.4-mini', 0.15, 0.60, 'USD');

CREATE TABLE app.ai_usage (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID          NOT NULL REFERENCES app.accounts(id)  ON DELETE CASCADE,
  -- kept (not cascaded) so account-level spend history survives workspace deletion
  company_id    UUID          REFERENCES app.companies(id) ON DELETE SET NULL,
  user_id       UUID          REFERENCES app.users(id)     ON DELETE SET NULL,
  feature       TEXT          NOT NULL,   -- analyst | chart_summary | llm | attribute_tag | attribute_group | attribute_suggest
  model         TEXT          NOT NULL,
  input_tokens  INTEGER       NOT NULL DEFAULT 0,
  output_tokens INTEGER       NOT NULL DEFAULT 0,
  total_tokens  INTEGER       NOT NULL DEFAULT 0,
  cost          NUMERIC(14,6) NOT NULL DEFAULT 0,    -- frozen at insert time
  currency      TEXT          NOT NULL DEFAULT 'USD',
  occurred_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  metadata      JSONB         NOT NULL DEFAULT '{}'
);
CREATE INDEX ai_usage_account_idx ON app.ai_usage(account_id, occurred_at DESC);
CREATE INDEX ai_usage_company_idx ON app.ai_usage(company_id, occurred_at DESC);
CREATE INDEX ai_usage_user_idx    ON app.ai_usage(user_id, occurred_at DESC);

CREATE OR REPLACE VIEW app.account_ai_costs AS
  SELECT a.id                                        AS account_id,
         a.name                                      AS account_name,
         a.plan                                      AS plan,
         COALESCE(SUM(u.input_tokens),  0)::bigint   AS input_tokens,
         COALESCE(SUM(u.output_tokens), 0)::bigint   AS output_tokens,
         COALESCE(SUM(u.total_tokens),  0)::bigint   AS total_tokens,
         COALESCE(SUM(u.cost), 0)::numeric(14,6)     AS total_cost,
         COALESCE(MAX(u.currency), 'USD')            AS currency,
         MAX(u.occurred_at)                          AS last_used_at
    FROM app.accounts a
    LEFT JOIN app.ai_usage u ON u.account_id = a.id
   GROUP BY a.id, a.name, a.plan;

-- ── In-app notifications (the bell) ─────────────────────────────────────────
--  One row per (recipient user × workspace × event). Producers fan an event out
--  to the active members of a workspace, respecting each member's per-workspace
--  notification preferences (app.user_preferences.notifications->>type). These
--  are IN-APP ONLY - no email is sent. `type` matches the preference keys:
--    campaign_completed | sync_status | new_leads
--  `dedupe_key` makes idempotent producers possible (scan jobs can re-run safely):
--  a non-null key is unique per (user, type), so ON CONFLICT DO NOTHING skips dupes.
CREATE TABLE app.notifications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id      UUID        NOT NULL REFERENCES app.users(id)     ON DELETE CASCADE,
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL,   -- campaign_completed | sync_status | new_leads
  title        TEXT        NOT NULL,
  body         TEXT        NOT NULL DEFAULT '',
  link         TEXT,                   -- in-app route to open when clicked (e.g. /edm)
  metadata     JSONB       NOT NULL DEFAULT '{}',
  dedupe_key   TEXT,                   -- non-null = idempotency key (unique per user+type)
  is_read      BOOLEAN     NOT NULL DEFAULT false,
  read_at      TIMESTAMPTZ
);
-- Feed query: newest-first per recipient within a workspace.
CREATE INDEX notifications_user_company_idx
  ON app.notifications(user_id, company_id, created_date DESC);
-- Fast unread badge count.
CREATE INDEX notifications_user_unread_idx
  ON app.notifications(user_id, company_id) WHERE is_read = false;
-- Idempotency for re-runnable producers (the new_leads scan).
CREATE UNIQUE INDEX notifications_dedupe_idx
  ON app.notifications(user_id, type, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ── Audit helper ────────────────────────────────────────────────────────────
-- Uniform entry point so every route records actions the same way. The account
-- is derived from the company when not passed explicitly.
CREATE OR REPLACE FUNCTION app.log_audit(
  p_company_id    UUID,
  p_user_id       UUID,
  p_action        TEXT,
  p_resource_type TEXT DEFAULT NULL,
  p_resource_id   TEXT DEFAULT NULL,
  p_changes       JSONB DEFAULT '{}',
  p_metadata      JSONB DEFAULT '{}'
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_account UUID;
  v_id      UUID;
BEGIN
  SELECT account_id INTO v_account FROM app.companies WHERE id = p_company_id;
  INSERT INTO app.audit_log (account_id, company_id, user_id, action, resource_type, resource_id, changes, metadata)
  VALUES (v_account, p_company_id, p_user_id, p_action, p_resource_type, p_resource_id, p_changes, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
