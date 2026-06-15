-- ============================================================================
--  07_integrations.sql - data source connections + sync queue + audit
--  Sources: googleAnalytics, googleSearchConsole, shopify, shopifyCustomApp,
--           wordpress, interactionService, manualUpload.
--  Rule: within one ACCOUNT the same credentials cannot be connected to two
--  companies. Enforced by a unique (account_id, integration_type,
--  credential_fingerprint) index. Also one of each type per company.
-- ============================================================================

CREATE TABLE app.data_integrations (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id             UUID        NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  company_id             UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by             UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  integration_type       TEXT        NOT NULL,
  config                 JSONB       NOT NULL DEFAULT '{}',
  -- sha256 of the canonical secret part of config (set via app.credential_fingerprint
  -- in the connect route). Enables the per-account uniqueness rule.
  credential_fingerprint TEXT,
  is_connected           BOOLEAN     NOT NULL DEFAULT false,
  last_connected_date    TIMESTAMPTZ,
  last_tested_date       TIMESTAMPTZ,
  is_connection_error    BOOLEAN     NOT NULL DEFAULT false,
  connection_error       TEXT,
  is_synced              BOOLEAN     NOT NULL DEFAULT false,
  last_synced_date       TIMESTAMPTZ,
  is_sync_error          BOOLEAN     NOT NULL DEFAULT false,
  sync_error             TEXT
);
-- one integration of each type per company
CREATE UNIQUE INDEX data_integrations_company_type_idx
  ON app.data_integrations(company_id, integration_type);
-- the same credentials may not be reused across companies in the same account
CREATE UNIQUE INDEX data_integrations_account_cred_idx
  ON app.data_integrations(account_id, integration_type, credential_fingerprint)
  WHERE credential_fingerprint IS NOT NULL;
CREATE INDEX data_integrations_company_idx ON app.data_integrations(company_id);
CREATE TRIGGER data_integrations_updated_date BEFORE UPDATE ON app.data_integrations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Integration sync jobs (persisted queue; worker claims with SKIP LOCKED) ─
CREATE TABLE app.integration_sync_jobs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id       UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  integration_type TEXT        NOT NULL,
  airflow_run_id   TEXT,
  status           TEXT        NOT NULL DEFAULT 'queued',  -- queued | running | completed | failed | cancelled
  triggered_by     TEXT        NOT NULL DEFAULT 'manual',  -- manual | schedule | health_check
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  records_synced   INTEGER,
  error_message    TEXT,
  metadata         JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX sync_jobs_company_type_idx ON app.integration_sync_jobs(company_id, integration_type, created_date DESC);
CREATE INDEX sync_jobs_queued_idx       ON app.integration_sync_jobs(status, created_date) WHERE status IN ('queued','running');
CREATE TRIGGER integration_sync_jobs_updated_date BEFORE UPDATE ON app.integration_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Integration audit log (immutable history) ───────────────────────────────
CREATE TABLE app.integration_audit_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id       UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  integration_type TEXT        NOT NULL,
  action           TEXT        NOT NULL,  -- connected | disconnected | connection_failed | reconnected | health_passed | health_failed | sync_queued | sync_completed | sync_failed | sync_cancelled
  actor            TEXT,                  -- user id, 'system', or 'airflow'
  detail           TEXT,
  metadata         JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_co_type_idx ON app.integration_audit_log(company_id, integration_type, occurred_at DESC);
