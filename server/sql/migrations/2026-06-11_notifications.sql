-- ============================================================================
-- In-app notifications (the bell). Adds app.notifications + indexes.
-- Idempotent; safe to run more than once. New DBs get this from
-- 02_accounts_auth.sql. Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS app.notifications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id      UUID        NOT NULL REFERENCES app.users(id)     ON DELETE CASCADE,
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  body         TEXT        NOT NULL DEFAULT '',
  link         TEXT,
  metadata     JSONB       NOT NULL DEFAULT '{}',
  dedupe_key   TEXT,
  is_read      BOOLEAN     NOT NULL DEFAULT false,
  read_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_user_company_idx
  ON app.notifications(user_id, company_id, created_date DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON app.notifications(user_id, company_id) WHERE is_read = false;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON app.notifications(user_id, type, dedupe_key) WHERE dedupe_key IS NOT NULL;

COMMIT;
