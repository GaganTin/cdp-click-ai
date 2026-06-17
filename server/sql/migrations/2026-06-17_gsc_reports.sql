-- Adds app.company_report_config.gsc_reports, which lib/pg_config + the GSC DAG
-- expect but databases built before it lack (causing
-- "column crc.gsc_reports does not exist" in every GA report DAG's get_config).
-- Matches the canonical default in server/sql/03_app_core.sql. Idempotent.
ALTER TABLE app.company_report_config
  ADD COLUMN IF NOT EXISTS gsc_reports JSONB NOT NULL DEFAULT '{
    "keyword_performance": {"isDebugging":false,"debugStartDate":"2025-07-30"}
  }';
