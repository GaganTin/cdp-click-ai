#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pure Shopline JSON -> DataFrame transforms for the click_cdp_ai pipeline.

RAW layer: each ``transform_*`` takes the parsed API ``items`` (lists of dicts)
and emits **Shopline-native** columns only -- faithful to the Shopline REST API
(Shopline genuinely carries gender/birthday, so those stay), with NULL (never "")
for absent values. Cross-platform normalization happens in the ``commerce``
integration layer, not here. No I/O.
"""

from datetime import datetime

import pandas as pd
import pytz

_HK = pytz.timezone("Asia/Hong_Kong")
_FMT = "%Y-%m-%dT%H:%M:%S.%f%z"  # Shopline timestamps carry microseconds


def _hk_str(value):
    return datetime.strptime(value, _FMT).astimezone(_HK).strftime("%Y-%m-%d %H:%M:%S.%f%z")


def _empty(cols):
    return pd.DataFrame(columns=cols)


# Shopline-native column lists. ID convention: {client}_{entity}_{native_id}.
ORDER_COLUMNS = [
    "order_id", "customer_id", "order_name", "created_at",
    "total_price", "currency", "status", "remark", "capsuite_ref",
]

ORDER_LINE_COLUMNS = [
    "order_line_id", "order_id", "customer_id", "created_at", "line_type",
    "product_id", "product_sku", "product_name", "product_type", "quantity",
    "original_unit_price", "discounted_unit_price", "currency",
    "bundle_id", "bundle_name", "remark", "capsuite_ref",
]

PRODUCT_COLUMNS = [
    "product_id", "product_temp_id", "product_sku", "price", "category",
    "product_type", "product_name", "tags", "created_at", "updated_at", "capsuite_ref",
]

CUSTOMER_COLUMNS = [
    "customer_id", "created_at", "updated_at", "email", "phone", "full_name",
    "gender", "birthday_year", "birthday_month", "birthday_day",
    "is_opt_in_email", "tags", "capsuite_ref",
]

INVENTORY_LEVEL_COLUMNS = [
    "inventory_level_id", "product_id", "location_id", "quantity",
    "snapshot_date", "capsuite_ref",
]


# --------------------------------------------------------------------------- #
# order - sale orders
# --------------------------------------------------------------------------- #
def transform_order(items, client):
    rows = []
    for r in items:
        total = r.get("total") or {}
        rows.append({
            "order_id": f"{client}_order_{r['id']}",
            "customer_id": f"{client}_cust_{r['customer_id']}" if r.get("customer_id") else None,
            "order_name": str(r["order_number"]) if r.get("order_number") is not None else None,
            "created_at": _hk_str(r["created_at"]) if r.get("created_at") else None,
            "total_price": total.get("dollars"),
            "currency": total.get("currency_iso"),
            "status": r.get("status"),
            "remark": r.get("order_remarks"),
            "capsuite_ref": client,
        })
    if not rows:
        return _empty(ORDER_COLUMNS)
    df = pd.DataFrame(rows).drop_duplicates(subset=["order_id"], keep="first").reset_index(drop=True)
    return df.reindex(columns=ORDER_COLUMNS)


# --------------------------------------------------------------------------- #
# order_line - line items (incl. ProductSet bundles + shipping)
# --------------------------------------------------------------------------- #
def _line_base(record, client):
    return {
        "order_id": f"{client}_order_{record['id']}",
        "customer_id": f"{client}_cust_{record['customer_id']}" if record.get("customer_id") else None,
        "created_at": _hk_str(record["created_at"]) if record.get("created_at") else None,
        "line_type": "line_item",
        "product_type": None,
        "currency": None,
        "bundle_id": None,
        "bundle_name": None,
        "remark": record.get("order_remarks"),
        "capsuite_ref": client,
    }


def transform_order_line(items, client):
    rows = []
    for record in items:
        for item in record.get("subtotal_items", []):
            if item["item_type"] != "ProductSet":
                tmp = _line_base(record, client)
                tmp["order_line_id"] = f"{client}_orderline_{item['id']}"
                vd = item.get("item_data", {}).get("variation_data")
                if vd:
                    tmp["product_id"] = f"{client}_product_{item['item_variation_key']}"
                    cur_src = vd["price"] if vd.get("price") and vd["price"]["dollars"] > 0 else vd["item_price"]
                    if vd.get("price_sale") and vd["price_sale"]["dollars"] > 0:
                        net_src = vd["price_sale"]
                    elif vd.get("price") and vd["price"]["dollars"] > 0:
                        net_src = vd["price"]
                    else:
                        net_src = vd["item_price"]
                else:
                    tmp["product_id"] = f"{client}_product_{item['item_id']}"
                    cur_src = item["price"] if item.get("price") and item["price"]["dollars"] > 0 else item["item_price"]
                    if item.get("price_sale") and item["price_sale"]["dollars"] > 0:
                        net_src = item["price_sale"]
                    elif item.get("price") and item["price"]["dollars"] > 0:
                        net_src = item["price"]
                    else:
                        net_src = item["item_price"]
                tmp["original_unit_price"] = cur_src["dollars"]
                tmp["discounted_unit_price"] = net_src["dollars"]
                tmp["quantity"] = item["quantity"]
                tmp["currency"] = item["total"]["currency_iso"]
                tmp["product_sku"] = item.get("sku")
                tmp["product_type"] = item["item_type"]
                ft = item.get("fields_translations") or {}
                if ft.get("en"):
                    tmp["product_name"] = item["title_translations"]["en"] + " - " + ",".join(ft["en"])
                else:
                    tmp["product_name"] = item["title_translations"]["en"]
                rows.append(tmp)
            else:
                # ProductSet bundle -> one row per child product, net price prorated
                set_price = item["item_price"]["dollars"]
                values = []
                for i, cp in enumerate(item["child_products"]):
                    price = cp["price"].get("dollars", cp["price"].get("cents", 0) / 100)
                    values.append(price * item["item_data"]["selected_child_products"][i]["quantity"])
                total_value = sum(values) or 1
                for i, cp in enumerate(item["child_products"]):
                    tmp = _line_base(record, client)
                    tmp["order_line_id"] = f"{client}_orderline_{item['id']}_{i+1}"
                    tmp["product_id"] = f"{client}_product_{cp['variation_id'] or cp['id']}"
                    unit = cp["price"].get("dollars", cp["price"].get("cents", 0) / 100)
                    tmp["original_unit_price"] = unit
                    tmp["discounted_unit_price"] = set_price * (unit / total_value)
                    tmp["quantity"] = item["item_data"]["selected_child_products"][i]["quantity"]
                    tmp["currency"] = item["total"]["currency_iso"]
                    tmp["product_sku"] = cp.get("sku")
                    tmp["product_type"] = "Product"
                    tmp["bundle_id"] = item["item_id"]
                    tmp["bundle_name"] = item["title_translations"]["en"]
                    cft = cp.get("fields_translations") or {}
                    if cft.get("en"):
                        tmp["product_name"] = cp["title_translations"]["en"] + " - " + ",".join(cft["en"])
                    else:
                        tmp["product_name"] = cp["title_translations"]["en"]
                    rows.append(tmp)
        # shipping line
        delivery = record.get("order_delivery") or {}
        if (delivery.get("total") or {}).get("dollars", 0) > 0:
            tmp = _line_base(record, client)
            amt = delivery["total"]["dollars"]
            tmp.update({
                "order_line_id": f"{client}_orderline_{delivery['id']}",
                "line_type": "shipping",
                "product_id": None,
                "product_sku": "shoplineshippingproduct",
                "product_name": "Shopline Shipping Product",
                "product_type": "Service",
                "quantity": 1,
                "original_unit_price": amt,
                "discounted_unit_price": amt,
                "currency": delivery["total"]["currency_iso"],
                "remark": delivery.get("remark"),
            })
            rows.append(tmp)
    if not rows:
        return _empty(ORDER_LINE_COLUMNS)
    df = pd.DataFrame(rows).drop_duplicates(subset=["order_line_id"], keep="first").reset_index(drop=True)
    for c in ("original_unit_price", "discounted_unit_price"):
        df[c] = df[c].astype(float)
    return df.reindex(columns=ORDER_LINE_COLUMNS)


# --------------------------------------------------------------------------- #
# product - products (+variations) + addon_products + gifts
# --------------------------------------------------------------------------- #
def _product_row(client, pid, sku, category, ptype, price, tags, name, created, updated):
    return {
        "product_id": f"{client}_product_{pid}",
        "product_temp_id": f"{client}_producttemp_{pid}",
        "product_sku": sku, "price": price, "category": category,
        "product_type": ptype, "product_name": name, "tags": tags,
        "created_at": created, "updated_at": updated, "capsuite_ref": client,
    }


def transform_product(products, addons, gifts, client):
    rows = []
    for r in products:
        category = ",".join(c["name_translations"]["en"] for c in r.get("categories", [])) or None
        tags = ",".join(r["tags"]) if r.get("tags") else None
        created, updated = _hk_str(r["created_at"]), _hk_str(r["updated_at"])
        if r.get("variations"):
            for v in r["variations"]:
                name = r["title_translations"]["en"] + " - " + ",".join(v["fields_translations"]["en"])
                rows.append(_product_row(client, v["id"], v["sku"], category, "Product",
                                         v["price"]["dollars"], tags, name, created, updated))
        else:
            rows.append(_product_row(client, r["id"], r["sku"], category, "Product",
                                     r["price"]["dollars"], tags, r["title_translations"]["en"], created, updated))
    for r in addons:
        c = _hk_str(r["created_at"])
        rows.append(_product_row(client, r["id"], r["sku"], None, "AddonProduct",
                                 r["price"], None, r["title_translations"]["en"], c, c))
    for r in gifts:
        rows.append(_product_row(client, r["id"], r["sku"], None, "Gift", 0, None,
                                 r["title_translations"]["en"], _hk_str(r["created_at"]), _hk_str(r["updated_at"])))
    if not rows:
        return _empty(PRODUCT_COLUMNS)
    df = pd.DataFrame(rows)
    df["updated_at"] = pd.to_datetime(df["updated_at"], errors="coerce")
    df = (df.sort_values(by="updated_at", ascending=False)
            .drop_duplicates(subset=["product_id"], keep="first").reset_index(drop=True))
    return df.reindex(columns=PRODUCT_COLUMNS)


# --------------------------------------------------------------------------- #
# customer - Shopline customers (keeps gender/birthday: Shopline provides them)
# --------------------------------------------------------------------------- #
def transform_customer(items, client):
    rows = []
    for r in items:
        if r.get("mobile_phone_country_calling_code") and r.get("mobile_phone"):
            phone = r["mobile_phone_country_calling_code"] + r["mobile_phone"]
        elif r.get("phone_country_code") and r.get("phone"):
            phone = r["phone_country_code"] + r["phone"]
        else:
            phone = None
        rows.append({
            "customer_id": f"{client}_cust_{r['id']}",
            "created_at": _hk_str(r["created_at"]) if r.get("created_at") else None,
            "updated_at": _hk_str(r["updated_at"]) if r.get("updated_at") else None,
            "email": r.get("email"),
            "phone": phone,
            "full_name": r.get("name"),
            "gender": r.get("gender"),
            "birthday_year": r.get("birth_year"),
            "birthday_month": r.get("birth_month"),
            "birthday_day": r.get("birth_day"),
            "is_opt_in_email": r.get("is_subscribed_marketing_email"),
            "tags": ",".join(r["tags"]) if r.get("tags") else None,
            "capsuite_ref": client,
        })
    if not rows:
        return _empty(CUSTOMER_COLUMNS)
    df = pd.DataFrame(rows)
    df["updated_at"] = pd.to_datetime(df["updated_at"], errors="coerce")
    df = (df.sort_values(by="updated_at", ascending=False)
            .drop_duplicates(subset=["customer_id"], keep="first").reset_index(drop=True))
    return df.reindex(columns=CUSTOMER_COLUMNS)


# --------------------------------------------------------------------------- #
# inventory_level - per-product stock docs (full snapshot)
# --------------------------------------------------------------------------- #
def transform_inventory_level(stock_docs, client):
    now = datetime.today().astimezone(_HK).strftime("%Y-%m-%d %H:%M:%S.%f%z")
    rows = []
    for doc in stock_docs:
        if doc.get("variations"):
            for v in doc["variations"]:
                for w in v.get("stocks", []):
                    rows.append({"product_id": f"{client}_product_{v['id']}",
                                 "location_id": w["warehouse_id"], "quantity": w["quantity"]})
        else:
            for w in doc.get("stocks", []):
                rows.append({"product_id": f"{client}_product_{doc['id']}",
                             "location_id": w["warehouse_id"], "quantity": w["quantity"]})
    if not rows:
        return _empty(INVENTORY_LEVEL_COLUMNS)
    df = pd.DataFrame(rows)
    df["snapshot_date"] = now
    df["capsuite_ref"] = client
    df = df.drop_duplicates(subset=["product_id", "location_id"], keep="first").reset_index(drop=True)
    df["inventory_level_id"] = pd.RangeIndex(1, len(df) + 1)
    return df.reindex(columns=INVENTORY_LEVEL_COLUMNS)
