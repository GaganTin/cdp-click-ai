-- ============================================================================
-- 2026-07-02_extend_lite_trial_to_90.sql
-- Fix short trial windows left over from the free (30-day) -> lite (90-day) move.
--
-- The 2026-06-30 lite/standard/pro migration remapped free -> lite but LEFT
-- plan_expires_at untouched, so accounts that started their trial under the old
-- 30-day "free" plan still expire 30 days after signup, while the app now
-- advertises (and grants new signups) a 90-day Lite trial. Their TrialBanner
-- therefore reads e.g. "22 days left out of the 90-day free trial" for an
-- account that only signed up a few days ago.
--
-- Recompute the trial end from the signup date + the tier's CURRENT trial_days,
-- but only where that EXTENDS the window (the "> current expiry" guard), so we
-- never shorten an account and never touch sales-converted accounts (those have
-- plan_expires_at IS NULL and are skipped).
--
-- Idempotent: on a second run every eligible row already sits at
-- created_date + trial_days, so the guard makes it a no-op.
-- Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

UPDATE app.accounts a
SET plan_expires_at = a.created_date + (p.trial_days || ' days')::interval
FROM app.plans p
WHERE a.plan = p.id
  AND a.plan_expires_at IS NOT NULL                                           -- still in trial (not sales-converted)
  AND p.trial_days IS NOT NULL                                               -- tier actually carries a trial
  AND a.created_date + (p.trial_days || ' days')::interval > a.plan_expires_at; -- extend only, never shorten

COMMIT;
