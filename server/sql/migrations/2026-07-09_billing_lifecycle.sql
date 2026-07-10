-- ============================================================================
-- 2026-07-09_billing_lifecycle.sql
-- Trial / plan lifecycle: reminder emails + end-of-life data purge.
--
-- A daily job (server/lib/billingLifecycle.js) drives every account that still
-- has a plan_expires_at (i.e. "in trial / expiring", not sales-converted) through:
--   trial_ending  -> T-warning_days : "your trial ends soon, upgrade"
--   trial_ended   -> T-0            : "ended; data deleted in 6 months"
--   purge_warning -> T+6mo-1day     : "data deleted tomorrow unless you subscribe"
--   purged        -> T+6mo          : delete ALL data, keep the account+owner shell
--
-- This table is the idempotency ledger: one row per (account, stage, expires_at),
-- so the daily job is safe to re-run and a sales-granted NEW expiry date resets the
-- cycle automatically (a different expires_at is a different dedupe key).
--
-- Idempotent: safe to re-run.
-- Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS app.account_lifecycle_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID        NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  stage       TEXT        NOT NULL,   -- trial_ending | trial_ended | purge_warning | purged
  expires_at  TIMESTAMPTZ NOT NULL,  -- the plan_expires_at this event was keyed to
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata    JSONB       NOT NULL DEFAULT '{}'
);

-- One event per stage per expiry cycle -> the daily job claims a stage with an
-- INSERT ... ON CONFLICT DO NOTHING, so it never emails/purges twice.
CREATE UNIQUE INDEX IF NOT EXISTS account_lifecycle_events_uniq
  ON app.account_lifecycle_events(account_id, stage, expires_at);
CREATE INDEX IF NOT EXISTS account_lifecycle_events_account_idx
  ON app.account_lifecycle_events(account_id, occurred_at DESC);

COMMIT;
