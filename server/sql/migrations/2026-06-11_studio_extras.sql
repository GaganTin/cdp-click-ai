-- ============================================================================
--  2026-06-11_studio_extras.sql
--  Studio v2 extras:
--   • app.platform_owner_invites — pending platform-owner grants for emails that
--     haven't signed up yet. On registration the new user is auto-promoted and
--     the invite consumed (see provisionUserWithCompany in routes/auth.js).
--
--  Per-account limit overrides and billing notes are stored in the existing
--  app.accounts.settings JSONB (settings.limit_overrides / settings.billing_notes
--  / settings.payment_reference) — no DDL needed for those.
--
--  Idempotent. Apply with: POSTGRESQL_CONN=... node scripts/apply_studio_extras.cjs
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS app.platform_owner_invites (
  email      TEXT        PRIMARY KEY,                 -- stored lower-cased
  invited_by UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
