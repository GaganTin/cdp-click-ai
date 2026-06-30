-- ============================================================================
--  backfill_interaction_companies.sql  (one-shot, idempotent)
--  Ensures every existing workspace has an interaction-service company record
--  and that app.companies.interaction_service_company_id points at it.
--  Safe to re-run: dedupes on interaction.companies.cdp_company_id (unique idx).
--  Run once after the unify migration:
--    psql "<conn>" -f server/sql/backfill_interaction_companies.sql
-- ============================================================================

-- 1) Create an interaction-service company row for any workspace missing one.
INSERT INTO interaction.companies (cdp_company_id, name)
SELECT c.id, c.name
FROM app.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM interaction.companies ic WHERE ic.cdp_company_id = c.id
);

-- 2) Point app.companies at the interaction-service company id.
UPDATE app.companies c
SET interaction_service_company_id = ic.id,
    interaction_service_synced_at  = NOW()
FROM interaction.companies ic
WHERE ic.cdp_company_id = c.id
  AND c.interaction_service_company_id IS DISTINCT FROM ic.id;

-- 3) Report: every workspace and its interaction-service Company ID (for plugin setup).
SELECT c.name AS workspace,
       c.id   AS cdp_company_id,
       c.interaction_service_company_id AS plugin_company_id
FROM app.companies c
ORDER BY c.name;
