-- ============================================================================
-- 2026-06-30_lite_standard_pro_plans.sql
-- Replace the { free, paid } plan model with { lite, standard, pro }.
--
--   Lite     ($100/mo, 3-month trial) - entry tier  (was 'free')
--   Standard ($199/mo)               - growth tier   (was 'paid')
--   Pro      (contact sales)         - custom tier   (new)
--
-- Account remap: free -> lite (trial preserved), paid -> standard.
--
-- The trial / read-only state is now driven purely by plan_expires_at (a non-NULL
-- value means "in trial"), so it is tier-agnostic: Lite carries a 3-month trial,
-- Standard/Pro never do. There is still no in-app payment flow - the paid upgrade
-- is applied out-of-band by sales (set plan + clear plan_expires_at).
--
-- Idempotent migration for EXISTING databases. New databases get this state
-- directly from 02_accounts_auth.sql. Safe to run more than once.
-- Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- 1. Upsert the three new plans (copy/limits refreshed on re-run). Limits:
--    team_members=null => unlimited; ai_tokens are a generous monthly token
--    budget (gpt-5-mini @ $0.28/$2.20 per 1M; at a ~80/20 input/output mix that
--    is roughly Lite 10M ~$7, Standard 30M ~$20 - actual cost tracks real usage).
INSERT INTO app.plans
  (id, name, price_display, period, badge, description, cta_label, cta_href, cta_external,
   is_highlighted, sort_order, trial_days, warning_days, features, limits, is_active)
VALUES
  ('lite', 'Lite', '$100', '/month', NULL,
   'Everything you need to get started with AI-powered customer data.',
   'Start 3-month free trial', '/register', false, false, 1, 90, 7,
   '["Unlimited team members","2 workspaces","Up to 10,000 customer profiles","AI Analyst","Intelligent Segmentation","UTM tracking","AI Content & Traffic Analysis","Dynamic Pop-up","100 credits / month"]'::jsonb,
   '{"profiles":10000,"campaigns":5,"ai_tokens":10000000,"team_members":null,"workspaces":2}'::jsonb,
   true),
  ('standard', 'Standard', '$199', '/month', 'Most popular',
   'For growing teams that need more scale and unlimited campaigns.',
   'Get started', '/register', false, true, 2, NULL, 7,
   '["Unlimited team members","5 workspaces","Up to 50,000 customer profiles","AI Analyst","Intelligent Segmentation","UTM tracking","AI Content & Traffic Analysis","Dynamic Pop-up","Unlimited email campaigns","300 credits / month"]'::jsonb,
   '{"profiles":50000,"campaigns":null,"ai_tokens":30000000,"team_members":null,"workspaces":5}'::jsonb,
   true),
  ('pro', 'Pro', 'Contact sales', '', NULL,
   'For high-volume teams. Custom profile and AI limits, tailored to you.',
   'Contact sales', 'mailto:support@clickcdp.com?subject=Upgrade to Pro', true, false, 3, NULL, 7,
   '["Unlimited team members","5+ workspaces","Custom customer profile volume","AI Analyst","Intelligent Segmentation","UTM tracking","AI Content & Traffic Analysis","Dynamic Pop-up","Unlimited email campaigns","Custom credits","Priority support"]'::jsonb,
   '{"profiles":null,"campaigns":null,"ai_tokens":null,"team_members":null,"workspaces":null}'::jsonb,
   true)
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name, price_display=EXCLUDED.price_display, period=EXCLUDED.period,
  badge=EXCLUDED.badge, description=EXCLUDED.description, cta_label=EXCLUDED.cta_label,
  cta_href=EXCLUDED.cta_href, cta_external=EXCLUDED.cta_external,
  is_highlighted=EXCLUDED.is_highlighted, sort_order=EXCLUDED.sort_order,
  trial_days=EXCLUDED.trial_days, warning_days=EXCLUDED.warning_days,
  features=EXCLUDED.features, limits=EXCLUDED.limits, is_active=EXCLUDED.is_active;

-- 2. Remap existing accounts/workspaces onto the new tiers. plan_expires_at is
--    left untouched, so any in-flight Lite (was free) trial keeps its end date.
UPDATE app.accounts  SET plan = 'lite'     WHERE plan = 'free';
UPDATE app.accounts  SET plan = 'standard' WHERE plan = 'paid';
UPDATE app.companies SET plan = 'lite'     WHERE plan = 'free';
UPDATE app.companies SET plan = 'standard' WHERE plan = 'paid';

-- 3. New signups default to the Lite entry tier.
ALTER TABLE app.accounts ALTER COLUMN plan SET DEFAULT 'lite';

-- 4. Trial/upgrade stamping, made tier-agnostic. An account is "in trial" iff
--    plan_expires_at is set. Converting to paid (sales clears the expiry) stamps
--    plan_upgraded_at; (re)entering a trial clears it.
CREATE OR REPLACE FUNCTION app.stamp_plan_upgraded_at()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.plan_expires_at IS NOT NULL
     AND NEW.plan_expires_at IS NULL THEN
    NEW.plan_upgraded_at := NOW();
  ELSIF NEW.plan_expires_at IS NOT NULL THEN
    NEW.plan_upgraded_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounts_stamp_plan_upgraded ON app.accounts;
CREATE TRIGGER accounts_stamp_plan_upgraded
  BEFORE INSERT OR UPDATE OF plan, plan_expires_at ON app.accounts
  FOR EACH ROW EXECUTE FUNCTION app.stamp_plan_upgraded_at();

-- 5. Retire the obsolete catalog rows (all FKs now point at the new tiers).
DELETE FROM app.plans WHERE id IN ('free', 'paid');

COMMIT;
