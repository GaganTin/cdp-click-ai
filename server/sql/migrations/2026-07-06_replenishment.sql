-- ============================================================================
--  2026-07-06_replenishment.sql  -  Product replenishment predictions, for
--  EXISTING databases (idempotent). Fresh installs get these from
--  14_commerce.sql + 12_profiles_identity.sql.
--
--  Adds:
--    * commerce.customer_replenishment  - per-(customer, product) reorder
--      prediction detail (median inter-purchase cadence). Owned by the
--      click_cdp_ai_build_product_predictions DAG; commerce_landing never
--      touches it.
--    * app.customer_profiles.replenishment_*  - per-customer rollup cache the
--      Segments predicate builder and rule engine read (like the ga_*/order_*
--      caches). Source of truth is the detail table above.
-- ============================================================================

CREATE TABLE IF NOT EXISTS commerce.customer_replenishment (
  company_id          UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  customer_id         TEXT  NOT NULL,
  product_id          TEXT,
  product_name        TEXT,
  product_type        TEXT,
  last_order_date     TIMESTAMPTZ,
  cycle_days          NUMERIC,
  cycle_spread        NUMERIC,
  predicted_next_date DATE,
  days_until          INT,
  status              TEXT,
  confidence          TEXT,
  purchase_count      INT,
  is_cohort_estimate  BOOLEAN DEFAULT false,
  computed_at         TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (company_id, customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS commerce_replen_company_cust_idx  ON commerce.customer_replenishment (company_id, customer_id);
CREATE INDEX IF NOT EXISTS commerce_replen_status_idx        ON commerce.customer_replenishment (company_id, status);
CREATE INDEX IF NOT EXISTS commerce_replen_customer_only_idx ON commerce.customer_replenishment (customer_id);

-- (idempotent add in case an earlier build of this table pre-dates cycle_spread)
ALTER TABLE commerce.customer_replenishment ADD COLUMN IF NOT EXISTS cycle_spread NUMERIC;

ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS replenishment_due_count INTEGER;
ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS next_replenishment_date DATE;
ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS days_to_replenishment   INTEGER;
ALTER TABLE app.customer_profiles ADD COLUMN IF NOT EXISTS replenishment_status    TEXT;
