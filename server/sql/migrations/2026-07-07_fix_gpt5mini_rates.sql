-- ============================================================================
--  2026-07-07_fix_gpt5mini_rates.sql
--  Correct the gpt-5-mini (AI Analyst) pricing to the confirmed Azure rates:
--    input $0.25 / cached input $0.03 / output $2.00 per 1M tokens
--  (previously seeded at $0.28 / $0.03 / $2.20).
--
--  Why a separate migration: the earlier add_gpt5mini / migrate_analyst files
--  seed the row with ON CONFLICT DO NOTHING, so on any DB that already has a
--  gpt-5-mini row they are no-ops - they can never lower an existing rate. This
--  file explicitly UPDATEs the live row and recomputes frozen historical cost.
--
--  Idempotent AND non-clobbering:
--    - The rate UPDATE is GUARDED to the exact old rate (0.28 / 2.20), so once
--      corrected - or once an admin edits the rate in Studio - the guard is false
--      and this is a no-op. Studio rate edits are preserved.
--    - The recompute is guarded to the EXACT new rate and to rows whose frozen
--      cost actually differs, so already-correct history is never rewritten.
--  gpt-5-nano rates are unchanged (0.05 / 0.01 / 0.40) and untouched here.
--  Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- 1. Correct the live pricing row (only if still at the old mislabeled rate).
UPDATE app.ai_model_pricing
   SET input_per_1m        = 0.25,
       output_per_1m       = 2.00,
       cached_input_per_1m = 0.030,
       updated_date        = NOW()
 WHERE model = 'gpt-5-mini'
   AND input_per_1m = 0.28 AND output_per_1m = 2.20;

-- Ensure the row exists at all on a fresh DB that somehow skipped the seed.
INSERT INTO app.ai_model_pricing (model, input_per_1m, cached_input_per_1m, output_per_1m, currency)
VALUES ('gpt-5-mini', 0.25, 0.030, 2.00, 'USD')
ON CONFLICT (model) DO NOTHING;

-- 2. Recompute frozen cost on gpt-5-mini usage rows at the corrected rate
--    (cached prefix billed at the cached rate, the rest of input at the full rate).
UPDATE app.ai_usage u
   SET cost = ROUND(
                ((u.input_tokens - LEAST(u.cached_input_tokens, u.input_tokens)) / 1000000.0) * p.input_per_1m +
                (LEAST(u.cached_input_tokens, u.input_tokens)                     / 1000000.0) * p.cached_input_per_1m +
                (u.output_tokens                                                  / 1000000.0) * p.output_per_1m
              , 6)
  FROM app.ai_model_pricing p
 WHERE p.model = 'gpt-5-mini' AND u.model = 'gpt-5-mini'
   AND p.input_per_1m = 0.25 AND p.cached_input_per_1m = 0.030 AND p.output_per_1m = 2.00
   AND u.cost IS DISTINCT FROM ROUND(
                ((u.input_tokens - LEAST(u.cached_input_tokens, u.input_tokens)) / 1000000.0) * p.input_per_1m +
                (LEAST(u.cached_input_tokens, u.input_tokens)                     / 1000000.0) * p.cached_input_per_1m +
                (u.output_tokens                                                  / 1000000.0) * p.output_per_1m
              , 6);

COMMIT;
