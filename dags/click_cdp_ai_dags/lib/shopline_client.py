#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shopline Open API (v1) REST client for the click_cdp_ai pipeline.

Ported from the original build_shopline_landing_* DAGs. Bearer-token auth, simple
page/per_page pagination (the API returns ``pagination.total_pages``). Pure I/O.
"""

import requests

BASE_URL = "https://open.shopline.io/v1"
PER_PAGE = 50


class ShoplineError(RuntimeError):
    pass


class ShoplineClient:
    def __init__(self, access_token, base_url=BASE_URL):
        self.access_token = access_token
        self.base_url = base_url

    @property
    def _headers(self):
        return {"Authorization": f"Bearer {self.access_token}"}

    def _get(self, path, params=None):
        resp = requests.get(f"{self.base_url}{path}", headers=self._headers, params=params or {})
        if resp.status_code != 200:
            raise ShoplineError(f"Shopline GET {path} -> {resp.status_code}: {resp.text}")
        return resp.json()

    def _get_all(self, path, params=None):
        """Fetch all pages of a paginated list endpoint; return the merged items."""
        params = dict(params or {})
        params.update({"page": 1, "per_page": PER_PAGE})
        first = self._get(path, params)
        items = list(first.get("items", []))
        total_pages = (first.get("pagination") or {}).get("total_pages", 1) or 1
        for page in range(2, total_pages + 1):
            params["page"] = page
            items += list(self._get(path, params).get("items", []))
        return items

    # -- list endpoints (updated_after/updated_before window) ----------------- #
    def orders(self, start, end):
        return self._get_all("/orders", {"updated_after": start, "updated_before": end})

    def products(self, start, end):
        return self._get_all("/products", {"updated_after": start, "updated_before": end})

    def addon_products(self):
        return self._get_all("/addon_products")

    def gifts(self):
        return self._get_all("/gifts")

    def customers(self, start, end):
        return self._get_all("/customers", {"updated_after": start, "updated_before": end})

    # -- per-product stock (no pagination) ------------------------------------ #
    def product_stocks(self, product_id):
        """Return the product's stock document ({id, variations[].stocks} or {stocks})."""
        return self._get(f"/products/{product_id}/stocks")
