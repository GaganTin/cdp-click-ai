#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shopify GraphQL Admin API (2024-04) bulk-operation client for click_cdp_ai.

The original Shopify landing DAGs copy-pasted the same three steps ~7 times:
  1. ``bulkOperationRunQuery`` mutation (an inner query string),
  2. poll ``currentBulkOperation`` (exponential backoff) until a result ``url``,
  3. download the NDJSON and parse it into a list of dicts.

``ShopifyClient.run_bulk_query`` encapsulates that. Each dataset's inner query is
a module-level ``*_query(start, end)`` builder ported verbatim from the originals.
No Airflow, no Blob, no Mongo — pure I/O so it is unit-testable.
"""

import json
import random
import time
from datetime import datetime, timezone

import requests
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

_log = get_logger("shopify")

SHOPIFY_API_VERSION = "2024-04"

_BULK_RUN_MUTATION = """
    mutation bulkOperationRunQuery($query: String!) {
        bulkOperationRunQuery(query: $query) {
            bulkOperation { id status }
            userErrors { field message }
        }
    }
"""

_CURRENT_BULK_QUERY = """
    query {
        currentBulkOperation {
            id status errorCode createdAt completedAt
            objectCount fileSize url partialDataUrl
        }
    }
"""

_BULK_CANCEL_MUTATION = """
    mutation bulkOperationCancel($id: ID!) {
        bulkOperationCancel(id: $id) {
            bulkOperation { id status }
            userErrors { field message }
        }
    }
"""

# Statuses that occupy the store's single bulk-op slot (a new run is rejected
# while any of these is the currentBulkOperation).
_BULK_IN_PROGRESS = ("CREATED", "RUNNING", "CANCELING")

# Refund line items via a REGULAR (non-bulk) paginated query. Bulk operations
# reject a connection (refundLineItems) nested in a list field (Order.refunds),
# so refund lines can't ride the bulk path -- a normal query allows it. Page
# sizes are kept small to bound the GraphQL query cost; tune if a store trips
# MAX_COST. Inner refundLineItems is capped at 100 per refund (rare to exceed).
_REFUND_LINES_QUERY = """
    query refundLines($cursor: String, $orderQuery: String!) {
        orders(first: 10, after: $cursor, query: $orderQuery) {
            pageInfo { hasNextPage endCursor }
            edges { node {
                id
                refunds {
                    id
                    refundLineItems(first: 100) { edges { node {
                        quantity
                        restockType
                        subtotalSet { shopMoney { amount currencyCode } }
                        lineItem { id sku variant { id } }
                    } } }
                }
            } }
        }
    }
"""


class ShopifyError(RuntimeError):
    """Raised on Shopify userErrors / non-200 / failed or timed-out bulk op."""


class ShopifyClient:
    def __init__(self, store_name, access_token, api_version=SHOPIFY_API_VERSION,
                 max_poll_tries=120, max_poll_sleep=60, stale_op_seconds=120):
        # The App DB stores the full host (e.g. "x.myshopify.com"); strip it so
        # we never end up with "x.myshopify.com.myshopify.com".
        host = (store_name or "").strip()
        if host.endswith(".myshopify.com"):
            host = host[: -len(".myshopify.com")]
        self.store_name = host
        self.access_token = access_token
        self.api_version = api_version
        self.max_poll_tries = max_poll_tries
        self.max_poll_sleep = max_poll_sleep
        self.stale_op_seconds = stale_op_seconds
        self._endpoint = (
            f"https://{host}.myshopify.com/admin/api/{api_version}/graphql.json"
        )

    @property
    def _headers(self):
        return {
            "X-Shopify-Access-Token": self.access_token,
            "Content-Type": "application/json",
        }

    def _post(self, query, variables=None):
        payload = {"query": query}
        if variables is not None:
            payload["variables"] = variables
        resp = requests.post(self._endpoint, headers=self._headers, json=payload)
        if resp.status_code != 200:
            raise ShopifyError(f"Shopify HTTP {resp.status_code}: {resp.text}")
        return resp.json()

    @staticmethod
    def _op_age_seconds(created_at):
        """Seconds since a bulk op's ``createdAt`` (ISO-8601), or None if unparseable."""
        if not created_at:
            return None
        try:
            ts = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError:
            return None
        return (datetime.now(timezone.utc) - ts).total_seconds()

    def _clear_stale_bulk_op(self):
        """Free the store's single bulk-op slot before starting a new operation.

        Shopify allows ONE bulk query per app+shop. A prior attempt's pod can die
        (timeout/eviction) while its bulk op keeps running server-side; the retry
        then hits ``bulkOperationRunQuery userErrors: ... already in progress`` and
        every retry collides with that orphan -> the task can never recover.

        Pre-flight: if an op is in progress AND older than ``stale_op_seconds``,
        treat it as an orphan and cancel it (polling until the slot frees). A
        freshly-created op (younger than the threshold) is assumed to belong to a
        legitimately-running parallel task on the SAME store, so we raise instead
        of cancelling it -- Airflow retries later once it finishes. Different
        clients are different stores (separate token + endpoint), so this can
        never touch another store's operation.
        """
        current = self._post(_CURRENT_BULK_QUERY)["data"]["currentBulkOperation"]
        if not current or current.get("status") not in _BULK_IN_PROGRESS:
            return
        op_id = current.get("id")
        age = self._op_age_seconds(current.get("createdAt"))
        if age is not None and age < self.stale_op_seconds:
            raise ShopifyError(
                f"Bulk op already in progress on {self.store_name} "
                f"(id={op_id}, age={age:.0f}s < {self.stale_op_seconds}s); "
                "assuming a parallel sync owns it -- will retry later."
            )
        _log.warning(
            "Cancelling stale bulk op %s on %s (status=%s, age=%s)",
            op_id, self.store_name, current.get("status"),
            "unknown" if age is None else f"{age:.0f}s",
        )
        self._post(_BULK_CANCEL_MUTATION, {"id": op_id})
        # Poll until the slot is free (status leaves the in-progress set).
        for _ in range(self.max_poll_tries):
            cur = self._post(_CURRENT_BULK_QUERY)["data"]["currentBulkOperation"]
            if not cur or cur.get("status") not in _BULK_IN_PROGRESS:
                _log.info("Stale bulk op %s cleared", op_id)
                return
            time.sleep(min(2 ** 2, self.max_poll_sleep) + random.uniform(0, 1))
        raise ShopifyError(f"Stale bulk op {op_id} did not clear in time")

    def run_bulk_query(self, inner_query):
        """Run one bulk operation and return the parsed NDJSON records.

        Returns ``[]`` when the operation completes with no objects. Each record
        is a dict that may carry ``__parentId`` (the bulk-op flattening marker).
        """
        # Step 0: clear any orphaned bulk op left running on this store.
        self._clear_stale_bulk_op()
        # Step 1: start the bulk operation.
        result = self._post(_BULK_RUN_MUTATION, {"query": inner_query})
        run = result.get("data", {}).get("bulkOperationRunQuery", {})
        user_errors = run.get("userErrors") or []
        if user_errors:
            raise ShopifyError(f"bulkOperationRunQuery userErrors: {user_errors}")
        _log.info(f"Bulk operation {run.get('bulkOperation', {}).get('id')} created")

        # Step 2: poll until a result url is ready (or completed-empty).
        data_url = None
        for num_tries in range(1, self.max_poll_tries + 1):
            _log.info(f"Polling bulk operation, try {num_tries}/{self.max_poll_tries}")
            current = self._post(_CURRENT_BULK_QUERY)["data"]["currentBulkOperation"]
            status = current.get("status")
            if status in ("FAILED", "CANCELED", "EXPIRED"):
                raise ShopifyError(
                    f"Bulk operation {status}: errorCode={current.get('errorCode')}"
                )
            if status == "COMPLETED" and current.get("objectCount") == "0":
                _log.warning("Bulk operation completed but no data found")
                return []
            data_url = current.get("url")
            if data_url:
                _log.info(f"Total objects: {current.get('objectCount')}")
                break
            # Exponential backoff CAPPED at max_poll_sleep: a big first backfill
            # can take many minutes, and an uncapped 2**n sleep would overshoot
            # by hours once n grows. Capped, 120 tries ≈ 2 hours of patience
            # with at most ~1 minute of detection lag.
            time.sleep(min(2 ** num_tries, self.max_poll_sleep) + random.uniform(0, 1))
        if not data_url:
            raise ShopifyError(
                f"Bulk operation did not finish within {self.max_poll_tries} polls"
            )

        # Step 3: download and parse the NDJSON.
        resp = requests.get(data_url)
        if resp.status_code != 200:
            raise ShopifyError(f"Download HTTP {resp.status_code}: {resp.text}")
        return [json.loads(line) for line in resp.text.splitlines() if line.strip()]

    def _post_graphql(self, query, variables, max_retries=8):
        """POST a regular (non-bulk) GraphQL query.

        Retries on THROTTLED (cost throttling is returned as HTTP 200 with an
        ``errors`` entry, not a 429); raises on any other GraphQL error.
        """
        for attempt in range(1, max_retries + 1):
            result = self._post(query, variables)
            errors = result.get("errors")
            if not errors:
                return result
            codes = {(e.get("extensions") or {}).get("code") for e in errors}
            if "THROTTLED" in codes and attempt < max_retries:
                time.sleep(2 ** attempt * 0.5 + random.uniform(0, 1))
                continue
            raise ShopifyError(f"GraphQL errors: {errors}")
        raise ShopifyError("GraphQL throttled: retries exhausted")

    def fetch_order_refund_lines(self, start, end):
        """Return order nodes carrying inline refunds + refundLineItems edges.

        Uses the regular paginated query (not a bulk op) so refund line items --
        a connection nested under the ``Order.refunds`` list -- can be fetched.
        The returned shape (``{id, refunds: [{id, refundLineItems: {edges}}]}``)
        is exactly what ``transform_refund_line`` consumes.
        """
        order_query = _window(start, end)
        cursor = None
        nodes = []
        while True:
            data = self._post_graphql(
                _REFUND_LINES_QUERY, {"cursor": cursor, "orderQuery": order_query}
            )
            orders = (data.get("data") or {}).get("orders") or {}
            for edge in orders.get("edges") or []:
                node = edge.get("node")
                if node:
                    nodes.append(node)
            page_info = orders.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                break
            cursor = page_info.get("endCursor")
        _log.info(f"[shopify] refund_line: fetched {len(nodes)} order nodes (non-bulk)")
        return nodes


# --------------------------------------------------------------------------- #
# Inner query builders (ported verbatim from the original DAGs)
# --------------------------------------------------------------------------- #
def _window(start, end):
    return f"updated_at:>='{start}' AND updated_at:<='{end}'"


def orders_query(start, end):
    return f"""
    {{
        orders(query: "{_window(start, end)}") {{
            edges {{ node {{
                id
                customer {{ id }}
                name
                createdAt
                currentTotalPriceSet {{ shopMoney {{ amount currencyCode }} }}
                totalRefundedSet {{ shopMoney {{ amount currencyCode }} }}
                netPaymentSet {{ shopMoney {{ amount currencyCode }} }}
                displayFinancialStatus
                displayFulfillmentStatus
            }} }}
        }}
    }}
    """


def order_lines_query(start, end):
    return f"""
    {{
        orders(query: "{_window(start, end)}") {{
            edges {{ node {{
                id
                customer {{ id displayName }}
                lineItems {{ edges {{ node {{
                    id
                    quantity
                    currentQuantity
                    originalUnitPriceSet {{ shopMoney {{ amount currencyCode }} }}
                    discountedUnitPriceSet {{ shopMoney {{ amount currencyCode }} }}
                    product {{ title }}
                    variant {{ id sku title }}
                }} }} }}
                shippingLines {{ edges {{ node {{
                    id
                    discountedPriceSet {{ shopMoney {{ amount currencyCode }} }}
                    originalPriceSet {{ shopMoney {{ amount currencyCode }} }}
                }} }} }}
                createdAt
                currentTotalPriceSet {{
                    presentmentMoney {{ amount currencyCode }}
                    shopMoney {{ amount currencyCode }}
                }}
            }} }}
        }}
    }}
    """


def products_query(start, end):
    return f"""
    {{
        products(query: "{_window(start, end)}") {{
            edges {{ node {{
                id
                createdAt
                updatedAt
                title
                handle
                tags
                productType
                productCategory {{ productTaxonomyNode {{ id fullName name }} }}
                featuredImage {{ id url }}
                variantsCount {{ count }}
                variants {{ edges {{ node {{
                    id createdAt updatedAt sku price title
                }} }} }}
            }} }}
        }}
    }}
    """


def product_image_query(start, end):
    return f"""
    {{
        products(query: "{_window(start, end)}") {{
            edges {{ node {{
                id
                createdAt
                updatedAt
                title
                handle
                featuredImage {{ id url }}
                variants {{ edges {{ node {{ id sku }} }} }}
            }} }}
        }}
    }}
    """


def collections_query(start, end):
    return f"""
    {{
        collections(query: "{_window(start, end)}") {{
            edges {{ node {{
                id
                title
                products {{ edges {{ node {{
                    id
                    variants {{ edges {{ node {{ id }} }} }}
                }} }} }}
            }} }}
        }}
    }}
    """


def customers_query(start, end):
    return f"""
    {{
        customers(query: "{_window(start, end)}") {{
            edges {{ node {{
                id
                createdAt
                updatedAt
                email
                phone
                firstName
                lastName
                emailMarketingConsent {{ marketingState }}
                smsMarketingConsent {{ marketingState }}
                tags
            }} }}
        }}
    }}
    """


def refunds_query(start, end):
    """Order-level refund summary for the BULK op (one node per order, refunds inline).

    ``refundLineItems`` is intentionally excluded: it is a connection, and bulk
    operations reject a connection nested inside a list field (``Order.refunds``).
    Refund line items are fetched separately via the regular paginated query
    ``ShopifyClient.fetch_order_refund_lines``. ``transform_refund`` only needs
    these order-level scalars.
    """
    return f"""
    {{
        orders(query: "{_window(start, end)}") {{
            edges {{ node {{
                id
                refunds {{
                    id
                    createdAt
                    note
                    totalRefundedSet {{ shopMoney {{ amount currencyCode }} }}
                }}
            }} }}
        }}
    }}
    """


def product_variants_inventory_query(start, end):
    return f"""
    {{
        productVariants(query: "{_window(start, end)}") {{
            edges {{ node {{
                id
                inventoryQuantity
                inventoryItem {{ inventoryLevels {{ edges {{ node {{
                    location {{ id }}
                    quantities(names: "available") {{ quantity updatedAt }}
                }} }} }} }}
            }} }}
        }}
    }}
    """
