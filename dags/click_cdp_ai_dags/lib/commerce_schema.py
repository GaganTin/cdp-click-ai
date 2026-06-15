#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Neutral ``commerce`` integration-layer schema (DDL) for click_cdp_ai.

The ``commerce`` schema is the platform-NEUTRAL layer that combines the per-
platform raw schemas (``shopify`` / ``shopline`` / ``odoo``) into one analysis-
friendly model. Every row carries ``company_id`` (the tenant key, like every
other schema in the redesign), ``capsuite_ref``, ``source_platform``,
``source_id`` and a ``source_extra`` JSONB for platform-specific richness
(NULL = not provided). Tables are built/refreshed by ``commerce_integration``.

This DDL is mirrored by ``server/sql/14_commerce.sql`` - keep them in sync.

This module only owns the target DDL; the per-platform mappings live in
``commerce_integration``.
"""

COMMERCE_SCHEMA = "commerce"

# Entity -> CREATE TABLE DDL (idempotent). "order" is a reserved word -> quoted.
DDL = {
    "order": """
        CREATE TABLE IF NOT EXISTS commerce."order" (
            order_id            text PRIMARY KEY,
            company_id          uuid NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
            capsuite_ref        text,
            source_platform     text,
            source_id           text,
            customer_id         text,
            order_ref           text,
            channel             text,
            order_date          timestamptz,
            order_year          int,
            order_month         int,
            order_day           int,
            order_week          int,
            net_amount          numeric,
            currency            text,
            exchange_rate       numeric,
            order_status        text,
            total_refunded_amt  numeric,
            net_payment_amt     numeric,
            remark              text,
            source_extra        jsonb
        )
    """,
    "order_line": """
        CREATE TABLE IF NOT EXISTS commerce.order_line (
            order_line_id       text PRIMARY KEY,
            company_id          uuid NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
            capsuite_ref        text,
            source_platform     text,
            source_id           text,
            order_id            text,
            customer_id         text,
            order_date          timestamptz,
            line_type           text,
            product_id          text,
            product_sku         text,
            product_name        text,
            product_type        text,
            qty                 numeric,
            qty_ordered         numeric,
            refunded_qty        numeric,
            unit_price_net      numeric,
            unit_price_gross    numeric,
            discount_amt        numeric,
            currency            text,
            channel             text,
            bundle_id           text,
            bundle_name         text,
            remark              text,
            source_extra        jsonb
        )
    """,
    "customer": """
        CREATE TABLE IF NOT EXISTS commerce.customer (
            customer_id         text PRIMARY KEY,
            company_id          uuid NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
            capsuite_ref        text,
            source_platform     text,
            source_id           text,
            customer_no         text,
            join_date           timestamptz,
            last_update         timestamptz,
            customer_type       text,
            is_company          boolean,
            has_email           boolean,
            primary_email       text,
            has_phone           boolean,
            primary_phone       text,
            first_name          text,
            last_name           text,
            full_name           text,
            display_name        text,
            is_opt_in_email     boolean,
            is_opt_in_sms       boolean,
            tags                text,
            source_extra        jsonb
        )
    """,
    "product": """
        CREATE TABLE IF NOT EXISTS commerce.product (
            product_id          text PRIMARY KEY,
            company_id          uuid NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
            capsuite_ref        text,
            source_platform     text,
            source_id           text,
            product_temp_id     text,
            product_sku         text,
            price               numeric,
            category            text,
            product_type        text,
            product_name        text,
            tags                text,
            created_at          timestamptz,
            updated_at          timestamptz,
            source_extra        jsonb
        )
    """,
    "product_detail": """
        CREATE TABLE IF NOT EXISTS commerce.product_detail (
            company_id          uuid NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
            capsuite_ref        text,
            source_platform     text,
            source_id           text,
            product_id          text,
            custom_attribute    text,
            custom_value        text,
            source_extra        jsonb
        )
    """,
    "product_image": """
        CREATE TABLE IF NOT EXISTS commerce.product_image (
            company_id          uuid NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
            capsuite_ref        text,
            source_platform     text,
            source_id           text,
            product_id          text,
            product_sku         text,
            product_handle      text,
            product_img_id      text,
            product_img_url     text,
            created_at          timestamptz,
            updated_at          timestamptz,
            source_extra        jsonb
        )
    """,
    "inventory_level": """
        CREATE TABLE IF NOT EXISTS commerce.inventory_level (
            inventory_level_id  text PRIMARY KEY,
            company_id          uuid NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
            capsuite_ref        text,
            source_platform     text,
            source_id           text,
            product_id          text,
            location_id         text,
            quantity            numeric,
            quantity_reserved   numeric,
            snapshot_date       timestamptz,
            source_extra        jsonb
        )
    """,
    "refund": """
        CREATE TABLE IF NOT EXISTS commerce.refund (
            refund_id           text PRIMARY KEY,
            company_id          uuid NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
            capsuite_ref        text,
            source_platform     text,
            source_id           text,
            order_id            text,
            refund_date         timestamptz,
            refund_amount       numeric,
            refund_currency     text,
            note                text,
            source_extra        jsonb
        )
    """,
    "refund_line": """
        CREATE TABLE IF NOT EXISTS commerce.refund_line (
            refund_line_id      text PRIMARY KEY,
            company_id          uuid NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
            capsuite_ref        text,
            source_platform     text,
            source_id           text,
            refund_id           text,
            order_id            text,
            order_line_id       text,
            product_id          text,
            product_sku         text,
            refunded_qty        numeric,
            refund_subtotal     numeric,
            refund_currency     text,
            restock_type        text,
            source_extra        jsonb
        )
    """,
}

# Build order matters: order_line/refund_line reference order/refund conceptually,
# but since we DELETE+INSERT per entity there is no FK, so any order works.
ENTITIES = [
    "customer", "product", "product_detail", "product_image",
    "order", "order_line", "inventory_level", "refund", "refund_line",
]

# Tenant + lookup indexes (idempotent). The Node app reads commerce.* by
# company_id; the per-entity DELETE scopes by (capsuite_ref, source_platform).
INDEX_DDL = [
    'CREATE INDEX IF NOT EXISTS commerce_order_company_idx ON commerce."order" (company_id)',
    'CREATE INDEX IF NOT EXISTS commerce_order_customer_idx ON commerce."order" (company_id, customer_id)',
    'CREATE INDEX IF NOT EXISTS commerce_order_line_company_idx ON commerce.order_line (company_id)',
    'CREATE INDEX IF NOT EXISTS commerce_order_line_order_idx ON commerce.order_line (order_id)',
    'CREATE INDEX IF NOT EXISTS commerce_customer_company_idx ON commerce.customer (company_id)',
    'CREATE INDEX IF NOT EXISTS commerce_customer_email_idx ON commerce.customer (company_id, lower(primary_email))',
    'CREATE INDEX IF NOT EXISTS commerce_product_company_idx ON commerce.product (company_id)',
    'CREATE INDEX IF NOT EXISTS commerce_product_detail_company_idx ON commerce.product_detail (company_id, product_id)',
    'CREATE INDEX IF NOT EXISTS commerce_product_image_company_idx ON commerce.product_image (company_id, product_id)',
    'CREATE INDEX IF NOT EXISTS commerce_inventory_company_idx ON commerce.inventory_level (company_id)',
    'CREATE INDEX IF NOT EXISTS commerce_refund_company_idx ON commerce.refund (company_id)',
    'CREATE INDEX IF NOT EXISTS commerce_refund_line_company_idx ON commerce.refund_line (company_id)',
]


def ensure_tables(conn):
    """Create the commerce schema, entity tables and indexes (idempotent)."""
    with conn.cursor() as cur:
        cur.execute(f'CREATE SCHEMA IF NOT EXISTS {COMMERCE_SCHEMA}')
        for entity in ENTITIES:
            cur.execute(DDL[entity])
        for ddl in INDEX_DDL:
            cur.execute(ddl)
