-- ============================================================================
--  06_attributes.sql - custom targeting dimensions (the /attributes page)
--  Three sources attach a value to a profile:
--    web_content : AI tags each crawled page; visitors inherit tags from pages
--                  they viewed (propagates to anonymous visitors too)
--    rule        : a condition over profile fields (reuses segment criteria)
--    manual      : value assigned by hand / CSV (see also manual.* schema)
--  app.profile_attribute_values is the single source of truth for segmentation.
--  The JSONB caches on customer_profiles are display-only.
-- ============================================================================

-- ── Attribute definitions ───────────────────────────────────────────────────
CREATE TABLE app.attributes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id      UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_by      UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  name            TEXT        NOT NULL DEFAULT '',
  description     TEXT        NOT NULL DEFAULT '',      -- doubles as the AI instruction
  source          TEXT        NOT NULL DEFAULT 'web_content', -- web_content | rule | manual
  value_type      TEXT        NOT NULL DEFAULT 'multi',       -- single | multi
  status          TEXT        NOT NULL DEFAULT 'draft',       -- draft | active | archived
  scope           TEXT        NOT NULL DEFAULT 'both',        -- customer | anonymous | both
  extract_from    TEXT        NOT NULL DEFAULT 'both',        -- title | content | both
  group_label     TEXT,                                       -- optional grouping dimension
  content_applied BOOLEAN     NOT NULL DEFAULT false,         -- true once tags have been applied to content → locks extract_from/value_type
  rule            JSONB       NOT NULL DEFAULT '{}',          -- for source='rule'
  last_run_date   TIMESTAMPTZ,
  last_run_status TEXT,                                       -- success | failed | running
  metadata        JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX attributes_company_idx ON app.attributes(company_id, source);
-- Attribute names are unique within a workspace (case-insensitive).
CREATE UNIQUE INDEX attributes_company_lower_name_idx ON app.attributes(company_id, lower(name));
CREATE TRIGGER attributes_updated_date BEFORE UPDATE ON app.attributes
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Attribute values (curated + AI-discovered exceptions) ───────────────────
CREATE TABLE app.attribute_values (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  attribute_id  UUID        NOT NULL REFERENCES app.attributes(id) ON DELETE CASCADE,
  value         TEXT        NOT NULL,
  display_label TEXT,
  group_name    TEXT,                                  -- group under attribute.group_label
  is_exception  BOOLEAN     NOT NULL DEFAULT false,    -- AI-discovered, pending review
  is_approved   BOOLEAN     NOT NULL DEFAULT false,    -- curated/approved → used for targeting
  is_blocked    BOOLEAN     NOT NULL DEFAULT false,    -- stoplist: never resurrect/propagate
  merged_into   UUID        REFERENCES app.attribute_values(id) ON DELETE SET NULL,
  page_count    INTEGER     NOT NULL DEFAULT 0,
  profile_count INTEGER     NOT NULL DEFAULT 0,
  metadata      JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX attribute_values_unique_idx ON app.attribute_values(attribute_id, LOWER(value));
CREATE TRIGGER attribute_values_updated_date BEFORE UPDATE ON app.attribute_values
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Crawled web pages (behavioral source) ───────────────────────────────────
CREATE TABLE app.web_pages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  url             TEXT        NOT NULL,
  title           TEXT,
  content_hash    TEXT,
  excerpt         TEXT,
  content         TEXT,
  word_count      INTEGER     NOT NULL DEFAULT 0,
  is_valid        BOOLEAN     NOT NULL DEFAULT true,      -- overall validity = valid_content AND valid_title
  is_valid_content BOOLEAN    NOT NULL DEFAULT true,      -- body length ≥ min & no error strings
  is_valid_title  BOOLEAN     NOT NULL DEFAULT true,      -- title ≥ valid_title_min_length (default 1) & no error strings
  is_excluded     BOOLEAN     NOT NULL DEFAULT false,     -- "Excluded Pages"
  excluded_type   TEXT,                                   -- exact | pattern (how it was excluded)
  excluded_value  TEXT,                                   -- the URL or pattern that excluded it
  is_manual       BOOLEAN     NOT NULL DEFAULT false,     -- manually added vs crawler-discovered
  needs_retag     BOOLEAN     NOT NULL DEFAULT false,     -- content changed/new → tag phase should re-tag
  fetch_method    TEXT,                                   -- http | browser
  og_updated_time TIMESTAMPTZ,                            -- og:updated_time meta → skip re-scrape when unchanged
  last_crawled    TIMESTAMPTZ,
  last_reviewed_date TIMESTAMPTZ,                         -- when a user last reviewed this page's tags
  metadata        JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX web_pages_company_url_idx ON app.web_pages(company_id, url);
CREATE INDEX web_pages_retag_idx ON app.web_pages(company_id) WHERE needs_retag;
CREATE TRIGGER web_pages_updated_date BEFORE UPDATE ON app.web_pages
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Managed test links (dry-run sample set for the Test tab) ─────────────────
-- Up to 50 GA-extracted (last 30 days, valid only) and/or up to 50 manual URLs.
-- Users tick a subset to dry-run an attribute against without persisting.
CREATE TABLE app.web_content_test_links (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  url          TEXT        NOT NULL,
  title        TEXT,
  source       TEXT        NOT NULL DEFAULT 'manual',  -- ga | manual
  is_selected  BOOLEAN     NOT NULL DEFAULT true,      -- included in the next dry-run
  hits         INTEGER     NOT NULL DEFAULT 0,         -- GA pageviews (for ordering)
  metadata     JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX web_content_test_links_company_url_idx ON app.web_content_test_links(company_id, url);
CREATE TRIGGER web_content_test_links_updated_date BEFORE UPDATE ON app.web_content_test_links
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Page-rank rollup (precomputed top pages by GA traffic) ───────────────────
-- The expensive GROUP BY over the event-level ga_landing.path_exploration is run
-- ONCE per day (nightly cron) or on explicit rebuild, and cached here. Test-link
-- refresh + the daily sync then read this table cheaply (ORDER BY hits LIMIT 50)
-- instead of re-aggregating millions of pageview rows on every click.
CREATE TABLE app.web_content_page_rank (
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  url          TEXT        NOT NULL,
  hits         INTEGER     NOT NULL DEFAULT 0,   -- pageviews in the window
  window_days  INTEGER     NOT NULL DEFAULT 30,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, url)
);
CREATE INDEX web_content_page_rank_rank_idx ON app.web_content_page_rank(company_id, hits DESC);

-- ── Page → value tags ───────────────────────────────────────────────────────
CREATE TABLE app.page_attribute_values (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id         UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  page_id            UUID        NOT NULL REFERENCES app.web_pages(id) ON DELETE CASCADE,
  attribute_id       UUID        NOT NULL REFERENCES app.attributes(id) ON DELETE CASCADE,
  attribute_value_id UUID        NOT NULL REFERENCES app.attribute_values(id) ON DELETE CASCADE,
  confidence         REAL
);
CREATE UNIQUE INDEX page_attr_value_unique_idx ON app.page_attribute_values(page_id, attribute_value_id);
CREATE INDEX page_attr_value_attr_idx ON app.page_attribute_values(attribute_id);

-- ── Profile → value tags (THE segmentation source of truth) ─────────────────
-- entity_id points at app.customer_profiles.member_id (entity_type='customer')
-- or app.anonymous_profiles.visitor_id (entity_type='anonymous'), same company.
CREATE TABLE app.profile_attribute_values (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id         UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  entity_type        TEXT        NOT NULL CHECK (entity_type IN ('customer','anonymous')),
  entity_id          TEXT        NOT NULL,
  attribute_id       UUID        NOT NULL REFERENCES app.attributes(id) ON DELETE CASCADE,
  attribute_value_id UUID        NOT NULL REFERENCES app.attribute_values(id) ON DELETE CASCADE,
  source             TEXT        NOT NULL DEFAULT 'web_content', -- web_content | rule | manual
  score              INTEGER     NOT NULL DEFAULT 1,   -- e.g. # supporting pageviews
  first_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX profile_attr_value_unique_idx
  ON app.profile_attribute_values(company_id, entity_type, entity_id, attribute_value_id);
CREATE INDEX profile_attr_value_attr_idx
  ON app.profile_attribute_values(company_id, attribute_id, attribute_value_id);
CREATE INDEX profile_attr_value_entity_idx
  ON app.profile_attribute_values(company_id, entity_type, entity_id);
CREATE TRIGGER profile_attribute_values_updated_date BEFORE UPDATE ON app.profile_attribute_values
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Attribute reconstruct jobs (persisted queue) ────────────────────────────
CREATE TABLE app.attribute_jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  attribute_id  UUID        REFERENCES app.attributes(id) ON DELETE CASCADE,  -- null = all behavioral attrs
  job_type      TEXT        NOT NULL DEFAULT 'behavioral',  -- behavioral (refresh+tag) | refresh (scrape only) | tag (tag only) | retag_attribute (scoped) | rule
  status        TEXT        NOT NULL DEFAULT 'queued',      -- queued | running | completed | failed | cancelled
  phase         TEXT,                                       -- discovering | scraping | tagging | propagating | done
  progress      JSONB       NOT NULL DEFAULT '{}',
  triggered_by  UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  error_message TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX attribute_jobs_company_idx ON app.attribute_jobs(company_id, created_date DESC);
CREATE INDEX attribute_jobs_queued_idx  ON app.attribute_jobs(status, created_date) WHERE status IN ('queued','running');
CREATE TRIGGER attribute_jobs_updated_date BEFORE UPDATE ON app.attribute_jobs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();
