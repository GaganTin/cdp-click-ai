-- ============================================================================
--  2026-06-23_ai_usage_cost.sql
--  AI token usage + cost tracking, per user / per workspace(company) / per
--  account. Idempotent (safe on existing AND fresh databases).
--
--    app.ai_model_pricing  - editable $/1M-token rates per model (Studio-managed)
--    app.ai_usage          - one row per AI call: tokens + frozen cost, attributed
--                            to account_id (always), company_id + user_id (when known)
--    app.account_ai_costs  - rollup VIEW: total tokens + cost per account
--
--  Cost is computed and STORED at insert time so historical spend never shifts
--  when the pricing table is later edited. company_id is ON DELETE SET NULL so an
--  account's lifetime AI spend survives a workspace deletion.
-- ============================================================================

-- ── Editable model pricing (rates are USD per 1,000,000 tokens) ─────────────
CREATE TABLE IF NOT EXISTS app.ai_model_pricing (
  model         TEXT          PRIMARY KEY,
  input_per_1m  NUMERIC(12,4) NOT NULL DEFAULT 0,   -- $ per 1M input/prompt tokens
  output_per_1m NUMERIC(12,4) NOT NULL DEFAULT 0,   -- $ per 1M output/completion tokens
  currency      TEXT          NOT NULL DEFAULT 'USD',
  updated_date  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Seed the deployment in use. Editable later in Studio; ON CONFLICT keeps any
-- admin-edited rate on re-run.
INSERT INTO app.ai_model_pricing (model, input_per_1m, output_per_1m, currency) VALUES
  ('gpt-5.4-mini', 0.15, 0.60, 'USD')
ON CONFLICT (model) DO NOTHING;

-- ── AI usage ledger (per call) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.ai_usage (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID          NOT NULL REFERENCES app.accounts(id)  ON DELETE CASCADE,
  -- kept (not cascaded) so account-level spend history survives workspace deletion
  company_id    UUID          REFERENCES app.companies(id) ON DELETE SET NULL,
  user_id       UUID          REFERENCES app.users(id)     ON DELETE SET NULL,
  feature       TEXT          NOT NULL,   -- analyst | chart_summary | llm | attribute_tag | attribute_group | attribute_suggest
  model         TEXT          NOT NULL,
  input_tokens  INTEGER       NOT NULL DEFAULT 0,
  output_tokens INTEGER       NOT NULL DEFAULT 0,
  total_tokens  INTEGER       NOT NULL DEFAULT 0,
  cost          NUMERIC(14,6) NOT NULL DEFAULT 0,    -- frozen at insert time
  currency      TEXT          NOT NULL DEFAULT 'USD',
  occurred_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  metadata      JSONB         NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ai_usage_account_idx ON app.ai_usage(account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_company_idx ON app.ai_usage(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_user_idx    ON app.ai_usage(user_id, occurred_at DESC);

-- ── Per-account rollup (the "cost of AI used per account" table) ────────────
CREATE OR REPLACE VIEW app.account_ai_costs AS
  SELECT a.id                                        AS account_id,
         a.name                                      AS account_name,
         a.plan                                      AS plan,
         COALESCE(SUM(u.input_tokens),  0)::bigint   AS input_tokens,
         COALESCE(SUM(u.output_tokens), 0)::bigint   AS output_tokens,
         COALESCE(SUM(u.total_tokens),  0)::bigint   AS total_tokens,
         COALESCE(SUM(u.cost), 0)::numeric(14,6)     AS total_cost,
         COALESCE(MAX(u.currency), 'USD')            AS currency,
         MAX(u.occurred_at)                          AS last_used_at
    FROM app.accounts a
    LEFT JOIN app.ai_usage u ON u.account_id = a.id
   GROUP BY a.id, a.name, a.plan;
