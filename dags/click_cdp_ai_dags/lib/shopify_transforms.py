#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pure Shopify NDJSON -> DataFrame transforms for the click_cdp_ai pipeline.

One ``transform_<dataset>(records, client) -> pandas.DataFrame`` per dataset.
This is the RAW layer: each transform emits **Shopify-native** columns only --
faithful to what the Shopify API provides, with NULL (never "") for absent
values. Cross-platform normalization (unified order status, date-part splitting,
refunded-qty derivation, etc.) is deliberately NOT done here; it happens in the
``commerce`` integration layer that combines all platforms.

No I/O. ``records`` is the parsed bulk-op NDJSON (a flat list of dicts where
nested connection nodes carry ``__parentId``). The DataFrame is upserted by PK
via pg_loader into the per-platform ``shopify`` schema.
"""

from datetime import datetime

import numpy as np
import pandas as pd
import pytz

from dags.utils.normalize import normalize_tel_by_location

_HK = pytz.timezone("Asia/Hong_Kong")


def _hk_str(iso_value):
    """ISO8601 (with tz) -> 'YYYY-MM-DD HH:MM:SS.ffffff%z' in Asia/Hong_Kong."""
    return (
        datetime.strptime(iso_value, "%Y-%m-%dT%H:%M:%S%z")
        .astimezone(_HK)
        .strftime("%Y-%m-%d %H:%M:%S.%f%z")
    )


def _empty(columns):
    return pd.DataFrame(columns=columns)


# --------------------------------------------------------------------------- #
# Shopify-native column lists (raw layer). reindex() to these so the loaded
# table schema is deterministic across runs. ID convention: {client}_{entity}_{id}.
# --------------------------------------------------------------------------- #
ORDER_COLUMNS = [
    "order_id", "customer_id", "order_name", "created_at",
    "total_price", "currency", "total_refunded", "net_payment",
    "financial_status", "fulfillment_status", "capsuite_ref",
]

ORDER_LINE_COLUMNS = [
    "order_line_id", "order_id", "line_type", "product_id", "product_sku",
    "product_name", "quantity_ordered", "quantity_current",
    "original_unit_price", "discounted_unit_price", "currency",
    "created_at", "capsuite_ref",
]

CUSTOMER_COLUMNS = [
    "customer_id", "created_at", "updated_at", "email", "phone",
    "first_name", "last_name", "full_name",
    "is_opt_in_email", "is_opt_in_sms", "tags", "capsuite_ref",
]

PRODUCT_COLUMNS = [
    "product_id", "product_temp_id", "product_sku", "price",
    "product_name", "product_type", "taxonomy_category", "tags",
    "created_at", "updated_at", "capsuite_ref",
]

PRODUCT_DETAIL_COLUMNS = ["product_id", "custom_attribute", "custom_value", "capsuite_ref"]

PRODUCT_IMAGE_COLUMNS = [
    "product_sku", "product_handle", "product_img_id", "product_img_url",
    "created_at", "updated_at", "capsuite_ref", "product_id",
]

INVENTORY_LEVEL_COLUMNS = [
    "inventory_level_id", "product_id", "location_id", "quantity",
    "updated_at", "capsuite_ref",
]

REFUND_COLUMNS = [
    "refund_id", "order_id", "refund_date", "refund_amount", "refund_currency",
    "note", "capsuite_ref",
]

REFUND_LINE_COLUMNS = [
    "refund_line_id", "refund_id", "order_id", "order_line_id", "product_id",
    "product_sku", "refunded_qty", "refund_subtotal", "refund_currency",
    "restock_type", "capsuite_ref",
]


# --------------------------------------------------------------------------- #
# order - Shopify orders (header)
# --------------------------------------------------------------------------- #
def transform_order(records, client):
    rows = []
    for r in records:
        if "/Order/" not in str(r.get("id", "")):
            continue
        cust = r.get("customer") or {}
        money = (r.get("currentTotalPriceSet") or {}).get("shopMoney") or {}
        refunded = (r.get("totalRefundedSet") or {}).get("shopMoney") or {}
        net_payment = (r.get("netPaymentSet") or {}).get("shopMoney") or {}
        rows.append({
            "order_id": f"{client}_order_{str(r['id']).replace('gid://shopify/Order/', '')}",
            "customer_id": (
                f"{client}_cust_{str(cust['id']).replace('gid://shopify/Customer/', '')}"
                if cust.get("id") else None
            ),
            "order_name": r.get("name"),
            "created_at": _hk_str(r["createdAt"]) if r.get("createdAt") else None,
            "total_price": money.get("amount"),
            "currency": money.get("currencyCode"),
            "total_refunded": refunded.get("amount"),
            "net_payment": net_payment.get("amount"),
            "financial_status": r.get("displayFinancialStatus"),
            "fulfillment_status": r.get("displayFulfillmentStatus"),
            "capsuite_ref": client,
        })
    if not rows:
        return _empty(ORDER_COLUMNS)
    df = pd.DataFrame(rows).drop_duplicates(subset=["order_id"], keep="first").reset_index(drop=True)
    return df.reindex(columns=ORDER_COLUMNS)


# --------------------------------------------------------------------------- #
# order_line - line items + shipping lines (joined to order header for created_at)
# --------------------------------------------------------------------------- #
def transform_order_line(records, client):
    orders, items = [], []
    for r in records:
        rid = str(r.get("id", ""))
        if "/Order/" in rid:
            orders.append({
                "order_id": f"{client}_order_{rid.replace('gid://shopify/Order/', '')}",
                "created_at": _hk_str(r["createdAt"]) if r.get("createdAt") else None,
            })
        elif "/LineItem/" in rid:
            variant = r.get("variant") or {}
            v_title = variant.get("title")
            prod_title = (r.get("product") or {}).get("title", "")
            orig = (r.get("originalUnitPriceSet") or {}).get("shopMoney") or {}
            disc = (r.get("discountedUnitPriceSet") or {}).get("shopMoney") or {}
            items.append({
                "order_line_id": f"{client}_orderline_{rid.replace('gid://shopify/LineItem/', '')}",
                "order_id": f"{client}_order_{str(r['__parentId']).replace('gid://shopify/Order/', '')}",
                "line_type": "line_item",
                "product_id": (
                    f"{client}_product_{str(variant.get('id', '')).replace('gid://shopify/ProductVariant/', '')}"
                    if variant.get("id") else None
                ),
                "product_sku": variant.get("sku"),
                "product_name": (
                    f"{prod_title} - {v_title}" if v_title and v_title != "Default Title" else prod_title
                ),
                "quantity_ordered": r.get("quantity"),
                "quantity_current": r.get("currentQuantity"),
                "original_unit_price": orig.get("amount"),
                "discounted_unit_price": disc.get("amount"),
                "currency": orig.get("currencyCode"),
                "capsuite_ref": client,
            })
        elif "/ShippingLine/" in rid:
            orig = (r.get("originalPriceSet") or {}).get("shopMoney") or {}
            disc = (r.get("discountedPriceSet") or {}).get("shopMoney") or {}
            items.append({
                "order_line_id": f"{client}_orderline_{rid.replace('gid://shopify/ShippingLine/', '')}",
                "order_id": f"{client}_order_{str(r['__parentId']).replace('gid://shopify/Order/', '')}",
                "line_type": "shipping",
                "product_id": None,
                "product_sku": "shopifyshippingproduct",
                "product_name": "Shopify Shipping Product",
                "quantity_ordered": 1,
                "quantity_current": 1,
                "original_unit_price": orig.get("amount"),
                "discounted_unit_price": disc.get("amount"),
                "currency": orig.get("currencyCode"),
                "capsuite_ref": client,
            })
    if not items:
        return _empty(ORDER_LINE_COLUMNS)
    df_items = pd.DataFrame(items)
    df_orders = pd.DataFrame(orders) if orders else pd.DataFrame(columns=["order_id", "created_at"])
    df = df_items.merge(df_orders, on="order_id", how="left")
    df = df.drop_duplicates(subset=["order_line_id"], keep="first").reset_index(drop=True)
    return df.reindex(columns=ORDER_LINE_COLUMNS)


# --------------------------------------------------------------------------- #
# product - products + variants (variant grain)
# --------------------------------------------------------------------------- #
def transform_product(records, client):
    products, variants = [], []
    for r in records:
        rid = str(r.get("id", ""))
        if "/Product/" in rid:
            category_node = ((r.get("productCategory") or {}).get("productTaxonomyNode") or {})
            products.append({
                "shopify_prod_id": r["id"],
                "product_type": r.get("productType"),
                "product_name": r.get("title"),
                "tags": ",".join(r.get("tags") or []),
                "taxonomy_category": category_node.get("name"),
                "created_at": _hk_str(r["createdAt"]) if r.get("createdAt") else None,
                "updated_at": _hk_str(r["updatedAt"]) if r.get("updatedAt") else None,
                "capsuite_ref": client,
            })
        elif "/ProductVariant/" in rid:
            vid = rid.replace("gid://shopify/ProductVariant/", "")
            v_title = r.get("title")
            variants.append({
                "product_id": f"{client}_product_{vid}",
                "product_temp_id": f"{client}_producttemp_{vid}",
                "product_sku": r.get("sku"),
                "price": r.get("price"),
                "shopify_prod_id": r["__parentId"],
                "variant_name": v_title if v_title and v_title != "Default Title" else None,
            })
    if not variants:
        return _empty(PRODUCT_COLUMNS)
    df_v = pd.DataFrame(variants)
    df_p = pd.DataFrame(products) if products else pd.DataFrame(columns=[
        "shopify_prod_id", "product_type", "product_name", "tags",
        "taxonomy_category", "created_at", "updated_at", "capsuite_ref",
    ])
    df = df_v.merge(df_p, on="shopify_prod_id", how="left")
    df["product_name"] = df.apply(
        lambda x: f"{x['product_name']} - {x['variant_name']}" if x["variant_name"] else x["product_name"],
        axis=1,
    )
    df["updated_at"] = pd.to_datetime(df["updated_at"], errors="coerce")
    df = (df.sort_values(by="updated_at", ascending=False)
            .drop_duplicates(subset=["product_id"], keep="first")
            .reset_index(drop=True))
    return df.reindex(columns=PRODUCT_COLUMNS)


# --------------------------------------------------------------------------- #
# product_detail - collection memberships
# --------------------------------------------------------------------------- #
def transform_product_detail(records, client):
    collections, products, variants = [], [], []
    for r in records:
        rid = str(r.get("id", ""))
        if "/Collection/" in rid:
            collections.append({
                "collection_id": r["id"],
                "custom_attribute": "collection",
                "custom_value": r["title"],
            })
        elif "/Product/" in rid:
            products.append({"shopify_prod_id": r["id"], "collection_id": r["__parentId"]})
        elif "/ProductVariant/" in rid:
            variants.append({
                "product_id": f"{client}_product_{rid.replace('gid://shopify/ProductVariant/', '')}",
                "shopify_prod_id": r["__parentId"],
            })
    if not collections or not variants:
        return _empty(PRODUCT_DETAIL_COLUMNS)
    df = (pd.DataFrame(collections)
          .merge(pd.DataFrame(products), on="collection_id", how="left")
          .merge(pd.DataFrame(variants), on="shopify_prod_id", how="left")
          .drop_duplicates(subset=["product_id", "custom_attribute", "custom_value"], keep="first")
          .reset_index(drop=True))
    df["capsuite_ref"] = client
    return df.reindex(columns=PRODUCT_DETAIL_COLUMNS)


# --------------------------------------------------------------------------- #
# product_image - featured image per product/variant
# --------------------------------------------------------------------------- #
def transform_product_image(records, client):
    products, variants = [], []
    for r in records:
        rid = str(r.get("id", ""))
        if "/Product/" in rid:
            img = r.get("featuredImage")
            products.append({
                "shopify_prod_id": r["id"],
                "product_handle": r.get("handle"),
                "product_img_id": img["id"].split("/")[-1] if img else None,
                "product_img_url": img["url"] if img else None,
                "created_at": _hk_str(r["createdAt"]) if r.get("createdAt") else None,
                "updated_at": _hk_str(r["updatedAt"]) if r.get("updatedAt") else None,
            })
        elif "/ProductVariant/" in rid:
            variants.append({
                "product_id": f"{client}_product_{rid.split('/')[-1]}",
                "product_sku": r.get("sku"),
                "shopify_prod_id": r["__parentId"],
            })
    if not variants:
        return _empty(PRODUCT_IMAGE_COLUMNS)
    df = pd.DataFrame(variants).merge(pd.DataFrame(products), on="shopify_prod_id", how="left")
    df["capsuite_ref"] = client
    df["updated_at"] = pd.to_datetime(df["updated_at"], errors="coerce")
    # Dedup by product_id (the table's upsert key) keeping the latest row.
    # Deduping by SKU would silently collapse all null/shared-SKU variants.
    df = (df.sort_values(by="updated_at", ascending=False)
            .drop_duplicates(subset=["product_id"], keep="first")
            .reset_index(drop=True))
    df["product_img_id"] = (df["product_img_id"].replace([np.nan], [None])
                            .apply(lambda x: str(int(x)) if x is not None else None))
    return df.reindex(columns=PRODUCT_IMAGE_COLUMNS)


# --------------------------------------------------------------------------- #
# customer - Shopify customers
# --------------------------------------------------------------------------- #
def transform_customer(records, client):
    rows = []
    for r in records:
        first, last = r.get("firstName"), r.get("lastName")
        if first is not None and last is not None:
            full = f"{first} {last}"
        else:
            full = first if first is not None else last
        email_consent = r.get("emailMarketingConsent")
        sms_consent = r.get("smsMarketingConsent")
        phone = r.get("phone")
        rows.append({
            "customer_id": f"{client}_cust_{str(r['id']).replace('gid://shopify/Customer/', '')}",
            "created_at": _hk_str(r["createdAt"]) if r.get("createdAt") else None,
            "updated_at": _hk_str(r["updatedAt"]) if r.get("updatedAt") else None,
            "email": r.get("email"),
            "phone": normalize_tel_by_location(phone, "").replace("+", "") if phone else None,
            "first_name": first,
            "last_name": last,
            "full_name": full,
            "is_opt_in_email": None if email_consent is None else (email_consent["marketingState"] == "subscribed"),
            "is_opt_in_sms": None if sms_consent is None else (sms_consent["marketingState"] == "subscribed"),
            "tags": ",".join(r.get("tags") or []),
            "capsuite_ref": client,
        })
    if not rows:
        return _empty(CUSTOMER_COLUMNS)
    df = pd.DataFrame(rows)
    df["updated_at"] = pd.to_datetime(df["updated_at"], errors="coerce")
    df = (df.sort_values(by="updated_at", ascending=False)
            .drop_duplicates(subset=["customer_id"], keep="first")
            .reset_index(drop=True))
    return df.reindex(columns=CUSTOMER_COLUMNS)


# --------------------------------------------------------------------------- #
# inventory_level - inventory levels (full snapshot)
# --------------------------------------------------------------------------- #
def transform_inventory_level(records, client):
    rows = []
    for r in records:
        if "__parentId" not in r:
            continue
        rows.append({
            "product_id": f"{client}_product_" + r["__parentId"].replace("gid://shopify/ProductVariant/", ""),
            "location_id": r["location"]["id"].replace("gid://shopify/Location/", ""),
            "quantity": int(r["quantities"][0]["quantity"]),
            "updated_at": _hk_str(r["quantities"][0]["updatedAt"]),
            "capsuite_ref": client,
        })
    if not rows:
        return _empty(INVENTORY_LEVEL_COLUMNS)
    df = pd.DataFrame(rows)
    df["updated_at"] = pd.to_datetime(df["updated_at"], errors="coerce")
    # Keep the LATEST reading per (product, location) - sort newest first.
    df = (df.sort_values(by=["updated_at", "product_id", "location_id"], ascending=False)
            .drop_duplicates(subset=["product_id", "location_id"], keep="first")
            .reset_index(drop=True))
    df["inventory_level_id"] = pd.RangeIndex(1, len(df) + 1)
    return df.reindex(columns=INVENTORY_LEVEL_COLUMNS)


# --------------------------------------------------------------------------- #
# refund / refund_line - from orders[].refunds (inline list) + refundLineItems
# --------------------------------------------------------------------------- #
def _iter_order_refunds(records):
    """Yield (order_native_id, refund) for each inline refund on each order node."""
    for r in records:
        if "/Order/" not in str(r.get("id", "")):
            continue
        order_id = str(r["id"]).replace("gid://shopify/Order/", "")
        for refund in (r.get("refunds") or []):
            yield order_id, refund


def transform_refund(records, client):
    """Order-level refund summary (one row per Shopify Refund)."""
    rows = []
    for order_id, refund in _iter_order_refunds(records):
        money = (refund.get("totalRefundedSet") or {}).get("shopMoney") or {}
        rid = str(refund.get("id", "")).replace("gid://shopify/Refund/", "")
        rows.append({
            "refund_id": f"{client}_refund_{rid}",
            "order_id": f"{client}_order_{order_id}",
            "refund_date": _hk_str(refund["createdAt"]) if refund.get("createdAt") else None,
            "refund_amount": money.get("amount"),
            "refund_currency": money.get("currencyCode"),
            "note": refund.get("note"),
            "capsuite_ref": client,
        })
    if not rows:
        return _empty(REFUND_COLUMNS)
    df = pd.DataFrame(rows).drop_duplicates(subset=["refund_id"], keep="first").reset_index(drop=True)
    return df.reindex(columns=REFUND_COLUMNS)


def transform_refund_line(records, client):
    """Refund line-item detail (one row per refunded line item).

    Parses the inline ``refundLineItems.edges[].node`` under each order refund
    (fetched via the non-bulk paginated query; see shopify_client).
    """
    rows = []
    for order_id, refund in _iter_order_refunds(records):
        rid = str(refund.get("id", "")).replace("gid://shopify/Refund/", "")
        refund_id = f"{client}_refund_{rid}"
        order_ref_id = f"{client}_order_{order_id}"
        edges = ((refund.get("refundLineItems") or {}).get("edges")) or []
        for idx, edge in enumerate(edges):
            node = edge.get("node") or {}
            line_item = node.get("lineItem") or {}
            li_id = str(line_item.get("id", "")).replace("gid://shopify/LineItem/", "")
            variant = line_item.get("variant") or {}
            subtotal = (node.get("subtotalSet") or {}).get("shopMoney") or {}
            order_line_id = f"{client}_orderline_{li_id}" if li_id else None
            rows.append({
                # Positional fallback when the line item id is absent, so two
                # id-less lines in one refund can't collapse to the same PK.
                "refund_line_id": f"{refund_id}_{order_line_id or f'idx{idx}'}",
                "refund_id": refund_id,
                "order_id": order_ref_id,
                "order_line_id": order_line_id,
                "product_id": (
                    f"{client}_product_{str(variant.get('id', '')).replace('gid://shopify/ProductVariant/', '')}"
                    if variant.get("id") else None
                ),
                "product_sku": line_item.get("sku"),
                "refunded_qty": node.get("quantity"),
                "refund_subtotal": subtotal.get("amount"),
                "refund_currency": subtotal.get("currencyCode"),
                "restock_type": node.get("restockType"),
                "capsuite_ref": client,
            })
    if not rows:
        return _empty(REFUND_LINE_COLUMNS)
    df = pd.DataFrame(rows).drop_duplicates(subset=["refund_line_id"], keep="first").reset_index(drop=True)
    return df.reindex(columns=REFUND_LINE_COLUMNS)
