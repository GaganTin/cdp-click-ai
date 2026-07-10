-- ============================================================================
-- 2026-07-09_trial_60_days.sql
-- Shorten the Lite trial from 90 days to 60 days.
--
-- trial_days on the Lite plan row is the single source of truth: new signups
-- read it (server/routes/auth.js) and the TrialBanner renders "{trial_days}-day
-- free trial". This changes both the length granted to FUTURE signups AND pulls
-- existing active trials that still sit on the default 90-day window down to 60.
--
-- Idempotent: safe to re-run.
-- Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- 1. New signups + advertised copy: 60-day trial.
UPDATE app.plans
   SET trial_days = 60,
       cta_label  = 'Start 2-month free trial'
 WHERE id = 'lite';

-- 2. Pull active trials off the default 90-day window and onto 60 days from
--    signup. We match ONLY the untouched default (plan_expires_at exactly =
--    created_date + 90 days, as set by signup and the 2026-07-02 extend
--    migration) so we never clobber a trial that sales manually lengthened/
--    shortened, and never touch sales-converted accounts (plan_expires_at NULL).
--    This only moves the date EARLIER (60 < 90). Re-running is a no-op because
--    the row then sits at created_date + 60, no longer matching the guard.
UPDATE app.accounts
   SET plan_expires_at = created_date + INTERVAL '60 days'
 WHERE plan = 'lite'
   AND plan_expires_at IS NOT NULL
   AND plan_expires_at = created_date + INTERVAL '90 days';

COMMIT;
