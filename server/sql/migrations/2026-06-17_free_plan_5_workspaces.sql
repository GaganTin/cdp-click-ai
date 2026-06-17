-- ============================================================================
-- Bump the free plan's workspace allowance from 1 to 5.
--
-- All plans (free and paid) now allow up to 5 workspaces. Paid was already 5.
--
-- Idempotent migration for EXISTING databases. New databases get this state
-- directly from 02_accounts_auth.sql. Safe to run more than once.
-- Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- Raise the enforced limit (server/routes/company.js reads limits.workspaces).
UPDATE app.plans
   SET limits = jsonb_set(limits, '{workspaces}', '5'::jsonb)
 WHERE id = 'free';

-- Keep the marketing feature list in sync ("1 workspace" -> "5 workspaces").
UPDATE app.plans
   SET features = (
         SELECT jsonb_agg(
           CASE WHEN elem = '"1 workspace"'::jsonb THEN '"5 workspaces"'::jsonb ELSE elem END
         )
         FROM jsonb_array_elements(features) AS elem
       )
 WHERE id = 'free'
   AND features @> '["1 workspace"]'::jsonb;

COMMIT;
