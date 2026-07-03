-- ============================================================================
--  2026-07-02_migrate_analyst_to_gpt5mini.sql
--  The AI Analyst deployment is 'gpt-5-mini' (Azure OpenAI Data Zone). It was
--  previously mislabeled 'gpt-5.4-mini' and seeded at the wrong rate ($0.15/$0.60).
--  Correct Data-Zone rates: input $0.28 / cached input $0.03 / output $2.20 per 1M.
--
--  This migration:
--    1. Adds the cached-token columns (idempotent; may run before/after add_*).
--    2. Re-keys any legacy 'gpt-5.4-mini' usage rows onto 'gpt-5-mini'.
--    3. Drops the obsolete 'gpt-5.4-mini' pricing row (add_gpt5mini seeds the new one;
--       a safety-net INSERT here covers the case where that file is absent).
--    4. Recomputes frozen cost on gpt-5-mini rows at the corrected rate.
--
--  Idempotent AND non-clobbering: apply_migrations.cjs re-runs every file on every
--  deploy. The recompute is guarded to the EXACT corrected rate and to rows whose
--  cost actually differs, so a later Studio rate edit is never overwritten and
--  already-frozen history is never rewritten to a new rate.
--  Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- 1. Schema: cached-rate column (pricing) + cached-token counter (usage).
ALTER TABLE app.ai_model_pricing
  ADD COLUMN IF NOT EXISTS cached_input_per_1m NUMERIC(12,4) NOT NULL DEFAULT 0;
ALTER TABLE app.ai_usage
  ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER NOT NULL DEFAULT 0;

-- 2. Re-key legacy analyst usage onto the real deployment name.
UPDATE app.ai_usage SET model = 'gpt-5-mini' WHERE model = 'gpt-5.4-mini';

-- 3. Drop the obsolete pricing row; ensure the correct one exists (non-clobbering).
DELETE FROM app.ai_model_pricing WHERE model = 'gpt-5.4-mini';
INSERT INTO app.ai_model_pricing (model, input_per_1m, cached_input_per_1m, output_per_1m, currency)
VALUES ('gpt-5-mini', 0.28, 0.030, 2.20, 'USD')
ON CONFLICT (model) DO NOTHING;

-- 4. Recompute frozen cost on gpt-5-mini rows (cached prefix billed at the cached rate,
--    the rest of input at the full rate). Legacy rows have cached_input_tokens = 0.
UPDATE app.ai_usage u
   SET cost = ROUND(
                ((u.input_tokens - LEAST(u.cached_input_tokens, u.input_tokens)) / 1000000.0) * p.input_per_1m +
                (LEAST(u.cached_input_tokens, u.input_tokens)                     / 1000000.0) * p.cached_input_per_1m +
                (u.output_tokens                                                  / 1000000.0) * p.output_per_1m
              , 6)
  FROM app.ai_model_pricing p
 WHERE p.model = 'gpt-5-mini' AND u.model = 'gpt-5-mini'
   AND p.input_per_1m = 0.28 AND p.cached_input_per_1m = 0.030 AND p.output_per_1m = 2.20
   AND u.cost IS DISTINCT FROM ROUND(
                ((u.input_tokens - LEAST(u.cached_input_tokens, u.input_tokens)) / 1000000.0) * p.input_per_1m +
                (LEAST(u.cached_input_tokens, u.input_tokens)                     / 1000000.0) * p.cached_input_per_1m +
                (u.output_tokens                                                  / 1000000.0) * p.output_per_1m
              , 6);

COMMIT;
