-- ============================================================================
--  2026-07-02_add_gpt5mini_pricing.sql
--  Register pricing for gpt-5-mini, the model the AI Analyst now runs on
--  (AZURE_OPENAI_DEPLOYMENT), replacing gpt-5.4-mini. Azure OpenAI Data Zone rates:
--    input $0.28 / cached input $0.03 / output $2.20 per 1M tokens.
--
--  Cost tracking is keyed per model, so once this row exists every gpt-5-mini
--  call is costed correctly with no further code changes. Without it, analyst
--  spend would be ledgered at $0 (getPricing falls back to zero rates).
--
--  Idempotent AND non-clobbering: apply_migrations.cjs re-runs every file on every
--  deploy, so this uses ON CONFLICT DO NOTHING — a later Studio rate edit survives.
--  Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- The cached column may not exist yet if this runs before the pricing-fix
-- migration; add it defensively so the INSERT below always has a target.
ALTER TABLE app.ai_model_pricing
  ADD COLUMN IF NOT EXISTS cached_input_per_1m NUMERIC(12,4) NOT NULL DEFAULT 0;

INSERT INTO app.ai_model_pricing (model, input_per_1m, cached_input_per_1m, output_per_1m, currency)
VALUES ('gpt-5-mini', 0.28, 0.030, 2.20, 'USD')
ON CONFLICT (model) DO NOTHING;

COMMIT;
