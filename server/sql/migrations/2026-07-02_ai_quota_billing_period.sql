-- 2026-07-02  Count the AI token quota per BILLING PERIOD, not calendar month.
-- ---------------------------------------------------------------------------
-- Supersedes 2026-07-02_ai_quota_enforcement.sql. The quota window is no longer
-- the calendar month (date_trunc('month', now())); it now follows the account's
-- billing anchor so the allowance resets on the SAME DAY each month, and the
-- function also returns the window bounds + trial flag so the UI can explain the
-- period to the user without re-deriving the date math.
--
--   • Paid accounts (plan_expires_at IS NULL): the window resets every billing-
--     period month, anchored to the billing day = the upgrade date
--     (plan_upgraded_at), falling back to the account creation date. period_start
--     is the most recent monthly anniversary of that anchor at or before now, and
--     period_end is one month later (the next reset).
--     e.g. upgraded on the 14th -> resets on the 14th of every month.
--
--   • Trial accounts (plan_expires_at IS NOT NULL, i.e. the Lite 90-day trial):
--     ONE flat allowance for the WHOLE trial, counted from the account start with
--     NO monthly reset. period_end is the trial end (plan_expires_at). With the
--     Lite plan's ai_tokens = 20,000,000 (200 credits) the trial therefore grants
--     200 credits total across all 90 days. When spent, is_over stays TRUE until
--     they buy a plan (which clears plan_expires_at and switches the account onto
--     the paid per-billing-period window above).
--
-- Returns: used, token_limit, is_over (unchanged contract) + period_start,
-- period_end, is_trial. token_limit / override resolution and the
-- "NULL = unlimited" contract are unchanged. Idempotent.
--   Run with: psql "$DATABASE_URL" -f <file>

-- Return type gains columns, so the function must be dropped first (CREATE OR
-- REPLACE cannot change a function's return type). Nothing in SQL depends on it
-- (only the app calls it), so a plain DROP is safe.
DROP FUNCTION IF EXISTS app.ai_quota(UUID);

CREATE FUNCTION app.ai_quota(p_account_id UUID)
RETURNS TABLE(used BIGINT, token_limit BIGINT, is_over BOOLEAN,
              period_start TIMESTAMPTZ, period_end TIMESTAMPTZ, is_trial BOOLEAN)
LANGUAGE sql STABLE AS $$
  WITH acct AS (
    SELECT a.created_date,
           a.plan_expires_at,
           a.plan_upgraded_at,
           COALESCE(
             NULLIF(a.settings->'limit_overrides'->>'ai_tokens', '')::BIGINT,
             NULLIF(p.limits->>'ai_tokens', '')::BIGINT
           ) AS token_limit
      FROM app.accounts a
      JOIN app.plans    p ON p.id = a.plan
     WHERE a.id = p_account_id
  ),
  win AS (
    SELECT
      (acct.plan_expires_at IS NOT NULL) AS is_trial,
      acct.plan_expires_at,
      CASE
        WHEN acct.plan_expires_at IS NOT NULL
          -- In trial: single allowance for the whole trial, no monthly reset.
          THEN acct.created_date
        ELSE
          -- Paid: most recent monthly anniversary of the billing anchor.
          COALESCE(acct.plan_upgraded_at, acct.created_date)
          + make_interval(months =>
              (EXTRACT(YEAR  FROM age(now(), COALESCE(acct.plan_upgraded_at, acct.created_date)))::INT * 12
             + EXTRACT(MONTH FROM age(now(), COALESCE(acct.plan_upgraded_at, acct.created_date)))::INT))
      END AS period_start
      FROM acct
  ),
  win2 AS (
    SELECT is_trial,
           period_start,
           CASE WHEN is_trial THEN plan_expires_at
                ELSE period_start + INTERVAL '1 month' END AS period_end
      FROM win
  ),
  u AS (
    SELECT COALESCE(SUM(total_tokens), 0)::BIGINT AS used
      FROM app.ai_usage, win2
     WHERE account_id  = p_account_id
       AND occurred_at >= win2.period_start
  )
  SELECT u.used,
         acct.token_limit,
         (acct.token_limit IS NOT NULL AND u.used >= acct.token_limit) AS is_over,
         win2.period_start,
         win2.period_end,
         win2.is_trial
    FROM u CROSS JOIN acct CROSS JOIN win2;
$$;

COMMENT ON FUNCTION app.ai_quota(UUID) IS
  'Per-account AI token quota over the current BILLING PERIOD: paid accounts reset on their billing-day anniversary, trial accounts get one flat allowance for the whole trial. Returns (used, token_limit, is_over, period_start, period_end, is_trial). NULL limit = unlimited.';
