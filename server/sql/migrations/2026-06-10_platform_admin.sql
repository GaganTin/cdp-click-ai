-- ============================================================================
--  2026-06-10_platform_admin.sql
--  Adds the platform-owner ("Studio") layer: a single boolean flag on
--  app.users that sits ABOVE the per-workspace roles. A platform admin can see
--  and manage every account/client via the /api/admin/* API.
--
--  Idempotent (ADD COLUMN IF NOT EXISTS + guarded index). Safe to re-run.
--  Apply with: POSTGRESQL_CONN=... node scripts/apply_platform_admin.cjs
-- ============================================================================
BEGIN;

ALTER TABLE app.users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Partial index: the studio only ever queries "who are the owners", a tiny set.
CREATE INDEX IF NOT EXISTS users_platform_admin_idx
  ON app.users(is_platform_admin) WHERE is_platform_admin;

-- Seed the founding owner. No-op if that user hasn't signed up yet - in that
-- case re-run this migration (or promote them from the Studio > Owners tab)
-- once the account exists. The DB flag is the single source of truth; there is
-- no env-based bootstrap.
UPDATE app.users
  SET is_platform_admin = true
  WHERE LOWER(email) = 'gaganjot.kaur@capsuite.co';

COMMIT;
