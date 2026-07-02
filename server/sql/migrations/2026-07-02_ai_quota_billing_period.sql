-- 2026-07-02  Count the AI token quota per BILLING PERIOD, not calendar month.
-- ---------------------------------------------------------------------------
-- Supersedes 2026-07-02_ai_quota_enforcement.sql. The quota window is no longer
-- the calendar month (date_trunc('month', now())); it now follows the account's
-- billing anchor so the allowance resets on the SAME DAY each month:
--
--   • Paid accounts (plan_expires_at IS NULL): the window resets every billing-
--     period month, anchored to the billing day = the upgrade date
--     (plan_upgraded_at), falling back to the account creation date. period_start
--     is the most recent monthly anniversary of that anchor at or before now.
--     e.g. upgraded on the 14th -> resets on the 14th of every month.
--
--   • Trial accounts (plan_expires_at IS NOT NULL, i.e. the Lite 90-day trial):
--     ONE flat allowance for the WHOLE trial, counted from the account start with
--     NO monthly reset. With the Lite plan's ai_tokens = 20,000,000 (200 credits)
--     the trial therefore grants 200 credits total across all 90 days. When it is
--     spent, is_over stays TRUE until they buy a plan (which clears plan_expires_at
--     and switches the account onto the paid per-billing-period window above).
--
-- token_limit / override resolution and the "NULL = unlimited" contract are
-- unchanged. Idempotent.  Run with: psql "$DATABASE_URL" -f <file>

CREATE OR REPLACE FUNCTION app.ai_quota(p_account_id UUID)
RETURNS TABLE(used BIGINT, token_limit BIGINT, is_over BOOLEAN)
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
    -- Start of the window the quota is measured over.
    SELECT
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
  u AS (
    SELECT COALESCE(SUM(total_tokens), 0)::BIGINT AS used
      FROM app.ai_usage, win
     WHERE account_id  = p_account_id
       AND occurred_at >= win.period_start
  )
  SELECT u.used,
         acct.token_limit,
         (acct.token_limit IS NOT NULL AND u.used >= acct.token_limit) AS is_over
    FROM u CROSS JOIN acct;
$$;

COMMENT ON FUNCTION app.ai_quota(UUID) IS
  'Per-account AI token quota over the current BILLING PERIOD: paid accounts reset on their billing-day anniversary; trial accounts get one flat allowance for the whole trial. Returns (used this period, effective token limit, is_over). NULL limit = unlimited.';
