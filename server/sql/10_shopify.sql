-- ============================================================================
--  10_shopify.sql - Shopify RAW landing (schema: shopify), COMPANY-SCOPED
-- ----------------------------------------------------------------------------
--  Raw, Shopify-NATIVE data synced by the click_cdp_ai Shopify DAGs
--  (dags/click_cdp_ai/shopify/* via lib/shopify_transforms + lib/pg_loader).
--  Column sets mirror the DAG transforms 1:1; cross-platform normalization
--  (unified order status, date parts, refunded-qty) deliberately does NOT
--  happen here - it happens in the neutral commerce.* layer (14_commerce.sql),
--  which is what the app / profile builder / AI analyst read.
--
--  ID convention: {capsuite_ref}_{entity}_{shopifyNativeId}, e.g.
--  acme_order_123, acme_cust_456, acme_product_789 (variant grain),
--  acme_orderline_321, acme_refund_654.
--
--  Every table is keyed by (company_id, <natural key>). pg_loader stamps
--  company_id (resolved from app.companies by capsuite_ref) on every row and
--  replaces scoped by (company_id, key-values-present) - delete-then-insert,
--  so no ON CONFLICT clauses are needed.
--
--  The per-(client, dataset) incremental watermark lives in
--  shopify.shopify_sync_control (created here to mirror lib/pg_state).
-- ============================================================================

-- ── Customers ────────────────────────────────────────────────────────────────
CREATE TABLE shopify.customer (
  customer_id     TEXT        NOT NULL,
  company_id      UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  email           TEXT,
  phone           TEXT,                       -- normalized, '+' stripped
  first_name      TEXT,
  last_name       TEXT,
  full_name       TEXT,
  is_opt_in_email BOOLEAN,
  is_opt_in_sms   BOOLEAN,
  tags            TEXT,
  capsuite_ref    TEXT,
  PRIMARY KEY (company_id, customer_id)
);
CREATE INDEX shopify_customer_email_idx ON shopify.customer(company_id, LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX shopify_customer_ref_idx   ON shopify.customer(capsuite_ref);

-- ── Orders (header) ──────────────────────────────────────────────────────────
CREATE TABLE shopify."order" (
  order_id           TEXT        NOT NULL,
  company_id         UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  customer_id        TEXT,
  order_name         TEXT,                    -- Shopify order name, e.g. "#1001"
  created_at         TIMESTAMPTZ,
  total_price        NUMERIC,
  currency           TEXT,
  total_refunded     NUMERIC,
  net_payment        NUMERIC,
  financial_status   TEXT,                    -- PAID | PARTIALLY_REFUNDED | REFUNDED | VOIDED | ...
  fulfillment_status TEXT,                    -- FULFILLED | IN_PROGRESS | RESTOCKED | ...
  capsuite_ref       TEXT,
  PRIMARY KEY (company_id, order_id)
);
CREATE INDEX shopify_order_customer_idx ON shopify."order"(company_id, customer_id);
CREATE INDEX shopify_order_ref_idx      ON shopify."order"(capsuite_ref);

-- ── Order lines (line items + shipping lines) ────────────────────────────────
CREATE TABLE shopify.order_line (
  order_line_id         TEXT        NOT NULL,
  company_id            UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  order_id              TEXT,
  line_type             TEXT,                 -- line_item | shipping
  product_id            TEXT,                 -- variant grain ({ref}_product_{variantId})
  product_sku           TEXT,
  product_name          TEXT,
  quantity_ordered      NUMERIC,
  quantity_current      NUMERIC,              -- after removals/refunds
  original_unit_price   NUMERIC,
  discounted_unit_price NUMERIC,
  currency              TEXT,
  created_at            TIMESTAMPTZ,          -- order created_at (joined in transform)
  capsuite_ref          TEXT,
  PRIMARY KEY (company_id, order_line_id)
);
CREATE INDEX shopify_order_line_order_idx ON shopify.order_line(company_id, order_id);
CREATE INDEX shopify_order_line_ref_idx   ON shopify.order_line(capsuite_ref);

-- ── Product master (one row per VARIANT) ─────────────────────────────────────
CREATE TABLE shopify.product (
  product_id        TEXT        NOT NULL,     -- {ref}_product_{variantId}
  company_id        UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  product_temp_id   TEXT,
  product_sku       TEXT,
  price             NUMERIC,
  product_name      TEXT,                     -- "Product - Variant" when variant-titled
  product_type      TEXT,
  taxonomy_category TEXT,                     -- Shopify taxonomy node name
  tags              TEXT,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  capsuite_ref      TEXT,
  PRIMARY KEY (company_id, product_id)
);
CREATE INDEX shopify_product_sku_idx ON shopify.product(company_id, product_sku);
CREATE INDEX shopify_product_ref_idx ON shopify.product(capsuite_ref);

-- ── Product custom attributes (collection memberships) ───────────────────────
CREATE TABLE shopify.product_detail (
  company_id       UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  product_id       TEXT        NOT NULL,
  custom_attribute TEXT        NOT NULL,      -- e.g. 'collection'
  custom_value     TEXT        NOT NULL,
  capsuite_ref     TEXT,
  PRIMARY KEY (company_id, product_id, custom_attribute, custom_value)
);
CREATE INDEX shopify_product_detail_ref_idx ON shopify.product_detail(capsuite_ref);

-- ── Product images (featured image per variant) ──────────────────────────────
CREATE TABLE shopify.product_image (
  company_id      UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  product_id      TEXT        NOT NULL,
  product_sku     TEXT,
  product_handle  TEXT,
  product_img_id  TEXT,
  product_img_url TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  capsuite_ref    TEXT,
  PRIMARY KEY (company_id, product_id)
);
CREATE INDEX shopify_product_image_sku_idx ON shopify.product_image(company_id, product_sku);
CREATE INDEX shopify_product_image_ref_idx ON shopify.product_image(capsuite_ref);

-- ── Inventory levels (FULL snapshot - replaced per client on every run) ──────
CREATE TABLE shopify.inventory_level (
  company_id         UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  inventory_level_id BIGINT,                  -- synthetic per-snapshot row number
  product_id         TEXT        NOT NULL,    -- variant grain
  location_id        TEXT        NOT NULL,
  quantity           NUMERIC,
  updated_at         TIMESTAMPTZ,
  capsuite_ref       TEXT,
  PRIMARY KEY (company_id, product_id, location_id)
);
CREATE INDEX shopify_inventory_level_ref_idx ON shopify.inventory_level(capsuite_ref);

-- ── Refunds (order-level summary) ────────────────────────────────────────────
CREATE TABLE shopify.refund (
  refund_id       TEXT        NOT NULL,
  company_id      UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  order_id        TEXT,
  refund_date     TIMESTAMPTZ,
  refund_amount   NUMERIC,
  refund_currency TEXT,
  note            TEXT,
  capsuite_ref    TEXT,
  PRIMARY KEY (company_id, refund_id)
);
CREATE INDEX shopify_refund_order_idx ON shopify.refund(company_id, order_id);
CREATE INDEX shopify_refund_ref_idx   ON shopify.refund(capsuite_ref);

-- ── Refund line items ────────────────────────────────────────────────────────
CREATE TABLE shopify.refund_line (
  refund_line_id  TEXT        NOT NULL,
  company_id      UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  refund_id       TEXT,
  order_id        TEXT,
  order_line_id   TEXT,
  product_id      TEXT,
  product_sku     TEXT,
  refunded_qty    NUMERIC,
  refund_subtotal NUMERIC,
  refund_currency TEXT,
  restock_type    TEXT,                       -- RETURN | CANCEL | NO_RESTOCK | LEGACY_RESTOCK
  capsuite_ref    TEXT,
  PRIMARY KEY (company_id, refund_line_id)
);
CREATE INDEX shopify_refund_line_refund_idx ON shopify.refund_line(company_id, refund_id);
CREATE INDEX shopify_refund_line_ref_idx    ON shopify.refund_line(capsuite_ref);

-- ── Incremental sync control (mirrors dags lib/pg_state.ensure_control_table) ─
CREATE TABLE shopify.shopify_sync_control (
  capsuite_ref   TEXT        NOT NULL,
  report         TEXT        NOT NULL,        -- dataset name (order, customer, refund, ...)
  is_debugging   BOOLEAN     NOT NULL DEFAULT FALSE,
  debug_months   INTEGER     NOT NULL DEFAULT 2,
  overlap_days   INTEGER     NOT NULL DEFAULT 7,
  last_sync_date DATE,
  last_run_at    TIMESTAMPTZ,
  last_status    TEXT,
  error_message  TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (capsuite_ref, report)
);
