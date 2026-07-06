-- ============================================================================
--  2026-07-06_demo_workspace.sql
--  Adds the shared, read-only "demo" workspace flag to app.companies.
--
--  There is at most ONE demo workspace across the whole platform. It is injected
--  into every user's workspace list by /auth/me (no company_members row needed),
--  is read-only except for the AI analyst chat, and is created / reseeded /
--  deleted only by a platform admin via Studio. The actual demo company + its
--  mock data are provisioned by scripts/seed_demo.cjs (also invoked from the
--  Studio admin endpoints), NOT by this migration.
--  Idempotent: safe to run on a fresh or existing database.
-- ============================================================================

ALTER TABLE app.companies
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- At most one demo workspace platform-wide.
CREATE UNIQUE INDEX IF NOT EXISTS companies_single_demo_idx
  ON app.companies((is_demo)) WHERE is_demo;

-- Per-account opt-in for the demo workspace. Defaults true so the demo stays
-- available to everyone unless a platform admin removes it from an account
-- (Studio account panel). Gates both /auth/me injection and access.
ALTER TABLE app.accounts
  ADD COLUMN IF NOT EXISTS demo_enabled BOOLEAN NOT NULL DEFAULT true;
