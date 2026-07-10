-- ============================================================================
-- 2026-07-09_emails_sent_plan_limit.sql
-- Rework the plan email allowance from a campaign count into an "Emails Sent"
-- quota, and cap Standard instead of leaving it unlimited:
--
--   Lite      -> "5 Emails Sent"        (campaigns limit stays 5)
--   Standard  -> "50,000 Emails Sent"   (campaigns limit null -> 50,000)
--   Pro/Ent   -> "Unlimited Emails Sent" (unchanged: null)
--
-- The stored limit key is still `campaigns` (enforced in server/routes/edm.js);
-- only its meaning/label changes to emails sent. Idempotent: safe to re-run.
-- Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- Standard: cap the emails-sent allowance at 50,000 (was unlimited).
UPDATE app.plans
   SET limits      = jsonb_set(limits, '{campaigns}', '50000'::jsonb),
       description = 'For growing teams that need more scale and higher send volume.',
       features    = '["Unlimited team members","5 workspaces","Up to 50,000 customer profiles","AI Analyst","Intelligent Segmentation","UTM tracking","AI Content & Traffic Analysis","Dynamic Pop-up","50,000 Emails Sent","300 credits / month"]'::jsonb
 WHERE id = 'standard';

-- Lite: surface the existing 5-campaign cap as "5 Emails Sent".
UPDATE app.plans
   SET features = '["Unlimited team members","2 workspaces","Up to 10,000 customer profiles","AI Analyst","Intelligent Segmentation","UTM tracking","AI Content & Traffic Analysis","Dynamic Pop-up","5 Emails Sent","100 credits / month"]'::jsonb
 WHERE id = 'lite';

-- Top tier (Pro or Enterprise depending on catalog): keep unlimited, relabel.
UPDATE app.plans
   SET features = '["Unlimited team members","5+ workspaces","Custom customer profile volume","AI Analyst","Intelligent Segmentation","UTM tracking","AI Content & Traffic Analysis","Dynamic Pop-up","Unlimited Emails Sent","Custom credits","Priority support"]'::jsonb
 WHERE id IN ('pro', 'enterprise');

COMMIT;
