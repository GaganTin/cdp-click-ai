-- ============================================================================
--  2026-07-02_resize_plan_allowances.sql
--  Resize the monthly AI token allowances after the gpt-5.4-mini rate correction
--  (see 2026-07-02_fix_gpt54mini_pricing.sql). At the corrected ~$1.50/1M blended
--  rate the old allowances were unprofitable (Standard ~75% of revenue), so:
--
--    Lite:     20M tokens (200 credits) -> 10M tokens (100 credits)
--    Standard: 100M tokens (1,000 cr)   -> 30M tokens (300 credits)
--    Pro:      unchanged (custom / unlimited)
--
--  Updates both the numeric limit (limits.ai_tokens) and the human "credits /
--  month" feature label. Existing accounts pick this up automatically because the
--  quota is resolved from the plan's current limit each period.
--
--  Idempotent AND non-clobbering: apply_migrations.cjs re-runs every file on every
--  deploy, so each UPDATE is GUARDED to the original allowance (20M / 100M). Once
--  resized - or once an admin edits the plan in Studio - the guard is false and
--  this migration is a no-op, so Studio plan edits are preserved.
--  Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- Lite -> 10,000,000 tokens (100 credits). Only touch the original 20M seed.
UPDATE app.plans
   SET limits   = jsonb_set(limits, '{ai_tokens}', '10000000'::jsonb),
       features = REPLACE(features::text, '200 credits / month', '100 credits / month')::jsonb
 WHERE id = 'lite'
   AND limits->>'ai_tokens' = '20000000';

-- Standard -> 30,000,000 tokens (300 credits). Only touch the original 100M seed.
UPDATE app.plans
   SET limits   = jsonb_set(limits, '{ai_tokens}', '30000000'::jsonb),
       features = REPLACE(features::text, '1,000 credits / month', '300 credits / month')::jsonb
 WHERE id = 'standard'
   AND limits->>'ai_tokens' = '100000000';

COMMIT;
