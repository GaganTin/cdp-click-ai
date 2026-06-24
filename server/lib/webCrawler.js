// Hybrid web crawler for behavioral attributes.
//  • Fast path: HTTP fetch + readability-lite HTML→text extraction.
//  • Fallback : headless browser (Playwright) when the HTTP result looks
//    JS-rendered, bot-blocked, or too thin. Playwright is imported lazily and
//    degrades gracefully (returns the HTTP result) if it isn't installed.
// No external HTML-parsing deps - extraction is regex based, which is plenty
// for turning article pages into plain text for the LLM.

import { createHash } from "crypto";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CHALLENGE_MARKERS = [
  "just a moment", "checking your browser", "enable javascript",
  "cf-browser-verification", "attention required", "captcha",
];

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ".ico", ".pdf"];

export function contentHash(text) {
  return createHash("sha1").update(text || "").digest("hex");
}

// A title is valid when it is at least `minLen` characters (default 1) and contains
// no error markers (404/unavailable). minLen is configurable per workspace.
export function isValidTitle(title, errorStrings = [], minLen = 1) {
  const t = String(title || "").trim();
  if (t.length < (minLen ?? 1)) return false;
  const lower = t.toLowerCase();
  return !errorStrings.some((s) => s && lower.includes(String(s).toLowerCase()));
}

// Percent-decode to readable UTF-8 (e.g. %e6%be%b3 → 澳); safe on malformed input.
export function decodeUrl(u) {
  try { return decodeURIComponent(String(u || "")); } catch { return String(u || ""); }
}

export function normUrl(u) {
  return decodeUrl(String(u || "").split("?")[0]).replace(/\/+$/, "").toLowerCase();
}

/**
 * True if a URL matches any exclusion pattern. A pattern with "*" is treated as
 * a glob (e.g. "/about-company/*"); otherwise it's a case-insensitive substring.
 */
export function matchesExclusion(url, patterns) {
  if (!patterns?.length) return false;
  const u = decodeUrl(String(url || "")).toLowerCase(); // compare on decoded form
  for (const raw of patterns) {
    const pat = decodeUrl(String(raw || "").trim()).toLowerCase();
    if (!pat) continue;
    if (pat.includes("*")) {
      const re = new RegExp(pat.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
      if (re.test(u)) return true;
    } else if (u.includes(pat)) {
      return true;
    }
  }
  return false;
}

/** Strip a raw HTML document down to readable plain text + <title>. */
export function extractText(html) {
  if (!html) return { title: "", text: "" };

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeEntities((titleMatch?.[1] || "").trim());

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|header|footer|aside|form|svg)[\s\S]*?<\/\1>/gi, " ");

  // Keep block boundaries as newlines so the text stays legible
  body = body
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text };
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCharCode(Number(n)); } catch { return ""; }
    });
}

function looksLikeChallenge(title, text) {
  const hay = `${title} ${text.slice(0, 500)}`.toLowerCase();
  return CHALLENGE_MARKERS.some((m) => hay.includes(m));
}

async function fetchHttp(url, { etag, lastModified } = {}) {
  const headers = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" };
  // Conditional GET: if the server says 304 Not Modified we skip download + render.
  if (etag) headers["If-None-Match"] = etag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;
  const resp = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  const html = resp.status === 304 ? "" : await resp.text();
  return {
    status: resp.status,
    html,
    etag: resp.headers.get("etag") || null,
    lastModified: resp.headers.get("last-modified") || null,
  };
}

/**
 * Fetch a site's sitemap(s) and return a Map of normUrl(loc) → lastmod Date (or
 * null when no lastmod). One cheap request reveals the whole site's change set, so
 * callers can skip re-scraping pages whose lastmod is older than last_crawled.
 * Handles sitemap-index files (follows children, bounded). Best-effort.
 */
export async function fetchSitemapLastmod(urlDomain) {
  const map = new Map();
  if (!urlDomain) return map;
  const base = urlDomain.replace(/\/+$/, "");
  const queue = [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`];
  const seen = new Set();
  let budget = 25; // cap sitemap docs fetched
  while (queue.length && budget-- > 0) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    let res;
    try { res = await fetchHttp(sm); } catch { continue; }
    if (res.status !== 200 || !res.html) continue;
    const xml = res.html;
    if (/<sitemapindex/i.test(xml)) {
      for (const l of xml.match(/<loc>([\s\S]*?)<\/loc>/gi) || []) {
        queue.push(l.replace(/<\/?loc>/gi, "").trim());
      }
      continue;
    }
    for (const entry of xml.match(/<url>[\s\S]*?<\/url>/gi) || []) {
      const loc = (entry.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1] || "").trim();
      if (!loc) continue;
      const lm = (entry.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1] || "").trim();
      const d = lm ? new Date(lm) : null;
      map.set(normUrl(loc), d && !isNaN(d.getTime()) ? d : null);
    }
  }
  return map;
}

let _browserPromise = null;
async function getBrowser() {
  if (!_browserPromise) {
    _browserPromise = (async () => {
      const { chromium } = await import("playwright");
      return chromium.launch({ headless: true });
    })();
  }
  return _browserPromise;
}

export async function closeBrowser() {
  if (_browserPromise) {
    try { (await _browserPromise).close(); } catch { /* ignore */ }
    _browserPromise = null;
  }
}

async function fetchBrowser(url) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    const html = await page.content();
    return { status: 200, html };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Crawl a single page. Returns extracted content + which method succeeded.
 * @returns {Promise<{ok:boolean, title:string, text:string, method:string, reason?:string}>}
 */
export async function crawlPage(url, opts = {}) {
  const minLen = opts.minLen ?? 60;
  const errorStrings = opts.errorStrings || [];

  let httpRes = null;
  try {
    httpRes = await fetchHttp(url, { etag: opts.etag, lastModified: opts.lastModified });
  } catch (e) {
    httpRes = { status: 0, html: "", error: String(e.message || e) };
  }

  // Conditional GET hit: page unchanged since last crawl - skip download + render.
  if (httpRes.status === 304) {
    return { ok: true, notModified: true, method: "http", etag: opts.etag, lastModified: opts.lastModified };
  }

  let { title, text } = extractText(httpRes.html);
  let method = "http";
  const thin = text.length < Math.max(minLen, 200);
  const blocked = httpRes.status === 0 || httpRes.status === 403 || httpRes.status === 503;

  // Fall back to a real browser only when the cheap path clearly fell short.
  if (thin || blocked || looksLikeChallenge(title, text)) {
    try {
      const br = await fetchBrowser(url);
      const ex = extractText(br.html);
      if (ex.text.length > text.length) {
        title = ex.title || title;
        text = ex.text;
        method = "browser";
      }
    } catch (e) {
      // Playwright missing / no browser binary / nav failed - keep HTTP result
      if (!text) return { ok: false, title, text: "", method, reason: `browser fallback failed: ${String(e.message || e)}` };
    }
  }

  if (!text || text.length < minLen) {
    return { ok: false, title, text, method, reason: "content too short" };
  }
  const lower = `${title}\n${text}`.toLowerCase();
  if (errorStrings.some((s) => s && lower.includes(String(s).toLowerCase()))) {
    return { ok: false, title, text, method, reason: "matched error string" };
  }

  return { ok: true, title, text, method, etag: httpRes.etag, lastModified: httpRes.lastModified };
}

/**
 * Discover candidate page URLs for a company: every distinct GA
 * path_exploration location seen in the last `lookbackDays` (filtered by
 * url_pattern) unioned with sitemap.xml entries. No page cap unless `limit`
 * is passed. Returns normalised, de-duplicated http(s) URLs.
 */
export async function discoverUrls(pool, { companyId, urlPattern, urlDomain, limit = null, lookbackDays = 90, excludedPatterns = [] }) {
  const seen = new Set();
  const out = [];

  const add = (raw) => {
    if (!raw) return;
    let u = String(raw).trim();
    if (!/^https?:\/\//i.test(u)) return;
    if (IMAGE_EXTS.some((e) => u.toLowerCase().split("?")[0].endsWith(e))) return;
    if (matchesExclusion(u, excludedPatterns)) return;
    const key = normUrl(u);
    if (!key || key.length < 12 || seen.has(key)) return;
    seen.add(key);
    out.push(decodeUrl(u.split("?")[0])); // store readable (decoded) form
  };

  // 1) All distinct GA page locations FOR THIS COMPANY in the lookback window
  //    (most-visited first). Company-scoped - never mix another tenant's pages.
  if (companyId) {
    try {
      const params = [companyId];
      let where = "company_id = $1 AND page_location IS NOT NULL AND page_location <> ''";
      if (urlPattern) {
        params.push(`%${urlPattern}%`);
        where += ` AND page_location ILIKE $${params.length}`;
      }
      if (lookbackDays && lookbackDays > 0) {
        const d = new Date(Date.now() - lookbackDays * 86_400_000);
        const cutoff = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
        params.push(cutoff);
        where += ` AND date >= $${params.length}`;
      }
      const { rows } = await pool.query(
        `SELECT page_location, COUNT(*) AS hits
         FROM ga_landing.path_exploration
         WHERE ${where}
         GROUP BY page_location
         ORDER BY hits DESC`,
        params
      );
      for (const r of rows) add(r.page_location);
    } catch (e) {
      console.warn("[crawler] GA discovery failed (non-fatal):", e.message);
    }
  }

  // 2) sitemap.xml (best-effort)
  if (urlDomain) {
    const base = urlDomain.replace(/\/+$/, "");
    try {
      const res = await fetchHttp(`${base}/sitemap.xml`);
      if (res.status === 200) {
        const locs = res.html.match(/<loc>([\s\S]*?)<\/loc>/gi) || [];
        for (const l of locs) add(l.replace(/<\/?loc>/gi, "").trim());
      }
    } catch { /* no sitemap - fine */ }
  }

  return limit ? out.slice(0, limit) : out;
}
