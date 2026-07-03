-- 2026-07-03_rename_pro_to_enterprise.sql
-- Rename the top tier from 'pro' to 'enterprise' (id + display name), keeping its
-- pricing, features and limits. Idempotent: safe to run repeatedly and a no-op
-- once applied (or on a fresh DB where 02_accounts_auth.sql already seeds
-- 'enterprise').
--
-- Order matters because app.accounts.plan is a FK -> app.plans(id):
--   1. materialise the 'enterprise' plan row (copied from 'pro' if present)
--   2. repoint accounts + the denormalised companies.plan copy off 'pro'
--   3. drop the old 'pro' plan row
BEGIN;

-- 1. Create the 'enterprise' plan from the current 'pro' config (no-op if either
--    'enterprise' already exists or there is no 'pro' row to copy).
INSERT INTO app.plans
  (id, name, price_display, period, badge, description, cta_label, cta_href,
   cta_external, is_highlighted, sort_order, trial_days, warning_days, features, limits, is_active)
SELECT 'enterprise', 'Enterprise', price_display, period, badge, description,
       cta_label,
       REPLACE(cta_href, 'Upgrade to Pro', 'Upgrade to Enterprise'),
       cta_external, is_highlighted, sort_order, trial_days, warning_days, features, limits, is_active
FROM app.plans
WHERE id = 'pro'
ON CONFLICT (id) DO NOTHING;

-- 2. Move any account/workspace still pointing at 'pro' onto 'enterprise'.
UPDATE app.accounts  SET plan = 'enterprise' WHERE plan = 'pro';
UPDATE app.companies SET plan = 'enterprise' WHERE plan = 'pro';

-- 3. Remove the retired 'pro' catalog row (now unreferenced).
DELETE FROM app.plans WHERE id = 'pro';

COMMIT;
