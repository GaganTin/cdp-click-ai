#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the neutral ``commerce`` integration layer from the per-platform raw
schemas (click_cdp_ai).

For one client + one platform, each entity is refreshed with a scoped
DELETE (by capsuite_ref + source_platform) followed by an INSERT ... SELECT that
maps the platform's raw columns into the neutral ``commerce`` shape (see
``commerce_schema``). This is where cross-platform normalization happens:
unified order_status, date-part splitting, refunded-qty derivation, type casts,
and packing platform-specific fields into ``source_extra`` JSONB.

Set-based (Postgres -> Postgres), so no data is marshalled through Python.
"""

from dags.click_cdp_ai_dags.lib import commerce_schema
from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import db
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("commerce")

# --------------------------------------------------------------------------- #
# Shopify raw -> commerce mappings. Each entry: the target table, the raw source
# (for an existence check), the INSERT column list, and the SELECT (keyed on the
# client via %(client)s). Column order in SELECT MUST match the INSERT list.
# --------------------------------------------------------------------------- #
_SHOPIFY = {
    "customer": {
        "target": "commerce.customer",
        "source": "shopify.customer",
        "columns": (
            "(customer_id, company_id, capsuite_ref, source_platform, source_id, customer_no, "
            "join_date, last_update, customer_type, is_company, has_email, "
            "primary_email, has_phone, primary_phone, first_name, last_name, "
            "full_name, display_name, is_opt_in_email, is_opt_in_sms, tags, source_extra)"
        ),
        "select": """
            SELECT
                customer_id, company_id::uuid, capsuite_ref, 'shopify', split_part(customer_id, '_cust_', 2),
                NULL::text,
                created_at::timestamptz, updated_at::timestamptz,
                'Customer', NULL::boolean,
                (email IS NOT NULL AND email <> ''), email,
                (phone IS NOT NULL AND phone <> ''), phone,
                first_name, last_name, full_name, full_name,
                is_opt_in_email::boolean, is_opt_in_sms::boolean,
                tags, NULL::jsonb
            FROM shopify.customer
            WHERE capsuite_ref = %(client)s
        """,
    },
    "product": {
        "target": "commerce.product",
        "source": "shopify.product",
        "columns": (
            "(product_id, company_id, capsuite_ref, source_platform, source_id, product_temp_id, "
            "product_sku, price, category, product_type, product_name, tags, "
            "created_at, updated_at, source_extra)"
        ),
        "select": """
            SELECT
                product_id, company_id::uuid, capsuite_ref, 'shopify', split_part(product_id, '_product_', 2),
                product_temp_id, product_sku, price::numeric,
                product_type, NULL::text, product_name, tags,
                created_at::timestamptz, updated_at::timestamptz,
                jsonb_strip_nulls(jsonb_build_object('taxonomy_category', taxonomy_category))
            FROM shopify.product
            WHERE capsuite_ref = %(client)s
        """,
    },
    "product_detail": {
        "target": "commerce.product_detail",
        "source": "shopify.product_detail",
        "columns": (
            "(company_id, capsuite_ref, source_platform, source_id, product_id, "
            "custom_attribute, custom_value, source_extra)"
        ),
        "select": """
            SELECT company_id::uuid, capsuite_ref, 'shopify', NULL::text, product_id,
                   custom_attribute, custom_value, NULL::jsonb
            FROM shopify.product_detail
            WHERE capsuite_ref = %(client)s
        """,
    },
    "product_image": {
        "target": "commerce.product_image",
        "source": "shopify.product_image",
        "columns": (
            "(company_id, capsuite_ref, source_platform, source_id, product_id, product_sku, "
            "product_handle, product_img_id, product_img_url, created_at, updated_at, source_extra)"
        ),
        "select": """
            SELECT company_id::uuid, capsuite_ref, 'shopify', NULL::text, product_id, product_sku,
                   product_handle, product_img_id, product_img_url,
                   created_at::timestamptz, updated_at::timestamptz, NULL::jsonb
            FROM shopify.product_image
            WHERE capsuite_ref = %(client)s
        """,
    },
    "order": {
        "target": 'commerce."order"',
        "source": 'shopify."order"',
        "columns": (
            "(order_id, company_id, capsuite_ref, source_platform, source_id, customer_id, "
            "order_ref, channel, order_date, order_year, order_month, order_day, "
            "order_week, net_amount, currency, exchange_rate, order_status, "
            "total_refunded_amt, net_payment_amt, remark, source_extra)"
        ),
        "select": """
            SELECT
                order_id, company_id::uuid, capsuite_ref, 'shopify', split_part(order_id, '_order_', 2),
                customer_id, order_name, 'web',
                created_at::timestamptz,
                extract(year  from created_at::timestamptz)::int,
                extract(month from created_at::timestamptz)::int,
                extract(day   from created_at::timestamptz)::int,
                extract(week  from created_at::timestamptz)::int,
                total_price::numeric, currency, 1,
                CASE
                    WHEN fulfillment_status = 'RESTOCKED'
                         OR financial_status IN ('REFUNDED', 'VOIDED') THEN 'cancelled'
                    WHEN fulfillment_status = 'FULFILLED'
                         AND financial_status IN ('PAID', 'PARTIALLY_REFUNDED') THEN 'completed'
                    WHEN fulfillment_status IN ('IN_PROGRESS', 'PARTIALLY_FULFILLED')
                         OR financial_status IN ('PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED') THEN 'confirmed'
                    ELSE 'draft'
                END,
                total_refunded::numeric, net_payment::numeric, NULL::text,
                jsonb_strip_nulls(jsonb_build_object(
                    'financial_status', financial_status,
                    'fulfillment_status', fulfillment_status))
            FROM shopify."order"
            WHERE capsuite_ref = %(client)s
        """,
    },
    "order_line": {
        "target": "commerce.order_line",
        "source": "shopify.order_line",
        "columns": (
            "(order_line_id, company_id, capsuite_ref, source_platform, source_id, order_id, "
            "customer_id, order_date, line_type, product_id, product_sku, product_name, "
            "product_type, qty, qty_ordered, refunded_qty, unit_price_net, "
            "unit_price_gross, discount_amt, currency, channel, bundle_id, "
            "bundle_name, remark, source_extra)"
        ),
        "select": """
            SELECT
                ol.order_line_id, ol.company_id::uuid, ol.capsuite_ref, 'shopify',
                split_part(ol.order_line_id, '_orderline_', 2),
                ol.order_id, o.customer_id, ol.created_at::timestamptz,
                ol.line_type, ol.product_id, ol.product_sku, ol.product_name, p.product_type,
                ol.quantity_current::numeric, ol.quantity_ordered::numeric,
                (ol.quantity_ordered::numeric - ol.quantity_current::numeric),
                ol.discounted_unit_price::numeric, ol.original_unit_price::numeric,
                (ol.original_unit_price::numeric - ol.discounted_unit_price::numeric),
                ol.currency, 'web', NULL::text, NULL::text, NULL::text, NULL::jsonb
            FROM shopify.order_line ol
            LEFT JOIN shopify."order" o ON o.order_id = ol.order_id
            LEFT JOIN shopify.product p ON p.product_id = ol.product_id
            WHERE ol.capsuite_ref = %(client)s
        """,
    },
    "inventory_level": {
        "target": "commerce.inventory_level",
        "source": "shopify.inventory_level",
        "columns": (
            "(inventory_level_id, company_id, capsuite_ref, source_platform, source_id, "
            "product_id, location_id, quantity, quantity_reserved, snapshot_date, source_extra)"
        ),
        "select": """
            SELECT
                (product_id || '_' || location_id), company_id::uuid, capsuite_ref, 'shopify', NULL::text,
                product_id, location_id, quantity::numeric, NULL::numeric,
                updated_at::timestamptz, NULL::jsonb
            FROM shopify.inventory_level
            WHERE capsuite_ref = %(client)s
        """,
    },
    "refund": {
        "target": "commerce.refund",
        "source": "shopify.refund",
        "columns": (
            "(refund_id, company_id, capsuite_ref, source_platform, source_id, order_id, "
            "refund_date, refund_amount, refund_currency, note, source_extra)"
        ),
        "select": """
            SELECT refund_id, company_id::uuid, capsuite_ref, 'shopify', split_part(refund_id, '_refund_', 2),
                   order_id, refund_date::timestamptz, refund_amount::numeric,
                   refund_currency, note, NULL::jsonb
            FROM shopify.refund
            WHERE capsuite_ref = %(client)s
        """,
    },
    "refund_line": {
        "target": "commerce.refund_line",
        "source": "shopify.refund_line",
        "columns": (
            "(refund_line_id, company_id, capsuite_ref, source_platform, source_id, refund_id, "
            "order_id, order_line_id, product_id, product_sku, refunded_qty, "
            "refund_subtotal, refund_currency, restock_type, source_extra)"
        ),
        "select": """
            SELECT refund_line_id, company_id::uuid, capsuite_ref, 'shopify', NULL::text, refund_id,
                   order_id, order_line_id, product_id, product_sku,
                   refunded_qty::numeric, refund_subtotal::numeric,
                   refund_currency, restock_type, NULL::jsonb
            FROM shopify.refund_line
            WHERE capsuite_ref = %(client)s
        """,
    },
}

# --------------------------------------------------------------------------- #
# Shopline raw -> commerce mappings. Shopline has no refund / product_detail /
# product_image entities, so those are simply absent (and skipped at build time).
# --------------------------------------------------------------------------- #
_SHOPLINE = {
    "customer": {
        "target": "commerce.customer",
        "source": "shopline.customer",
        "columns": _SHOPIFY["customer"]["columns"],
        "select": """
            SELECT
                customer_id, company_id::uuid, capsuite_ref, 'shopline', split_part(customer_id, '_cust_', 2),
                NULL::text,
                created_at::timestamptz, updated_at::timestamptz,
                'Customer', NULL::boolean,
                (email IS NOT NULL AND email <> ''), email,
                (phone IS NOT NULL AND phone <> ''), phone,
                NULL::text, NULL::text, full_name, full_name,
                is_opt_in_email::boolean, NULL::boolean,
                tags,
                jsonb_strip_nulls(jsonb_build_object(
                    'gender', gender, 'birthday_year', birthday_year,
                    'birthday_month', birthday_month, 'birthday_day', birthday_day))
            FROM shopline.customer
            WHERE capsuite_ref = %(client)s
        """,
    },
    "product": {
        "target": "commerce.product",
        "source": "shopline.product",
        "columns": _SHOPIFY["product"]["columns"],
        "select": """
            SELECT
                product_id, company_id::uuid, capsuite_ref, 'shopline', split_part(product_id, '_product_', 2),
                product_temp_id, product_sku, price::numeric,
                category, product_type, product_name, tags,
                created_at::timestamptz, updated_at::timestamptz, NULL::jsonb
            FROM shopline.product
            WHERE capsuite_ref = %(client)s
        """,
    },
    "order": {
        "target": 'commerce."order"',
        "source": 'shopline."order"',
        "columns": _SHOPIFY["order"]["columns"],
        "select": """
            SELECT
                order_id, company_id::uuid, capsuite_ref, 'shopline', split_part(order_id, '_order_', 2),
                customer_id, order_name, 'web',
                created_at::timestamptz,
                extract(year  from created_at::timestamptz)::int,
                extract(month from created_at::timestamptz)::int,
                extract(day   from created_at::timestamptz)::int,
                extract(week  from created_at::timestamptz)::int,
                total_price::numeric, currency, 1,
                CASE status
                    WHEN 'temp' THEN 'draft'
                    WHEN 'pending' THEN 'draft'
                    WHEN 'confirmed' THEN 'confirmed'
                    WHEN 'completed' THEN 'completed'
                    WHEN 'cancelled' THEN 'cancelled'
                    WHEN 'removed' THEN 'cancelled'
                    ELSE 'draft'
                END,
                NULL::numeric, NULL::numeric, remark,
                jsonb_strip_nulls(jsonb_build_object('status', status))
            FROM shopline."order"
            WHERE capsuite_ref = %(client)s
        """,
    },
    "order_line": {
        "target": "commerce.order_line",
        "source": "shopline.order_line",
        "columns": _SHOPIFY["order_line"]["columns"],
        "select": """
            SELECT
                order_line_id, company_id::uuid, capsuite_ref, 'shopline',
                split_part(order_line_id, '_orderline_', 2),
                order_id, customer_id, created_at::timestamptz,
                line_type, product_id, product_sku, product_name, product_type,
                quantity::numeric, quantity::numeric, NULL::numeric,
                discounted_unit_price::numeric, original_unit_price::numeric,
                (original_unit_price::numeric - discounted_unit_price::numeric),
                currency, 'web', bundle_id, bundle_name, remark, NULL::jsonb
            FROM shopline.order_line
            WHERE capsuite_ref = %(client)s
        """,
    },
    "inventory_level": {
        "target": "commerce.inventory_level",
        "source": "shopline.inventory_level",
        "columns": _SHOPIFY["inventory_level"]["columns"],
        "select": """
            SELECT
                (product_id || '_' || location_id), company_id::uuid, capsuite_ref, 'shopline', NULL::text,
                product_id, location_id, quantity::numeric, NULL::numeric,
                snapshot_date::timestamptz, NULL::jsonb
            FROM shopline.inventory_level
            WHERE capsuite_ref = %(client)s
        """,
    },
}

# --------------------------------------------------------------------------- #
# Odoo raw -> commerce mappings. The Odoo raw SQL is left untouched (it is already
# Odoo-native), so the mapping reads its existing columns (trxn_*/member_*/prod_*)
# and normalizes the ID prefixes to the cross-platform convention via replace().
# Odoo keeps its richness (staff/subsidiary/demographics) in source_extra. Odoo's
# po/pol/stock_move* have no commerce entity and stay in the odoo schema.
# --------------------------------------------------------------------------- #
_ODOO = {
    "customer": {
        "target": "commerce.customer",
        "source": "odoo.mem",
        "columns": _SHOPIFY["customer"]["columns"],
        "select": """
            SELECT
                replace(member_id, '_mem_', '_cust_'), company_id::uuid, capsuite_ref, 'odoo',
                split_part(member_id, '_mem_', 2),
                member_no, member_join_date::timestamptz, member_last_update::timestamptz,
                member_type, is_company::boolean,
                has_email::boolean, primary_email, has_phone::boolean, primary_phone,
                eng_first_name, eng_last_name, display_name, display_name,
                is_opt_in_email::boolean, is_opt_in_sms::boolean, tags,
                jsonb_strip_nulls(jsonb_build_object(
                    'nationality', nationality, 'title', title,
                    'member_reg_location', member_reg_location,
                    'preferred_lang', preferred_lang, 'preferred_channel', preferred_channel))
            FROM odoo.mem
            WHERE capsuite_ref = %(client)s
        """,
    },
    "product": {
        "target": "commerce.product",
        "source": "odoo.product",
        "columns": _SHOPIFY["product"]["columns"],
        "select": """
            SELECT
                replace(prod_id, '_prod_', '_product_'), company_id::uuid, capsuite_ref, 'odoo',
                split_part(prod_id, '_prod_', 2),
                replace(prod_temp_id, '_prod_temp_', '_producttemp_'),
                prod_sku, prod_price::numeric, prod_category, prod_type, prod_name, tags,
                created_at::timestamptz, updated_at::timestamptz,
                jsonb_strip_nulls(jsonb_build_object(
                    'prod_type_desc', prod_type_desc, 'prod_uom_desc', prod_uom_desc,
                    'subsidiary_name', subsidiary_name))
            FROM odoo.product
            WHERE capsuite_ref = %(client)s
        """,
    },
    "order": {
        "target": 'commerce."order"',
        "source": "odoo.so",
        "columns": _SHOPIFY["order"]["columns"],
        "select": """
            SELECT
                replace(trxn_id, '_trxn_', '_order_'), company_id::uuid, capsuite_ref, 'odoo',
                split_part(trxn_id, '_trxn_', 2),
                replace(member_id, '_mem_', '_cust_'), trxn_ref, trxn_channel,
                trxn_date::timestamptz,
                trxn_year::int, trxn_month::int, trxn_day::int, trxn_week::int,
                trxn_original_net_amt::numeric, trxn_original_net_currency,
                trxn_exchange_rate::numeric, trxn_order_status,
                NULL::numeric, NULL::numeric, remark,
                jsonb_strip_nulls(jsonb_build_object(
                    'staff_id', staff_id, 'staff_name', staff_name, 'team_name', team_name,
                    'subsidiary_name', subsidiary_name, 'trxn_order_purpose', trxn_order_purpose,
                    'pick_up_option', pick_up_option, 'pick_up_store', pick_up_store,
                    'pick_up_remarks', pick_up_remarks))
            FROM odoo.so
            WHERE capsuite_ref = %(client)s
        """,
    },
    "order_line": {
        "target": "commerce.order_line",
        "source": "odoo.sol",
        "columns": _SHOPIFY["order_line"]["columns"],
        "select": """
            SELECT
                replace(trxn_item_id, '_trxn_item_', '_orderline_'), company_id::uuid, capsuite_ref, 'odoo',
                split_part(trxn_item_id, '_trxn_item_', 2),
                replace(trxn_id, '_trxn_', '_order_'),
                replace(member_id, '_mem_', '_cust_'),
                trxn_date::timestamptz, 'line_item',
                replace(prod_id, '_prod_', '_product_'), prod_sku, prod_name, prod_type,
                trxn_item_qty::numeric, trxn_item_qty::numeric, NULL::numeric,
                trxn_item_original_net_unit_price::numeric,
                trxn_item_original_curr_unit_price::numeric,
                trxn_item_discount_amt::numeric,
                trxn_original_net_currency, trxn_channel, trxn_bundle_id, trxn_bundle_name,
                trxn_item_remark,
                jsonb_strip_nulls(jsonb_build_object(
                    'staff_id', staff_id, 'staff_name', staff_name,
                    'prod_category', prod_category, 'prod_type_desc', prod_type_desc,
                    'prod_uom_desc', prod_uom_desc, 'subsidiary_name', subsidiary_name))
            FROM odoo.sol
            WHERE capsuite_ref = %(client)s
        """,
    },
    "inventory_level": {
        "target": "commerce.inventory_level",
        "source": "odoo.stock_quant",
        "columns": _SHOPIFY["inventory_level"]["columns"],
        "select": """
            SELECT
                replace(prod_id, '_prod_', '_product_') || '_' || location_id::text,
                company_id::uuid, capsuite_ref, 'odoo', stock_quant_id::text,
                replace(prod_id, '_prod_', '_product_'), location_id::text,
                stock_quantity::numeric, stock_quantity_reserved::numeric,
                stock_quant_create_date::timestamptz,
                jsonb_strip_nulls(jsonb_build_object(
                    'stock_location_usage', stock_location_usage,
                    'subsidiary_id', subsidiary_id, 'subsidiary_name', subsidiary_name))
            FROM odoo.stock_quant
            WHERE capsuite_ref = %(client)s
        """,
    },
}

_MAPPINGS = {"shopify": _SHOPIFY, "shopline": _SHOPLINE, "odoo": _ODOO}


def build_for_client(client, platform="shopify", conn_kwargs=None):
    """Refresh every commerce entity for ``client`` from ``platform`` raw tables.

    Idempotent: each entity is a scoped DELETE (capsuite_ref + source_platform)
    then INSERT ... SELECT. Entities whose raw source table does not exist yet
    (e.g. the client never ran that view) are skipped. Returns {entity: rowcount}
    (rowcount is None for skipped entities).
    """
    ck = conn_kwargs or ga_config.get_pg_conn_kwargs()
    if not ck:
        raise RuntimeError("Data Postgres connection is not configured (cdp_pg_* Variables).")

    mapping = _MAPPINGS.get(platform)
    if mapping is None:
        raise ValueError(f"No commerce mapping for platform '{platform}'")

    db.run_tx(ck, commerce_schema.ensure_tables)

    summary = {}
    for entity in commerce_schema.ENTITIES:
        spec = mapping.get(entity)
        if spec is None:
            continue

        def _do(conn, spec=spec):
            with conn.cursor() as cur:
                cur.execute("SELECT to_regclass(%s)", (spec["source"],))
                if cur.fetchone()[0] is None:
                    return None  # raw source not present yet -> skip
                cur.execute(
                    f'DELETE FROM {spec["target"]} '
                    f'WHERE capsuite_ref = %(client)s AND source_platform = %(platform)s',
                    {"client": client, "platform": platform},
                )
                cur.execute(
                    f'INSERT INTO {spec["target"]} {spec["columns"]} {spec["select"]}',
                    {"client": client},
                )
                return cur.rowcount

        n = db.run_tx(ck, _do)
        summary[entity] = n
        _log.info("%s %s/%s: %s", ctx(client), platform, entity,
                  "skip (no raw)" if n is None else f"{n} rows")
    return summary
