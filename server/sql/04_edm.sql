-- ============================================================================
--  04_edm.sql - Email Direct Marketing (Klaviyo-like)
--  templates · campaigns · per-recipient sends · events · suppression ·
--  automations (+ steps + enrollments). All company_id NOT NULL.
--  edm_sends / edm_events carry a denormalised company_id for simple filtering.
-- ============================================================================

-- ── Templates ───────────────────────────────────────────────────────────────
CREATE TABLE app.edm_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  visibility   TEXT        NOT NULL DEFAULT 'private',
  name         TEXT        NOT NULL DEFAULT '',
  subject      TEXT        NOT NULL DEFAULT '',
  preview_text TEXT,
  html_body    TEXT        NOT NULL DEFAULT '',
  text_body    TEXT,
  variables    JSONB       NOT NULL DEFAULT '[]',   -- block/builder metadata
  status       TEXT        NOT NULL DEFAULT 'draft', -- draft | published
  metadata     JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX edm_templates_company_idx ON app.edm_templates(company_id);
CREATE TRIGGER edm_templates_updated_date BEFORE UPDATE ON app.edm_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Campaigns ───────────────────────────────────────────────────────────────
CREATE TABLE app.edm_campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id       UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by       UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  visibility       TEXT        NOT NULL DEFAULT 'private',
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
  status           TEXT        NOT NULL DEFAULT 'draft',  -- draft | scheduled | sending | sent | cancelled | archived
  scheduled_at     TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  total_recipients INTEGER     DEFAULT 0,
  ab_test_config   JSONB       NOT NULL DEFAULT '{}',
  metadata         JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX edm_campaigns_company_idx ON app.edm_campaigns(company_id);
CREATE TRIGGER edm_campaigns_updated_date BEFORE UPDATE ON app.edm_campaigns
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Per-recipient send records ──────────────────────────────────────────────
CREATE TABLE app.edm_sends (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  edm_campaign_id UUID        NOT NULL REFERENCES app.edm_campaigns(id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,
  member_id       TEXT,                              -- → app.customer_profiles.member_id (same company)
  status          TEXT        NOT NULL DEFAULT 'queued',  -- queued | sent | delivered | bounced | failed
  sent_at         TIMESTAMPTZ,
  error_message   TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX edm_sends_company_idx  ON app.edm_sends(company_id);
CREATE INDEX edm_sends_campaign_idx ON app.edm_sends(edm_campaign_id);
CREATE INDEX edm_sends_email_idx    ON app.edm_sends(email);

-- ── Events (opens, clicks, bounces, unsubscribes) ───────────────────────────
CREATE TABLE app.edm_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id      UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  edm_campaign_id UUID        REFERENCES app.edm_campaigns(id) ON DELETE SET NULL,
  send_id         UUID        REFERENCES app.edm_sends(id) ON DELETE SET NULL,
  email           TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,   -- open | click | bounce | complaint | unsubscribe | delivered
  link_url        TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX edm_events_company_idx  ON app.edm_events(company_id);
CREATE INDEX edm_events_campaign_idx ON app.edm_events(edm_campaign_id);
CREATE INDEX edm_events_type_idx     ON app.edm_events(event_type);

-- ── Suppression list (per company do-not-send) ──────────────────────────────
CREATE TABLE app.edm_suppression (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  email      TEXT        NOT NULL,
  reason     TEXT        NOT NULL DEFAULT 'manual',   -- bounced | unsubscribed | complained | manual
  -- manual-upload provenance marker (consistent with the manual.* schema rule)
  is_manual  BOOLEAN     NOT NULL DEFAULT false,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata   JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX edm_suppression_company_email_idx ON app.edm_suppression(company_id, LOWER(email));

-- ── Automations (drip flows) ────────────────────────────────────────────────
CREATE TABLE app.edm_automations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id     UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by     UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  visibility     TEXT        NOT NULL DEFAULT 'private',
  name           TEXT        NOT NULL DEFAULT '',
  trigger_type   TEXT        NOT NULL DEFAULT 'manual',  -- manual | schedule | segment_entry
  trigger_config JSONB       NOT NULL DEFAULT '{}',
  segment_id     UUID        REFERENCES app.segments(id) ON DELETE SET NULL,
  status         TEXT        NOT NULL DEFAULT 'draft',   -- draft | active | paused | archived
  metadata       JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX edm_automations_company_idx ON app.edm_automations(company_id);
CREATE TRIGGER edm_automations_updated_date BEFORE UPDATE ON app.edm_automations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Automation steps ────────────────────────────────────────────────────────
CREATE TABLE app.edm_automation_steps (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  automation_id UUID        NOT NULL REFERENCES app.edm_automations(id) ON DELETE CASCADE,
  created_by    UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  step_order    INTEGER     NOT NULL DEFAULT 0,
  step_type     TEXT        NOT NULL DEFAULT 'send_email',  -- send_email | wait | condition
  step_config   JSONB       NOT NULL DEFAULT '{}',
  next_step_id  UUID,
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX edm_automation_steps_automation_idx ON app.edm_automation_steps(automation_id);

-- ── Automation enrollments ──────────────────────────────────────────────────
CREATE TABLE app.edm_automation_enrollments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  automation_id   UUID        NOT NULL REFERENCES app.edm_automations(id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,
  member_id       TEXT,
  current_step_id UUID        REFERENCES app.edm_automation_steps(id) ON DELETE SET NULL,
  next_run_at     TIMESTAMPTZ,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  status          TEXT        NOT NULL DEFAULT 'active',  -- active | completed | cancelled | failed
  metadata        JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX edm_enrollments_automation_idx ON app.edm_automation_enrollments(automation_id);
CREATE INDEX edm_enrollments_next_run_idx   ON app.edm_automation_enrollments(next_run_at) WHERE status = 'active';
