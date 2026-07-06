-- ============================================================================
--  2026-07-02_add_gpt5nano_pricing.sql
--  Register pricing for gpt-5-nano, the cheaper "fast" model now used for every
--  AI feature EXCEPT the AI Analyst (attribute tagging/grouping/suggestions,
--  chart summaries, the /llm integration). Azure OpenAI Global rates:
--    input $0.05 / cached input $0.01 / output $0.40 per 1M tokens.
--
--  Cost tracking is keyed per model, so once this row exists every gpt-5-nano
--  call is costed correctly with no further code changes.
--
--  Idempotent AND non-clobbering: apply_migrations.cjs re-runs every file on every
--  deploy, so this uses ON CONFLICT DO NOTHING - a later Studio rate edit survives.
--  Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- The cached column may not exist yet if this runs before the pricing-fix
-- migration; add it defensively so the INSERT below always has a target.
ALTER TABLE app.ai_model_pricing
  ADD COLUMN IF NOT EXISTS cached_input_per_1m NUMERIC(12,4) NOT NULL DEFAULT 0;

INSERT INTO app.ai_model_pricing (model, input_per_1m, cached_input_per_1m, output_per_1m, currency)
VALUES ('gpt-5-nano', 0.05, 0.010, 0.40, 'USD')
ON CONFLICT (model) DO NOTHING;

COMMIT;
