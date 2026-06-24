-- ============================================================================
--  2026-06-24_announcements.sql
--  Platform-wide announcement banners. A platform owner ("Studio") can publish
--  an app-wide banner shown to EVERY user across every account/workspace - e.g.
--  scheduled-maintenance notices, incident updates or product announcements.
--
--  This is distinct from app.notifications (per-user, per-workspace bell feed):
--  announcements are global broadcasts rendered as a top-of-app banner.
--
--  Dismissal is client-side (localStorage keyed by announcement id), matching
--  the existing TrialBanner pattern - no per-user dismissal table needed.
--
--  Idempotent. Picked up automatically by scripts/apply_migrations.cjs.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS app.announcements (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'level' drives the banner's colour/icon in the UI.
  level       TEXT        NOT NULL DEFAULT 'info'
                          CHECK (level IN ('info', 'success', 'warning', 'maintenance')),
  title       TEXT,                                    -- optional bold lead-in
  body        TEXT        NOT NULL,                     -- the message itself
  link_url    TEXT,                                     -- optional call-to-action link
  link_label  TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,        -- master on/off switch
  dismissible BOOLEAN     NOT NULL DEFAULT true,        -- can a user close it?
  starts_at   TIMESTAMPTZ,                              -- NULL = live immediately
  ends_at     TIMESTAMPTZ,                              -- NULL = no auto-expiry
  created_by  UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The user-facing "active now" lookup filters on is_active + the time window.
CREATE INDEX IF NOT EXISTS idx_announcements_active
  ON app.announcements (is_active, starts_at, ends_at);

COMMIT;
