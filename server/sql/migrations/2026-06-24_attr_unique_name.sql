-- 2026-06-24_attr_unique_name.sql
-- Harden the app-level duplicate-name check with a DB constraint: attribute names
-- are unique within a workspace (case-insensitive).
--
-- REQUIRES no existing duplicates. If this CREATE fails, find and resolve them first:
--   SELECT company_id, lower(name) AS n, count(*), array_agg(id)
--   FROM app.attributes GROUP BY company_id, lower(name) HAVING count(*) > 1;
-- then rename/delete the extras and re-run.

CREATE UNIQUE INDEX IF NOT EXISTS attributes_company_lower_name_idx
  ON app.attributes (company_id, lower(name));
