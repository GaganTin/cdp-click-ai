-- ============================================================================
--  14_commerce.sql - NEUTRAL commerce layer (schema: commerce), COMPANY-SCOPED
-- ----------------------------------------------------------------------------
--  The platform-neutral model that combines the per-platform raw schemas
--  (shopify / shopline / odoo - and any future platform, e.g. WooCommerce)
--  into one analysis-friendly shape. Built/refreshed by the
--  click_cdp_ai_commerce_landing DAG (dags/click_cdp_ai/lib/commerce_integration:
--  per client+platform, scoped DELETE + INSERT...SELECT, idempotent).
--
--  THIS is what the app reads for commerce: the profile builder
--  (commerce.customer -> app.customer_profiles), the Profiles page transaction
--  card (commerce."order"/order_line) and the AI analyst (all tables).
--
--  Every row carries company_id (tenant key), capsuite_ref, source_platform
--  ('shopify' | 'shopline' | 'odoo'), source_id (the platform-native id) and
--  source_extra JSONB for platform-specific richness.
--
--  DDL is mirrored by dags/click_cdp_ai/lib/commerce_schema.py (the DAG can
--  bootstrap the tables itself) - keep the two in sync.
-- ============================================================================

CREATE TABLE IF NOT EXISTS commerce.customer (
  customer_id     TEXT  PRIMARY KEY,            -- {ref}_cust_{id} (client-prefixed, globally unique)
  company_id      UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  capsuite_ref    TEXT,
  source_platform TEXT,
  source_id       TEXT,
  customer_no     TEXT,
  join_date       TIMESTAMPTZ,
  last_update     TIMESTAMPTZ,
  customer_type   TEXT,
  is_company      BOOLEAN,
  has_email       BOOLEAN,
  primary_email   TEXT,
  has_phone       BOOLEAN,
  primary_phone   TEXT,
  first_name      TEXT,
  last_name       TEXT,
  full_name       TEXT,
  display_name    TEXT,
  is_opt_in_email BOOLEAN,
  is_opt_in_sms   BOOLEAN,
  tags            TEXT,
  source_extra    JSONB
);

CREATE TABLE IF NOT EXISTS commerce.product (
  product_id      TEXT  PRIMARY KEY,            -- variant grain
  company_id      UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  capsuite_ref    TEXT,
  source_platform TEXT,
  source_id       TEXT,
  product_temp_id TEXT,
  product_sku     TEXT,
  price           NUMERIC,
  category        TEXT,
  product_type    TEXT,
  product_name    TEXT,
  tags            TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  source_extra    JSONB
);

CREATE TABLE IF NOT EXISTS commerce.product_detail (
  company_id       UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  capsuite_ref     TEXT,
  source_platform  TEXT,
  source_id        TEXT,
  product_id       TEXT,
  custom_attribute TEXT,
  custom_value     TEXT,
  source_extra     JSONB
);

CREATE TABLE IF NOT EXISTS commerce.product_image (
  company_id      UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  capsuite_ref    TEXT,
  source_platform TEXT,
  source_id       TEXT,
  product_id      TEXT,
  product_sku     TEXT,
  product_handle  TEXT,
  product_img_id  TEXT,
  product_img_url TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  source_extra    JSONB
);

CREATE TABLE IF NOT EXISTS commerce."order" (
  order_id           TEXT  PRIMARY KEY,
  company_id         UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  capsuite_ref       TEXT,
  source_platform    TEXT,
  source_id          TEXT,
  customer_id        TEXT,
  order_ref          TEXT,                     -- platform order name/ref, e.g. "#1001"
  channel            TEXT,                     -- web | pos | ...
  order_date         TIMESTAMPTZ,
  order_year         INT,
  order_month        INT,
  order_day          INT,
  order_week         INT,
  net_amount         NUMERIC,
  currency           TEXT,
  exchange_rate      NUMERIC,
  order_status       TEXT,                     -- draft | confirmed | completed | cancelled (unified)
  total_refunded_amt NUMERIC,
  net_payment_amt    NUMERIC,
  remark             TEXT,
  source_extra       JSONB
);

CREATE TABLE IF NOT EXISTS commerce.order_line (
  order_line_id    TEXT  PRIMARY KEY,
  company_id       UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  capsuite_ref     TEXT,
  source_platform  TEXT,
  source_id        TEXT,
  order_id         TEXT,
  customer_id      TEXT,
  order_date       TIMESTAMPTZ,
  line_type        TEXT,                       -- line_item | shipping
  product_id       TEXT,
  product_sku      TEXT,
  product_name     TEXT,
  product_type     TEXT,
  qty              NUMERIC,                    -- current quantity
  qty_ordered      NUMERIC,
  refunded_qty     NUMERIC,
  unit_price_net   NUMERIC,                    -- discounted
  unit_price_gross NUMERIC,                    -- original
  discount_amt     NUMERIC,
  currency         TEXT,
  channel          TEXT,
  bundle_id        TEXT,
  bundle_name      TEXT,
  remark           TEXT,
  source_extra     JSONB
);

CREATE TABLE IF NOT EXISTS commerce.inventory_level (
  inventory_level_id TEXT  PRIMARY KEY,        -- {product_id}_{location_id}
  company_id         UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  capsuite_ref       TEXT,
  source_platform    TEXT,
  source_id          TEXT,
  product_id         TEXT,
  location_id        TEXT,
  quantity           NUMERIC,
  quantity_reserved  NUMERIC,
  snapshot_date      TIMESTAMPTZ,
  source_extra       JSONB
);

CREATE TABLE IF NOT EXISTS commerce.refund (
  refund_id       TEXT  PRIMARY KEY,
  company_id      UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  capsuite_ref    TEXT,
  source_platform TEXT,
  source_id       TEXT,
  order_id        TEXT,
  refund_date     TIMESTAMPTZ,
  refund_amount   NUMERIC,
  refund_currency TEXT,
  note            TEXT,
  source_extra    JSONB
);

CREATE TABLE IF NOT EXISTS commerce.refund_line (
  refund_line_id  TEXT  PRIMARY KEY,
  company_id      UUID  NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  capsuite_ref    TEXT,
  source_platform TEXT,
  source_id       TEXT,
  refund_id       TEXT,
  order_id        TEXT,
  order_line_id   TEXT,
  product_id      TEXT,
  product_sku     TEXT,
  refunded_qty    NUMERIC,
  refund_subtotal NUMERIC,
  refund_currency TEXT,
  restock_type    TEXT,
  source_extra    JSONB
);

-- ── Indexes (tenant scoping + the app's read paths) ──────────────────────────
CREATE INDEX IF NOT EXISTS commerce_order_company_idx          ON commerce."order" (company_id);
CREATE INDEX IF NOT EXISTS commerce_order_customer_idx         ON commerce."order" (company_id, customer_id);
-- customer_id-only: the rule engine's purchase subqueries filter customer_id =
-- profile.member_id WITHOUT a company_id, so the composite above can't serve them
-- (see server/lib/attributeRules.js). Was wrongly on shopify.sale in 13.
CREATE INDEX IF NOT EXISTS commerce_order_customer_only_idx    ON commerce."order" (customer_id);
CREATE INDEX IF NOT EXISTS commerce_order_line_company_idx     ON commerce.order_line (company_id);
CREATE INDEX IF NOT EXISTS commerce_order_line_order_idx       ON commerce.order_line (order_id);
CREATE INDEX IF NOT EXISTS commerce_customer_company_idx       ON commerce.customer (company_id);
CREATE INDEX IF NOT EXISTS commerce_customer_email_idx         ON commerce.customer (company_id, lower(primary_email));
CREATE INDEX IF NOT EXISTS commerce_product_company_idx        ON commerce.product (company_id);
CREATE INDEX IF NOT EXISTS commerce_product_detail_company_idx ON commerce.product_detail (company_id, product_id);
CREATE INDEX IF NOT EXISTS commerce_product_image_company_idx  ON commerce.product_image (company_id, product_id);
CREATE INDEX IF NOT EXISTS commerce_inventory_company_idx      ON commerce.inventory_level (company_id);
CREATE INDEX IF NOT EXISTS commerce_refund_company_idx         ON commerce.refund (company_id);
CREATE INDEX IF NOT EXISTS commerce_refund_line_company_idx    ON commerce.refund_line (company_id);
