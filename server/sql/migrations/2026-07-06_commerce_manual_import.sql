-- ============================================================================
--  2026-07-06_commerce_manual_import.sql  -  Manual transaction/order CSV import
--  into the neutral commerce layer, for EXISTING databases (idempotent).
--
--  Fresh installs get these from 14_commerce.sql. Manually-imported orders land
--  in commerce.customer / "order" / order_line tagged source_platform='manual';
--  these columns mark that provenance (is_manual) and link rows to their upload
--  batch (upload_batch_id -> manual.upload_batches) so an import can be undone.
--  The DAG-loaded platform rows leave both NULL/false; the commerce_landing DAG
--  ignores these columns.
-- ============================================================================

ALTER TABLE commerce.customer   ADD COLUMN IF NOT EXISTS is_manual       BOOLEAN DEFAULT false;
ALTER TABLE commerce.customer   ADD COLUMN IF NOT EXISTS upload_batch_id UUID;
ALTER TABLE commerce."order"    ADD COLUMN IF NOT EXISTS is_manual       BOOLEAN DEFAULT false;
ALTER TABLE commerce."order"    ADD COLUMN IF NOT EXISTS upload_batch_id UUID;
ALTER TABLE commerce.order_line ADD COLUMN IF NOT EXISTS is_manual       BOOLEAN DEFAULT false;
ALTER TABLE commerce.order_line ADD COLUMN IF NOT EXISTS upload_batch_id UUID;

CREATE INDEX IF NOT EXISTS commerce_order_batch_idx      ON commerce."order" (upload_batch_id);
CREATE INDEX IF NOT EXISTS commerce_order_line_batch_idx ON commerce.order_line (upload_batch_id);
CREATE INDEX IF NOT EXISTS commerce_customer_batch_idx   ON commerce.customer (upload_batch_id);
