-- ============================================================================
--  2026-07-02_fix_gpt54mini_pricing.sql
--  1. Correct gpt-5.4-mini token rates. The model was seeded at $0.15/$0.60 per
--     1M (input/output), but the real Azure OpenAI Global Standard rates are
--     $0.75 input / $4.50 output per 1M - so recorded AI cost was under-reported
--     by ~5x on input and ~7.5x on output.
--  2. Add cached-input pricing + per-row cached-token tracking. Azure bills the
--     cached prompt prefix at a steep discount (~$0.075/1M for gpt-5.4-mini), so
--     without this the analyst's repeated-context calls are over-costed.
--
--  Because app.ai_usage.cost is FROZEN at insert time, fixing the rate table only
--  affects future calls; this migration also recomputes the frozen cost on every
--  historical row so account_ai_costs reflects true spend. Historical rows have
--  cached_input_tokens = 0 (cached tokens weren't captured before), so their
--  recompute uses the full input rate - which is the correct assumption for them.
--
--  Idempotent AND non-clobbering: apply_migrations.cjs re-runs every file on
--  every deploy, so the rate fix is guarded to only touch the ORIGINAL bad seed
--  ($0.15/$0.60). Once corrected (or once an admin edits the rate in Studio) the
--  guards are false and this migration is a no-op - Studio edits are preserved.
--  Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- 0. Schema: add the cached-rate column and the per-row cached-token counter.
ALTER TABLE app.ai_model_pricing
  ADD COLUMN IF NOT EXISTS cached_input_per_1m NUMERIC(12,4) NOT NULL DEFAULT 0;
ALTER TABLE app.ai_usage
  ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER NOT NULL DEFAULT 0;

-- 1. Correct the editable rates (UPDATE, not INSERT - the row already exists, so
--    the bootstrap's ON CONFLICT DO NOTHING would never touch it). GUARDED to the
--    original bad seed so a later Studio rate edit is never overwritten on deploy.
UPDATE app.ai_model_pricing
   SET input_per_1m        = 0.75,
       cached_input_per_1m = 0.075,
       output_per_1m       = 4.50,
       currency            = 'USD',
       updated_date        = NOW()
 WHERE model = 'gpt-5.4-mini'
   AND input_per_1m = 0.15 AND output_per_1m = 0.60;

-- Seed it if the row is somehow missing (fresh-ish DBs).
INSERT INTO app.ai_model_pricing (model, input_per_1m, cached_input_per_1m, output_per_1m, currency)
  SELECT 'gpt-5.4-mini', 0.75, 0.075, 4.50, 'USD'
  WHERE NOT EXISTS (SELECT 1 FROM app.ai_model_pricing WHERE model = 'gpt-5.4-mini');

-- 2. Recompute frozen cost on historical rows using the corrected rates. The
--    cached prefix (0 on legacy rows) is billed at the cached rate, the rest of
--    input at the full rate. input/output/cached tokens are stored per row.
--    GUARDED to the exact corrected rate: if an admin later changes the rate we
--    must NOT rewrite already-frozen history to the new rate on the next deploy.
UPDATE app.ai_usage u
   SET cost = ROUND(
                ((u.input_tokens - LEAST(u.cached_input_tokens, u.input_tokens)) / 1000000.0) * p.input_per_1m +
                (LEAST(u.cached_input_tokens, u.input_tokens)                     / 1000000.0) * p.cached_input_per_1m +
                (u.output_tokens                                                  / 1000000.0) * p.output_per_1m
              , 6)
  FROM app.ai_model_pricing p
 WHERE p.model = 'gpt-5.4-mini'
   AND u.model = 'gpt-5.4-mini'
   AND p.input_per_1m = 0.75 AND p.cached_input_per_1m = 0.075 AND p.output_per_1m = 4.50
   AND u.cost IS DISTINCT FROM ROUND(
                ((u.input_tokens - LEAST(u.cached_input_tokens, u.input_tokens)) / 1000000.0) * p.input_per_1m +
                (LEAST(u.cached_input_tokens, u.input_tokens)                     / 1000000.0) * p.cached_input_per_1m +
                (u.output_tokens                                                  / 1000000.0) * p.output_per_1m
              , 6);

COMMIT;
