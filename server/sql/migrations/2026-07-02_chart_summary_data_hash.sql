-- Adds app.chart_summaries.data_hash so cached AI chart explanations become
-- data-aware: the server fingerprints the chart data (title + type + preview) it
-- generated a summary from, and regenerates when that fingerprint changes instead
-- of serving a stale explanation forever. Existing rows get NULL, which never
-- matches a fingerprint and so forces a one-time regeneration on next view.
-- Matches server/sql/03_app_core.sql. Idempotent.
ALTER TABLE app.chart_summaries
  ADD COLUMN IF NOT EXISTS data_hash TEXT;
