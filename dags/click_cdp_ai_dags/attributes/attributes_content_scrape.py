#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Robust web-content scraper for the CDP Content-attributes feature.

This is the Phase-2 "engine" behind the app's Content tab. It does ONLY the
bot-resistant scraping (undetected-chromedriver + Xvfb + Cloudflare wait) and
writes title/content/validity into Postgres ``app.web_pages``. The Node app keeps
doing LLM tagging + review-queue + propagation; once this DAG finishes it pings a
webhook so the app can run the tag phase for the pages that changed.

Triggering (matches the existing integration-sync pattern in the Node app):
    POST {AIRFLOW_BASE_URL}/api/v1/dags/cdp_click_ai_attributes_content_scrape/dagRuns
    conf = {
        "str_client_name": "<capsuite_ref>",   # required
        "company_id":      "<uuid>",           # optional (resolved from capsuite_ref)
        "job_id":          "<attribute_jobs.id>",  # optional, echoed to the webhook
        "page_urls":       ["https://…", …],    # optional → per-page re-scrape only
        "is_debugging":    false,
        "dag_run_id":      "<id>"
    }

On completion it POSTs to:
    {CDP_ENDPOINT}/api/attributes/webhook/scrape-complete
    { dag_run_id, company_id, job_id, scraped, changed, status }

Storage: Postgres only, via lib/config.get_pg_conn_kwargs() (same DB as the app;
writes to the ``app`` schema, scoped by company_id).
"""

import os
import time
import json
import subprocess
import urllib.parse
from datetime import datetime, timedelta
from hashlib import sha1

import requests
import psycopg2
from psycopg2.extras import RealDictCursor

from airflow.decorators import dag, task
from airflow.models import Variable
from airflow.models.param import Param

from dags.click_cdp_ai_dags.lib import config as ga_config
from dags.click_cdp_ai_dags.lib import ga_reports as tf
from dags.click_cdp_ai_dags.lib.log import get_logger, ctx

os.environ["no_proxy"] = "*"

_log = get_logger("attributes")

DISCOVERY_LOOKBACK_DAYS = 90
RECRAWL_AFTER_HOURS = 24
CRAWL_CONCURRENCY = 1          # one Selenium session per worker; pages done serially
MAX_DRIVER_RESTARTS = 3
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ".ico", ".pdf")
_CLOUDFLARE_TITLES = {"just a moment...", "attention required", "one more step"}


# ── small helpers ────────────────────────────────────────────────────────────
def _content_hash(text):
    return sha1((text or "").encode("utf-8")).hexdigest()


def _norm_url(u):
    return urllib.parse.unquote(str(u or "").split("?")[0]).rstrip("/").lower()


def _matches_exclusion(url, patterns):
    if not patterns:
        return False
    u = urllib.parse.unquote(str(url or "")).lower()
    for raw in patterns:
        pat = urllib.parse.unquote(str(raw or "").strip()).lower()
        if not pat:
            continue
        if "*" in pat:
            import re
            rx = ".*".join(re.escape(seg) for seg in pat.split("*"))
            if re.search(rx, u):
                return True
        elif pat in u:
            return True
    return False


def _is_valid_content(content, min_len, error_strings):
    if not content or len(content) < (min_len or 60):
        return False
    low = content.lower()
    return not any(e and str(e).lower() in low for e in (error_strings or []))


def _is_valid_title(title, error_strings):
    t = (title or "").strip()
    if len(t) < 5:
        return False
    low = t.lower()
    return not any(e and str(e).lower() in low for e in (error_strings or []))


# ── Selenium driver (ported from build_analytic_web_content_attributes.py) ────
def _chrome_major_version():
    import re
    for binary in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        try:
            out = subprocess.check_output([binary, "--version"], stderr=subprocess.DEVNULL).decode()
            m = re.search(r"(\d+)\.", out)
            if m:
                return int(m.group(1))
        except Exception:
            continue
    return None


def _get_driver():
    import undetected_chromedriver as uc
    display = os.environ.get("DISPLAY", ":99")
    subprocess.Popen(["Xvfb", display, "-screen", "0", "1920x1080x24"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    chrome_version = _chrome_major_version()
    options = uc.ChromeOptions()
    for arg in ("--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
                "--disable-notifications", "--window-size=1920,1080"):
        options.add_argument(arg)
    options.add_argument(
        f"--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        f"(KHTML, like Gecko) Chrome/{chrome_version or 124}.0.0.0 Safari/537.36"
    )
    # headless=False is intentional - headless is trivially fingerprinted by Cloudflare.
    return uc.Chrome(options=options, headless=False, use_subprocess=True, version_main=chrome_version)


class _DriverDead(Exception):
    pass


def _wait_for_cloudflare(driver, max_wait=30):
    deadline = time.time() + max_wait
    while time.time() < deadline:
        if not any(cf in driver.title.lower() for cf in _CLOUDFLARE_TITLES):
            return True
        time.sleep(3)
    return False


def _extract_og_updated(driver):
    from selenium.webdriver.common.by import By
    for sel in ("meta[property='og:updated_time']", "meta[name='og:updated_time']",
                "meta[property='article:modified_time']"):
        try:
            for el in driver.find_elements(By.CSS_SELECTOR, sel):
                c = el.get_attribute("content")
                if c:
                    return c
        except Exception:
            continue
    return None


def _get_page(driver, url):
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    try:
        driver.get(url)
        WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        _wait_for_cloudflare(driver, max_wait=30)
        title = driver.title
        body = driver.find_element(By.TAG_NAME, "body").text
        og = _extract_og_updated(driver)
        cleaned = "\n".join(l.strip() for l in body.splitlines() if l.strip())
        return cleaned, title, og
    except Exception as e:
        err = str(e)
        if any(k in err for k in ("Connection refused", "NewConnectionError", "Max retries exceeded")):
            raise _DriverDead(err) from e
        _log.error(f"[scrape] error on {url}: {err}")
        return None, None, None


# ── Cheap change-detection (avoid rendering unchanged pages) ───────────────────
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def _fetch_sitemap_lastmod(url_domain):
    """One sitemap fetch → {normUrl(loc): lastmod datetime|None} for the whole site,
    so we can skip pages whose <lastmod> is older than our last crawl. Follows
    sitemap-index children (bounded). Best-effort → empty dict on failure."""
    import re
    out = {}
    if not url_domain:
        return out
    base = url_domain.rstrip("/")
    queue = [base + "/sitemap.xml", base + "/sitemap_index.xml"]
    seen, budget = set(), 25
    while queue and budget > 0:
        budget -= 1
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        try:
            r = requests.get(sm, timeout=20, headers={"User-Agent": _UA})
        except Exception:
            continue
        if r.status_code != 200 or not r.text:
            continue
        xml = r.text
        if re.search(r"<sitemapindex", xml, re.I):
            for loc in re.findall(r"<loc>([\s\S]*?)</loc>", xml, re.I):
                queue.append(loc.strip())
            continue
        for entry in re.findall(r"<url>[\s\S]*?</url>", xml, re.I):
            loc_m = re.search(r"<loc>([\s\S]*?)</loc>", entry, re.I)
            if not loc_m:
                continue
            lm_m = re.search(r"<lastmod>([\s\S]*?)</lastmod>", entry, re.I)
            d = None
            if lm_m:
                try:
                    d = datetime.fromisoformat(lm_m.group(1).strip().replace("Z", "+00:00"))
                except Exception:
                    d = None
            out[_norm_url(loc_m.group(1).strip())] = d
    return out


def _http_meta(url, etag=None, last_modified=None):
    """Conditional GET. Returns {status, etag, last_modified}; status 304 means the
    page is unchanged (skip the Selenium render). Also captures fresh validators to
    store for next time. Cheap (no browser)."""
    headers = {"User-Agent": _UA}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    try:
        r = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
        return {"status": r.status_code, "etag": r.headers.get("ETag"), "last_modified": r.headers.get("Last-Modified")}
    except Exception:
        return {"status": 0, "etag": None, "last_modified": None}


# ── Postgres ──────────────────────────────────────────────────────────────────
def _connect():
    kwargs = ga_config.get_pg_conn_kwargs()
    if not kwargs:
        raise RuntimeError("Postgres connection not configured (cdp_pg_* Variables).")
    return psycopg2.connect(**kwargs)


def _resolve_company_id(conn, capsuite_ref, company_id):
    if company_id:
        return company_id
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM app.companies WHERE capsuite_ref = %s", (capsuite_ref,))
        row = cur.fetchone()
    return str(row[0]) if row else None


def _load_crawl_config(conn, company_id):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """SELECT url_pattern, error_strings, valid_content_min_length,
                      ga_lookback_days, excluded_url_patterns
               FROM app.web_content_html_elements WHERE company_id = %s
               ORDER BY created_date ASC LIMIT 1""", (company_id,))
        cfg = cur.fetchone() or {}
        cur.execute(
            """SELECT url_domain FROM app.company_report_config WHERE company_id = %s
               ORDER BY created_date ASC LIMIT 1""", (company_id,))
        dom = cur.fetchone() or {}
    cfg = dict(cfg)
    cfg["url_domain"] = (dom or {}).get("url_domain", "")
    return cfg


def _discover_urls(conn, company_id, cfg):
    """GA path_exploration (most-visited first) + sitemap.xml, filtered + deduped."""
    out, seen = [], set()
    excluded = cfg.get("excluded_url_patterns") or []

    def add(raw):
        u = str(raw or "").strip()
        if not u.lower().startswith(("http://", "https://")):
            return
        if u.split("?")[0].lower().endswith(IMAGE_EXTS):
            return
        if _matches_exclusion(u, excluded):
            return
        k = _norm_url(u)
        if not k or len(k) < 12 or k in seen:
            return
        seen.add(k)
        out.append(urllib.parse.unquote(u.split("?")[0]))

    params = [company_id]
    where = "company_id = %s AND page_location IS NOT NULL AND page_location <> ''"
    if cfg.get("url_pattern"):
        params.append(f"%{cfg['url_pattern']}%")
        where += " AND page_location ILIKE %s"
    lookback = cfg.get("ga_lookback_days") or DISCOVERY_LOOKBACK_DAYS
    if lookback and lookback > 0:
        cutoff = (datetime.utcnow() - timedelta(days=lookback)).strftime("%Y%m%d")
        params.append(cutoff)
        where += " AND date >= %s"
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT page_location, COUNT(*) AS hits FROM ga_landing.path_exploration
                    WHERE {where} GROUP BY page_location ORDER BY hits DESC""", params)
            for loc, _ in cur.fetchall():
                add(loc)
    except Exception as e:
        _log.error(f"[scrape] GA discovery failed (non-fatal): {e}")

    domain = cfg.get("url_domain")
    if domain:
        try:
            r = requests.get(f"{domain.rstrip('/')}/sitemap.xml", timeout=20)
            if r.status_code == 200:
                import re
                for loc in re.findall(r"<loc>([\s\S]*?)</loc>", r.text, flags=re.I):
                    add(loc.strip())
        except Exception:
            pass
    return out


def _upsert_page(conn, company_id, url, content, title, og, cfg, etag=None, last_modified=None):
    valid_content = _is_valid_content(content, cfg.get("valid_content_min_length"), cfg.get("error_strings"))
    valid_title = _is_valid_title(title, cfg.get("error_strings"))
    h = _content_hash(content or "")
    og_ts = None
    if og:
        try:
            og_ts = datetime.fromisoformat(og.replace("Z", "+00:00"))
        except Exception:
            og_ts = None
    meta = json.dumps({
        "crawl_reason": None if valid_content else "invalid/empty content",
        "http_etag": etag,
        "http_last_modified": last_modified,
    })
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO app.web_pages
                 (company_id, url, title, content, excerpt, content_hash, word_count,
                  is_valid, is_valid_content, is_valid_title, og_updated_time, needs_retag,
                  fetch_method, last_crawled, metadata)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,'browser',NOW(),%s::jsonb)
               ON CONFLICT (company_id, url) DO UPDATE SET
                 title = EXCLUDED.title, content = EXCLUDED.content, excerpt = EXCLUDED.excerpt,
                 content_hash = EXCLUDED.content_hash, word_count = EXCLUDED.word_count,
                 is_valid = EXCLUDED.is_valid, is_valid_content = EXCLUDED.is_valid_content,
                 is_valid_title = EXCLUDED.is_valid_title, og_updated_time = EXCLUDED.og_updated_time,
                 needs_retag = app.web_pages.needs_retag
                               OR (app.web_pages.content_hash IS DISTINCT FROM EXCLUDED.content_hash),
                 fetch_method = 'browser', last_crawled = NOW(),
                 metadata = app.web_pages.metadata || EXCLUDED.metadata
               RETURNING (xmax = 0) AS inserted, needs_retag""",
            (company_id, url, title or "", content or "", (content or "")[:600], h,
             len((content or "").split()), valid_content and valid_title, valid_content,
             valid_title, og_ts, meta))
        row = cur.fetchone()
    # changed = newly inserted OR the upsert flagged it for re-tag (content differed)
    return bool(row and (row[0] or row[1]))


# Live progress: merge {pages_total, pages_crawled, …} into the attribute_jobs row
# so the app's crawl UI can show "X/Y crawled" (and updated_date keeps the job from
# being treated as stale). Best-effort - a progress write must never abort a scrape.
def _set_job_progress(conn, job_id, patch):
    if not job_id:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE app.attribute_jobs
                   SET progress = COALESCE(progress, '{}'::jsonb) || %s::jsonb,
                       updated_date = NOW()
                   WHERE id = %s AND status IN ('queued', 'running')""",
                (json.dumps(patch), job_id))
    except Exception as e:
        _log.warning(f"[scrape] progress update failed: {e}")


# ── DAG ───────────────────────────────────────────────────────────────────────
@dag(
    schedule=None,
    start_date=datetime(2024, 1, 1),
    max_active_runs=1,
    catchup=False,
    tags=["cdp-click-ai", "attributes", "web_content", "content_scrape"],
    owner_links={"capsuite": "https://capsuite.co"},
    params={
        "str_client_name": Param(None, type=["string", "null"]),
        "company_id":      Param(None, type=["string", "null"]),
        "job_id":          Param(None, type=["string", "null"]),
        "page_urls":       Param(None, type=["array", "null"]),
        "is_debugging":    Param(False, type=["boolean", "string"]),
        "dag_run_id":      Param(None, type=["string", "null"]),
    },
    on_failure_callback=tf.on_dag_failure_callback,
)
def cdp_click_ai_attributes_content_scrape():

    @task(retries=2, retry_delay=timedelta(seconds=10))
    def scrape(**context):
        params = (context["dag_run"].conf or {})
        capsuite_ref = params.get("str_client_name")
        if not capsuite_ref:
            _log.warning("No str_client_name provided; nothing to scrape.")
            return {"scraped": 0, "changed": 0}

        page_urls = params.get("page_urls") or None
        conn = _connect()
        conn.autocommit = True
        try:
            company_id = _resolve_company_id(conn, capsuite_ref, params.get("company_id"))
            if not company_id:
                raise RuntimeError(f"No company for capsuite_ref={capsuite_ref}")
            cfg = _load_crawl_config(conn, company_id)

            job_id = params.get("job_id")
            if page_urls:
                urls = [urllib.parse.unquote(str(u).split("?")[0]) for u in page_urls if u]
            else:
                urls = _discover_urls(conn, company_id, cfg)
            _log.info(f"[scrape] {capsuite_ref}: {len(urls)} candidate URLs")
            # Publish the total up front so the UI shows "0/Y crawled" immediately.
            _set_job_progress(conn, job_id, {"pages_total": len(urls), "pages_crawled": 0})

            # incremental skip set: last_crawled + validity + stored HTTP validators
            fresh = {}
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT url, last_crawled, is_valid,
                              metadata->>'http_etag', metadata->>'http_last_modified'
                       FROM app.web_pages WHERE company_id = %s""",
                    (company_id,))
                for u, lc, iv, et, lm in cur.fetchall():
                    fresh[_norm_url(u)] = {"lc": lc, "iv": iv, "etag": et, "lm": lm}

            # One sitemap fetch reveals the whole site's change set (skip explicit re-runs).
            lastmod_map = {} if page_urls else _fetch_sitemap_lastmod(cfg.get("url_domain"))

            driver = _get_driver()
            restarts = 0
            scraped = changed = skipped = 0
            i = 0
            while i < len(urls):
                # Heartbeat the processed count every 10 URLs (this also bumps
                # updated_date so a long crawl isn't reset as stale).
                if job_id and i % 10 == 0:
                    _set_job_progress(conn, job_id, {"pages_crawled": i})
                url = urls[i]
                nu = _norm_url(url)
                prev = fresh.get(nu)
                # Skip checks only apply to a full discovery run, never an explicit re-scrape.
                if not page_urls and prev and prev["lc"] and prev["iv"]:
                    # a) recently crawled
                    if (datetime.now(prev["lc"].tzinfo) - prev["lc"]) < timedelta(hours=RECRAWL_AFTER_HOURS):
                        i += 1; skipped += 1; continue
                    # b) sitemap says unchanged since last crawl
                    lm = lastmod_map.get(nu)
                    if lm and lm <= prev["lc"]:
                        i += 1; skipped += 1; continue
                # c) conditional GET (304) - also captures fresh validators to store
                hm = ({"status": 200, "etag": None, "last_modified": None} if page_urls
                      else _http_meta(url, (prev or {}).get("etag"), (prev or {}).get("lm")))
                if hm["status"] == 304:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE app.web_pages SET last_crawled = NOW() WHERE company_id = %s AND url = %s", (company_id, url))
                    i += 1; skipped += 1; continue
                try:
                    content, title, og = _get_page(driver, url)
                    if content is not None:
                        if _upsert_page(conn, company_id, url, content, title, og, cfg,
                                        etag=hm.get("etag"), last_modified=hm.get("last_modified")):
                            changed += 1
                        scraped += 1
                    i += 1
                except _DriverDead as e:
                    _log.info(f"[scrape] driver dead at {url}: {e}")
                    try:
                        driver.quit()
                    except Exception:
                        pass
                    if restarts >= MAX_DRIVER_RESTARTS:
                        _log.info("[scrape] max restarts reached; saving partial progress.")
                        break
                    restarts += 1
                    driver = _get_driver()
                    # do not advance i: retry the same URL
            try:
                driver.quit()
            except Exception:
                pass
            _set_job_progress(conn, job_id, {"pages_crawled": i, "pages_skipped": skipped})
            _log.info(f"[scrape] {capsuite_ref}: scraped={scraped} changed={changed} skipped={skipped}")
            return {"company_id": company_id, "job_id": params.get("job_id"),
                    "dag_run_id": params.get("dag_run_id"), "scraped": scraped, "changed": changed, "skipped": skipped}
        finally:
            conn.close()

    @task(trigger_rule="all_done")
    def notify(result, **context):
        """Tell the Node app the scrape is done so it can run the tag phase."""
        endpoint = Variable.get("cdp_ai_endpoint", default_var=os.environ.get("CDP_ENDPOINT", ""))
        if not endpoint or not result:
            _log.warning("No cdp_endpoint or result; skipping webhook.")
            return True
        payload = {
            "dag_run_id": result.get("dag_run_id"),
            "company_id": result.get("company_id"),
            "job_id": result.get("job_id"),
            "scraped": result.get("scraped", 0),
            "changed": result.get("changed", 0),
            "status": "success",
        }
        try:
            r = requests.post(f"{endpoint.rstrip('/')}/api/attributes/webhook/scrape-complete",
                              json=payload, timeout=30)
            _log.info(f"[scrape] webhook → {r.status_code}")
        except Exception as e:
            _log.error(f"[scrape] webhook failed: {e}")
        return True

    notify(scrape())


dag_cdp_click_ai_attributes_content_scrape = cdp_click_ai_attributes_content_scrape()
