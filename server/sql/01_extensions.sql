-- ============================================================================
--  01_extensions.sql - extensions, shared schemas, helper functions, triggers
-- ----------------------------------------------------------------------------
--  Loaded first. Everything below is idempotent (safe to re-run).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), digest(), gen_random_bytes()

-- All schemas created up front so later files can reference across schemas
-- regardless of load order.
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS manual;
CREATE SCHEMA IF NOT EXISTS ga_landing;
CREATE SCHEMA IF NOT EXISTS shopify;     -- raw Shopify landing (DAG-written)
CREATE SCHEMA IF NOT EXISTS shopline;    -- raw Shopline landing (DAG-written)
CREATE SCHEMA IF NOT EXISTS odoo;        -- raw Odoo landing (DAG-written)
CREATE SCHEMA IF NOT EXISTS commerce;    -- neutral commerce layer (14_commerce.sql)
CREATE SCHEMA IF NOT EXISTS interaction;

-- ── Auto-update updated_date on every row change ────────────────────────────
CREATE OR REPLACE FUNCTION app.set_updated_date()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_date = NOW();
  RETURN NEW;
END;
$$;

-- ── Stable fingerprint of integration credentials ──────────────────────────
-- Used to enforce "the same credentials can't be connected to two companies in
-- the same account". Caller passes the canonical secret string (e.g. GA
-- propertyId, Shopify "store|token", GSC siteUrl); we store only its hash.
CREATE OR REPLACE FUNCTION app.credential_fingerprint(secret TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN secret IS NULL OR secret = '' THEN NULL
           ELSE encode(digest(lower(trim(secret)), 'sha256'), 'hex')
         END;
$$;

-- ── URL helpers (used by the web-content attributes crawler) ────────────────
-- Percent-decode a URL to readable UTF-8 so encoded/decoded non-ASCII URLs
-- compare equal. Falls back to the input if it isn't valid percent-encoding.
CREATE OR REPLACE FUNCTION app.url_decode(input TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  bytes BYTEA := '\x';
  i INT := 1;
  n INT := length(input);
  ch TEXT;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  WHILE i <= n LOOP
    ch := substr(input, i, 1);
    IF ch = '%' AND i + 2 <= n AND substr(input, i + 1, 2) ~ '^[0-9A-Fa-f]{2}$' THEN
      bytes := bytes || decode(substr(input, i + 1, 2), 'hex');
      i := i + 3;
    ELSE
      bytes := bytes || convert_to(ch, 'UTF8');
      i := i + 1;
    END IF;
  END LOOP;
  RETURN convert_from(bytes, 'UTF8');
EXCEPTION WHEN others THEN
  RETURN input;
END;
$$;

-- Normalise a URL for matching crawled pages against visited page_locations:
-- drop #fragment / ?query / trailing slash, lower-case, strip scheme + leading
-- "www.", and percent-decode (only when a '%' is present).
CREATE OR REPLACE FUNCTION app.norm_url(u TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           rtrim(
             lower(
               CASE WHEN position('%' IN COALESCE(u, '')) > 0
                    THEN app.url_decode(split_part(split_part(u, '#', 1), '?', 1))
                    ELSE split_part(split_part(COALESCE(u, ''), '#', 1), '?', 1)
               END
             ), '/'
           ),
           '^https?://(www\.)?', ''
         );
$$;
