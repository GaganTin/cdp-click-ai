-- ============================================================================
--  08_manual.sql - "Manual Upload" data source (schema: manual)
-- ----------------------------------------------------------------------------
--  Everything a user uploads by CSV lands here, company-scoped, and is tagged
--  as manual provenance via upload_batch_id (+ is_manual=true). The unified
--  profile builder reads manual.membership alongside commerce.customer.
--
--  Manual upload is supported for:
--    • Customer profiles / membership  → manual.membership
--    • Sales / orders                  → manual.sale + manual.sale_order_line
--    • Products                        → manual.product
--    • UTM links                       → app.campaigns        (is_manual via metadata)
--    • Email suppression               → app.edm_suppression  (is_manual=true)
--    • Manual attributes               → app.profile_attribute_values (source='manual')
--    • Content attributes / Valid /
--      Excluded pages                  → app.web_pages        (is_manual=true)
--  The rows that live in app.* keep their own manual markers; this schema holds
--  the source-of-record commerce + membership uploads.
-- ============================================================================

-- ── Upload batches (provenance for every CSV import) ────────────────────────
CREATE TABLE manual.upload_batches (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  uploaded_by  UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  entity_type  TEXT        NOT NULL,   -- membership | sale | product | utm | suppression | attribute | web_page
  file_name    TEXT,
  row_count    INTEGER     NOT NULL DEFAULT 0,
  status       TEXT        NOT NULL DEFAULT 'completed',  -- pending | processing | completed | failed
  error_message TEXT,
  metadata     JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX manual_upload_batches_company_idx ON manual.upload_batches(company_id, created_date DESC);

-- ── Members (manual upload) ─────────────────────────────────────────────────
-- Column set kept rich (demographics etc.); the profile builder maps it into
-- app.customer_profiles alongside the synced commerce.customer rows.
-- member_id convention: {capsuite_ref}_man_{n}
CREATE TABLE manual.membership (
  member_id            TEXT        NOT NULL,
  company_id           UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  upload_batch_id      UUID        REFERENCES manual.upload_batches(id) ON DELETE SET NULL,
  is_manual            BOOLEAN     NOT NULL DEFAULT true,
  member_no            TEXT,
  member_join_date     TIMESTAMPTZ,
  member_last_update   TIMESTAMPTZ,
  member_reg_channel   TEXT        DEFAULT 'manual',
  member_reg_location  TEXT,
  member_type          TEXT,
  is_company           BOOLEAN     DEFAULT false,
  has_email            BOOLEAN     DEFAULT false,
  primary_email        TEXT,
  secondary_email      TEXT,
  has_phone            BOOLEAN     DEFAULT false,
  primary_phone        TEXT,
  secondary_phone      TEXT,
  gender               TEXT,
  nationality          TEXT,
  age                  TEXT,
  age_group            TEXT,
  birthday_year        TEXT,
  birthday_month       TEXT,
  birthday_day         TEXT,
  marital_status       TEXT,
  education_level      TEXT,
  income_level         TEXT,
  employment_status    TEXT,
  title                TEXT,
  eng_first_name       TEXT,
  eng_last_name        TEXT,
  eng_full_name        TEXT,
  chi_first_name       TEXT,
  chi_last_name        TEXT,
  chi_full_name        TEXT,
  display_name         TEXT,
  is_subscriber_only   BOOLEAN     DEFAULT false,
  is_opt_in_email      BOOLEAN,
  is_opt_in_call       BOOLEAN,
  is_opt_in_dm         BOOLEAN,
  is_opt_in_sms        BOOLEAN,
  preferred_channel    TEXT,
  preferred_language   TEXT,
  tags                 TEXT,
  -- optional anonymous id supplied in the CSV → lets manual membership stitch to
  -- an anonymous web profile (one of the customer-mapping sources).
  anonymous_id         TEXT,
  capsuite_ref         TEXT,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, member_id)
);
CREATE INDEX manual_membership_email_idx ON manual.membership(company_id, LOWER(primary_email)) WHERE primary_email IS NOT NULL;
CREATE INDEX manual_membership_phone_idx ON manual.membership(company_id, primary_phone) WHERE primary_phone IS NOT NULL;
CREATE INDEX manual_membership_anon_idx  ON manual.membership(company_id, anonymous_id) WHERE anonymous_id IS NOT NULL;

-- ── Sale order header (manual upload) ───────────────────────────────────────
CREATE TABLE manual.sale (
  trxn_id                    TEXT        NOT NULL,
  company_id                 UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  upload_batch_id            UUID        REFERENCES manual.upload_batches(id) ON DELETE SET NULL,
  is_manual                  BOOLEAN     NOT NULL DEFAULT true,
  member_id                  TEXT,
  trxn_ref                   TEXT,
  trxn_channel               TEXT        DEFAULT 'manual',
  trxn_date                  TIMESTAMPTZ,
  trxn_original_net_amt      NUMERIC,
  trxn_original_net_currency TEXT,
  trxn_order_status          TEXT,                       -- draft | confirmed | completed | cancelled
  subsidiary_name            TEXT,
  remark                     TEXT,
  capsuite_ref               TEXT,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, trxn_id)
);
CREATE INDEX manual_sale_member_idx ON manual.sale(company_id, member_id);
CREATE INDEX manual_sale_date_idx   ON manual.sale(company_id, trxn_date);

-- ── Sale order line items (manual upload) ───────────────────────────────────
CREATE TABLE manual.sale_order_line (
  trxn_item_id              TEXT        NOT NULL,
  company_id                UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  trxn_id                   TEXT        NOT NULL,
  member_id                 TEXT,
  trxn_item_qty             INTEGER,
  trxn_item_net_unit_price  NUMERIC,
  trxn_item_discount_amt    NUMERIC,
  trxn_date                 TIMESTAMPTZ,
  prod_id                   TEXT,
  prod_sku                  TEXT,
  prod_category             TEXT,
  prod_name                 TEXT,
  capsuite_ref              TEXT,
  synced_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, trxn_item_id),
  FOREIGN KEY (company_id, trxn_id) REFERENCES manual.sale(company_id, trxn_id) ON DELETE CASCADE
);
CREATE INDEX manual_sol_trxn_idx ON manual.sale_order_line(company_id, trxn_id);
CREATE INDEX manual_sol_prod_idx ON manual.sale_order_line(company_id, prod_id);

-- ── Products (manual upload) ────────────────────────────────────────────────
CREATE TABLE manual.product (
  prod_id         TEXT        NOT NULL,
  company_id      UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  upload_batch_id UUID        REFERENCES manual.upload_batches(id) ON DELETE SET NULL,
  is_manual       BOOLEAN     NOT NULL DEFAULT true,
  prod_sku        TEXT,
  prod_name       TEXT,
  prod_category   TEXT,
  prod_type       TEXT,
  prod_price      NUMERIC,
  tags            TEXT,
  capsuite_ref    TEXT,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, prod_id)
);
CREATE INDEX manual_product_sku_idx ON manual.product(company_id, prod_sku);
