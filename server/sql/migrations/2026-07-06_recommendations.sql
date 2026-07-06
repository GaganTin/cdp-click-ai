-- ============================================================================
--  2026-07-06_recommendations.sql  -  Product recommendations (cross-sell), for
--  EXISTING databases (idempotent). Fresh installs get these from
--  14_commerce.sql + 12_profiles_identity.sql. Companion to
--  2026-07-06_replenishment.sql - both are produced by the
--  click_cdp_ai_build_product_predictions DAG.
--
--  Adds:
--    * commerce.customer_product_reco        - per-(customer, recommended
--      product) detail (item-item co-purchase + category fallback). DAG-owned;
--      commerce_landing never touches it.
--    * app.customer_profiles.reco_* / top_recommended_*  - per-customer rollup
--      cache the Segments predicate builder + rule engine read.
-- ============================================================================

CREATE TABLE IF NOT EXISTS commerce.customer_product_reco (
  company_id     UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  customer_id    TEXT  NOT NULL,
  product_id     TEXT  NOT NULL,
  product_name   TEXT,
  product_type   TEXT,
  score          NUMERIC,
  method         TEXT,
  reason         TEXT,
  rank           INT,
  computed_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (company_id, customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS commerce_reco_company_cust_idx  ON commerce.customer_product_reco (company_id, customer_id);
CREATE INDEX IF NOT EXISTS commerce_reco_product_idx       ON commerce.customer_product_reco (company_id, product_id);
CREATE INDEX IF NOT EXISTS commerce_reco_customer_only_idx ON commerce.customer_product_reco (customer_id);

ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS reco_count                 INTEGER;
ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS top_recommended_product_id TEXT;
ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS top_recommended_product    TEXT;
ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS top_recommended_category   TEXT;
