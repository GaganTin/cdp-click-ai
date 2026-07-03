-- ============================================================================
-- 2026-07-03_attribute_multigroup.sql
-- Multi-dimension attribute grouping.
--
-- Old model: ONE grouping dimension per attribute
--   app.attributes.group_label        (e.g. 'Continent')
--   app.attribute_values.group_name   (e.g. 'Asia')
--
-- New model: MANY dimensions per attribute (e.g. Country grouped by BOTH
-- Continent and GDP at once). Within each dimension a value has exactly one group.
--   app.attributes.group_dimensions   JSONB array  e.g. ["Continent","GDP"]
--   app.attribute_values.group_map     JSONB object e.g. {"Continent":"Asia","GDP":"High"}
--
-- The legacy group_label/group_name columns are KEPT (dead after backfill) so this
-- migration is non-destructive; a later cleanup can drop them.
--
-- Idempotent. New databases get these columns from 06_attributes.sql directly.
-- Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

ALTER TABLE app.attributes
  ADD COLUMN IF NOT EXISTS group_dimensions JSONB NOT NULL DEFAULT '[]';

ALTER TABLE app.attribute_values
  ADD COLUMN IF NOT EXISTS group_map JSONB NOT NULL DEFAULT '{}';

-- Backfill: existing single dimension → one-element dimensions array.
UPDATE app.attributes
SET group_dimensions = to_jsonb(ARRAY[group_label])
WHERE group_label IS NOT NULL AND btrim(group_label) <> ''
  AND (group_dimensions = '[]'::jsonb OR group_dimensions IS NULL);

-- Backfill: existing group_name → {group_label: group_name} on each value.
UPDATE app.attribute_values v
SET group_map = jsonb_build_object(a.group_label, v.group_name)
FROM app.attributes a
WHERE v.attribute_id = a.id
  AND a.group_label IS NOT NULL AND btrim(a.group_label) <> ''
  AND v.group_name IS NOT NULL AND btrim(v.group_name) <> ''
  AND (v.group_map = '{}'::jsonb OR v.group_map IS NULL);

COMMIT;
