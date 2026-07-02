-- 2026-07-02  Hard-enforce the per-account AI token limit.
-- ---------------------------------------------------------------------------
-- Plans advertise a monthly AI allowance (e.g. Lite 20,000,000 tokens = 200
-- credits / month). Until now that limit was tracked but never enforced. This
-- adds the single source of truth used by the app to block further AI spend
-- once the CURRENT CALENDAR MONTH's usage reaches the limit.
--
--   app.ai_quota(account_id) -> (used, token_limit, is_over)
--     used        = tokens spent this calendar month (app.ai_usage is account-
--                   scoped and survives workspace deletion, matching the billing
--                   "overall" totals).
--     token_limit = the account's effective ai_tokens limit: a per-account
--                   settings override wins over the plan catalog; NULL = unlimited
--                   (Pro / contact-sales), which is never over.
--     is_over      = TRUE only when a finite limit is set AND used >= limit.
--
-- Applies to EVERY account (existing and new) automatically: it reads live plan
-- limits, so no backfill is needed. Idempotent.
--   Run with: psql "$DATABASE_URL" -f <file>

CREATE OR REPLACE FUNCTION app.ai_quota(p_account_id UUID)
RETURNS TABLE(used BIGINT, token_limit BIGINT, is_over BOOLEAN)
LANGUAGE sql STABLE AS $$
  WITH lim AS (
    SELECT COALESCE(
             NULLIF(a.settings->'limit_overrides'->>'ai_tokens', '')::BIGINT,
             NULLIF(p.limits->>'ai_tokens', '')::BIGINT
           ) AS token_limit
      FROM app.accounts a
      JOIN app.plans    p ON p.id = a.plan
     WHERE a.id = p_account_id
  ),
  u AS (
    SELECT COALESCE(SUM(total_tokens), 0)::BIGINT AS used
      FROM app.ai_usage
     WHERE account_id  = p_account_id
       AND occurred_at >= date_trunc('month', now())
  )
  SELECT u.used,
         lim.token_limit,
         (lim.token_limit IS NOT NULL AND u.used >= lim.token_limit) AS is_over
    FROM u CROSS JOIN lim;
$$;

COMMENT ON FUNCTION app.ai_quota(UUID) IS
  'Per-account monthly AI token quota: returns (used this calendar month, effective token limit, is_over). NULL limit = unlimited.';
