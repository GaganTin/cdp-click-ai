-- ============================================================================
-- Billing revamp: collapse plans to { free, paid }, drop invoice history.
--
-- Idempotent migration for EXISTING databases. New databases get this state
-- directly from 02_accounts_auth.sql. Safe to run more than once.
--
--   • plans catalog        : keep 'free', replace 'pro'/'enterprise' with 'paid'
--   • accounts.plan        : remap any 'pro'/'enterprise' rows -> 'paid'
--   • accounts.plan_upgraded_at : new column + backfill + auto-stamp trigger
--   • app.billing_invoices : dropped (no more billing history)
--
-- There is no in-app payment flow; the paid upgrade is applied out-of-band by
-- setting app.accounts.plan = 'paid'. Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- 1. Add the upgrade-date column before we touch plan values (the trigger we
--    create below references it).
ALTER TABLE app.accounts
  ADD COLUMN IF NOT EXISTS plan_upgraded_at TIMESTAMPTZ;

-- 2. Insert the new 'paid' plan (mirrors 02_accounts_auth.sql). ON CONFLICT so a
--    re-run is a no-op; values refreshed in case copy/limits changed.
INSERT INTO app.plans
  (id, name, price_display, period, badge, description, cta_label, cta_href, cta_external,
   is_highlighted, sort_order, trial_days, warning_days, features, limits, is_active)
VALUES
  ('paid', 'Paid', 'Contact sales', '', NULL,
   'For growing teams that need more power and fewer limits. Talk to our team to get set up.',
   'Contact sales', 'mailto:support@clickcdp.com?subject=Upgrade to Paid', true, true, 2, NULL, 7,
   '["Up to 5 team members","5 workspaces","100,000 customer profiles","Unlimited email campaigns","Unlimited AI tokens","Advanced segmentation","Priority support"]'::jsonb,
   '{"profiles":100000,"campaigns":null,"ai_tokens":null,"team_members":5,"workspaces":5}'::jsonb,
   true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, price_display = EXCLUDED.price_display, period = EXCLUDED.period,
  badge = EXCLUDED.badge, description = EXCLUDED.description, cta_label = EXCLUDED.cta_label,
  cta_href = EXCLUDED.cta_href, cta_external = EXCLUDED.cta_external,
  is_highlighted = EXCLUDED.is_highlighted, sort_order = EXCLUDED.sort_order,
  trial_days = EXCLUDED.trial_days, warning_days = EXCLUDED.warning_days,
  features = EXCLUDED.features, limits = EXCLUDED.limits, is_active = EXCLUDED.is_active;

-- 3. Move every account currently on pro/enterprise onto 'paid', backfilling the
--    upgrade date (best-effort: account creation date) and clearing trial expiry.
UPDATE app.accounts
   SET plan             = 'paid',
       plan_upgraded_at = COALESCE(plan_upgraded_at, created_date),
       plan_expires_at  = NULL
 WHERE plan IN ('pro', 'enterprise');

-- 4. Denormalised copy on companies follows suit.
UPDATE app.companies SET plan = 'paid' WHERE plan IN ('pro', 'enterprise');

-- 5. Retire the obsolete catalog rows (FKs now all point at 'free'/'paid').
DELETE FROM app.plans WHERE id IN ('pro', 'enterprise');

-- 6. Auto-stamp trigger so future upgrades record their own date.
CREATE OR REPLACE FUNCTION app.stamp_plan_upgraded_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan = 'paid' AND COALESCE(OLD.plan, '') <> 'paid' THEN
    NEW.plan_upgraded_at := NOW();
    NEW.plan_expires_at  := NULL;
  ELSIF NEW.plan = 'free' AND OLD.plan <> 'free' THEN
    NEW.plan_upgraded_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounts_stamp_plan_upgraded ON app.accounts;
CREATE TRIGGER accounts_stamp_plan_upgraded
  BEFORE INSERT OR UPDATE OF plan ON app.accounts
  FOR EACH ROW EXECUTE FUNCTION app.stamp_plan_upgraded_at();

-- 7. Drop billing history entirely.
DROP TABLE IF EXISTS app.billing_invoices;

COMMIT;
