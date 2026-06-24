-- 2026-06-24_attr_title_min_length.sql
-- Add a configurable minimum TITLE length for content-attribute crawling, mirroring
-- valid_content_min_length. Default 1 (was a hard-coded 5 in code). Idempotent.

ALTER TABLE app.web_content_html_elements
  ADD COLUMN IF NOT EXISTS valid_title_min_length INTEGER NOT NULL DEFAULT 1;
