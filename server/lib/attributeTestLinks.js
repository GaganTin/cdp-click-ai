// Managed test-link set for the Content-tab "Test" tab.
//  • Manual: users upload up to MAX_TEST_LINKS URLs.
//  • Auto (GA): top pages by traffic over the last 30 days. The expensive GROUP BY
//    over event-level ga_landing.path_exploration is precomputed into the
//    app.web_content_page_rank rollup (nightly / on rebuild); reads + the daily
//    sync hit the rollup, never re-aggregating on the click path.
// The set is a sample pool; users tick a subset to dry-run an attribute against.

import { normUrl, decodeUrl, matchesExclusion } from "./webCrawler.js";

export const MAX_TEST_LINKS = 50;
const GA_TEST_LOOKBACK_DAYS = 30;
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ".ico", ".pdf"];

function yyyymmdd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

const RANK_KEEP = 500;   // how many top pages to cache in the rollup

// HEAVY: aggregate the event-level path_exploration once and cache the top pages
// in app.web_content_page_rank. Run nightly (all companies) or on explicit rebuild
// (one company). Keeping this off the per-click path is the whole point of 1.b.
export async function refreshPageRank(pool, companyId) {
  const { rows: cfgRows } = await pool.query(
    `SELECT url_pattern, excluded_url_patterns
     FROM app.web_content_html_elements WHERE company_id = $1
     ORDER BY created_date ASC LIMIT 1`,
    [companyId]
  );
  const cfg = cfgRows[0] || {};
  const excluded = cfg.excluded_url_patterns || [];

  const params = [companyId, yyyymmdd(new Date(Date.now() - GA_TEST_LOOKBACK_DAYS * 86_400_000))];
  let where = "company_id = $1 AND date >= $2 AND page_location IS NOT NULL AND page_location <> ''";
  if (cfg.url_pattern) { params.push(`%${cfg.url_pattern}%`); where += ` AND page_location ILIKE $${params.length}`; }

  const { rows } = await pool.query(
    `SELECT page_location, COUNT(*) AS hits
     FROM ga_landing.path_exploration
     WHERE ${where}
     GROUP BY page_location
     ORDER BY hits DESC
     LIMIT $${params.length + 1}`,
    [...params, RANK_KEEP]
  );

  // Clean + dedupe in JS (globs/images), then replace the company's rollup.
  const picked = [];
  const seen = new Set();
  for (const r of rows) {
    const raw = String(r.page_location || "").trim();
    if (!/^https?:\/\//i.test(raw)) continue;
    const noQuery = raw.split("?")[0];
    if (IMAGE_EXTS.some((e) => noQuery.toLowerCase().endsWith(e))) continue;
    if (matchesExclusion(raw, excluded)) continue;
    const key = normUrl(raw);
    if (!key || key.length < 12 || seen.has(key)) continue;
    seen.add(key);
    picked.push({ url: decodeUrl(noQuery), hits: Number(r.hits) || 0 });
  }

  await pool.query(`DELETE FROM app.web_content_page_rank WHERE company_id = $1`, [companyId]);
  for (const p of picked) {
    await pool.query(
      `INSERT INTO app.web_content_page_rank (company_id, url, hits, window_days, refreshed_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (company_id, url) DO UPDATE SET hits = EXCLUDED.hits, refreshed_at = NOW()`,
      [companyId, p.url, p.hits, GA_TEST_LOOKBACK_DAYS]
    );
  }
  return picked.length;
}

// CHEAP: read the cached rollup, drop known-bad/excluded pages, and replace the
// 'ga' rows in the test set (manual rows untouched). Returns links stored.
export async function syncTestLinksFromRank(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT url, hits FROM app.web_content_page_rank
     WHERE company_id = $1 ORDER BY hits DESC LIMIT $2`,
    [companyId, RANK_KEEP]
  );
  const { rows: badRows } = await pool.query(
    `SELECT url FROM app.web_pages
     WHERE company_id = $1 AND (is_excluded = true OR is_valid = false)`,
    [companyId]
  );
  const bad = new Set(badRows.map((r) => normUrl(r.url)));

  const picked = [];
  const seen = new Set();
  for (const r of rows) {
    const key = normUrl(r.url);
    if (!key || bad.has(key) || seen.has(key)) continue;
    seen.add(key);
    picked.push({ url: r.url, hits: r.hits });
    if (picked.length >= MAX_TEST_LINKS) break;
  }

  // GA often surfaces fewer than MAX_TEST_LINKS top pages. Top the set up to the cap
  // with RANDOM valid crawled pages (not already picked) so there's always a full
  // sample to dry-run against.
  if (picked.length < MAX_TEST_LINKS) {
    const { rows: extra } = await pool.query(
      `SELECT url FROM app.web_pages
       WHERE company_id = $1 AND is_valid = true AND is_excluded = false AND content <> ''
       ORDER BY random()
       LIMIT $2`,
      [companyId, MAX_TEST_LINKS * 3]   // over-fetch so dedupe still leaves enough
    );
    for (const r of extra) {
      if (picked.length >= MAX_TEST_LINKS) break;
      const key = normUrl(r.url);
      if (!key || seen.has(key)) continue;   // skip the top-GA pages already chosen
      seen.add(key);
      picked.push({ url: r.url, hits: 0 });   // hits 0 → sorts after the GA-ranked ones
    }
  }

  await pool.query(`DELETE FROM app.web_content_test_links WHERE company_id = $1 AND source = 'ga'`, [companyId]);
  for (const p of picked) {
    await pool.query(
      `INSERT INTO app.web_content_test_links (company_id, url, title, source, hits, is_selected)
       VALUES ($1, $2,
         (SELECT title FROM app.web_pages wp WHERE wp.company_id = $1 AND app.norm_url(wp.url) = app.norm_url($2) LIMIT 1),
         'ga', $3, true)
       ON CONFLICT (company_id, url) DO UPDATE SET title = EXCLUDED.title, hits = EXCLUDED.hits, updated_date = NOW()`,
      [companyId, p.url, p.hits]
    );
  }
  await pool.query(
    `UPDATE app.web_content_html_elements SET test_links_refreshed_at = NOW() WHERE company_id = $1`,
    [companyId]
  );
  // belt-and-suspenders: also clear any manual rows that went bad
  await pruneBadTestLinks(pool, companyId);
  // Guarantee a full sample pool where the workspace has enough valid pages.
  await topUpTestLinks(pool, companyId);
  return picked.length;
}

// Fill the test-link set up to MAX_TEST_LINKS with random valid, non-excluded,
// not-already-present crawled pages (titles included). No-op once the set is full
// or the workspace genuinely has fewer than MAX_TEST_LINKS valid pages. Runs on
// every read so the pool is reliably reported as N/50, not 48/50.
export async function topUpTestLinks(pool, companyId) {
  const { rows: cnt } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM app.web_content_test_links WHERE company_id = $1`,
    [companyId]
  );
  const room = MAX_TEST_LINKS - (cnt[0]?.n || 0);
  if (room <= 0) return 0;
  const { rows: extra } = await pool.query(
    `SELECT wp.url, wp.title FROM app.web_pages wp
     WHERE wp.company_id = $1 AND wp.is_valid = true AND wp.is_excluded = false AND wp.content <> ''
       AND NOT EXISTS (
         SELECT 1 FROM app.web_content_test_links tl
         WHERE tl.company_id = $1 AND app.norm_url(tl.url) = app.norm_url(wp.url)
       )
     ORDER BY random()
     LIMIT $2`,
    [companyId, room]
  );
  let added = 0;
  const seen = new Set();
  for (const r of extra) {
    if (added >= room) break;
    const key = normUrl(r.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const { rowCount } = await pool.query(
      `INSERT INTO app.web_content_test_links (company_id, url, title, source, hits, is_selected)
       VALUES ($1, $2, $3, 'ga', 0, true)
       ON CONFLICT (company_id, url) DO NOTHING`,
      [companyId, r.url, r.title || null]
    );
    if (rowCount) added++;
  }
  return added;
}

// Public "Load top 50 from GA" action: reads the rollup (cheap); lazily builds it
// once if it has never been computed for this company. Repeat clicks stay cheap.
export async function refreshGaTestLinks(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM app.web_content_page_rank WHERE company_id = $1 LIMIT 1`, [companyId]
  );
  if (!rows.length) await refreshPageRank(pool, companyId);
  return syncTestLinksFromRank(pool, companyId);
}

// "Test top pages" source: the company's most-visited VALID pages, ranked by GA
// traffic from ga_landing.path_exploration. Reads the cached page-rank rollup
// (cheap; lazily built from the recent window) joined to already-crawled valid,
// non-excluded pages. If that recent window yields fewer than `target` valid
// pages, falls back to an all-time path_exploration aggregation ("however many
// days needed") to fill up to `target`. Returns [{url, title, content}], ranked.
export async function gaTopValidPagesForTest(pool, companyId, target = MAX_TEST_LINKS) {
  // Ensure the rollup exists (first call builds it from the recent window).
  const { rows: have } = await pool.query(
    `SELECT 1 FROM app.web_content_page_rank WHERE company_id = $1 LIMIT 1`, [companyId]
  );
  if (!have.length) {
    try { await refreshPageRank(pool, companyId); }
    catch (e) { console.warn("[test] page-rank build failed (non-fatal):", e.message); }
  }

  // Top valid pages by recent traffic (cheap: rollup is ≤ RANK_KEEP rows).
  const fromRank = await pool.query(
    `SELECT wp.url, wp.title, wp.content, pr.hits
     FROM app.web_content_page_rank pr
     JOIN app.web_pages wp
       ON wp.company_id = pr.company_id AND app.norm_url(wp.url) = app.norm_url(pr.url)
     WHERE pr.company_id = $1
       AND wp.is_valid = true AND wp.is_excluded = false AND wp.content <> ''
     ORDER BY pr.hits DESC
     LIMIT $2`,
    [companyId, target]
  );
  if (fromRank.rows.length >= target) return fromRank.rows;

  // Thin recent window: re-rank valid pages by ALL-TIME GA traffic (the widest
  // window) to fill up to target. Heavy, but only runs when the rollup fell short.
  let allTime = { rows: [] };
  try {
    const { rows: cfgRows } = await pool.query(
      `SELECT url_pattern FROM app.web_content_html_elements WHERE company_id = $1 ORDER BY created_date ASC LIMIT 1`,
      [companyId]
    );
    const params = [companyId];
    let patternClause = "";
    if (cfgRows[0]?.url_pattern) { params.push(`%${cfgRows[0].url_pattern}%`); patternClause = ` AND pe.page_location ILIKE $${params.length}`; }
    params.push(target);
    allTime = await pool.query(
      `SELECT wp.url, wp.title, wp.content, h.hits
       FROM (
         SELECT app.norm_url(pe.page_location) AS nu, COUNT(*) AS hits
         FROM ga_landing.path_exploration pe
         WHERE pe.company_id = $1 AND pe.page_location IS NOT NULL AND pe.page_location <> ''${patternClause}
         GROUP BY app.norm_url(pe.page_location)
       ) h
       JOIN app.web_pages wp ON wp.company_id = $1 AND app.norm_url(wp.url) = h.nu
       WHERE wp.is_valid = true AND wp.is_excluded = false AND wp.content <> ''
       ORDER BY h.hits DESC
       LIMIT $${params.length}`,
      params
    );
  } catch (e) { console.warn("[test] all-time GA ranking failed (non-fatal):", e.message); }

  // Merge recent-top first, then all-time, dedupe by normalised URL, cap at target.
  const seen = new Set();
  const out = [];
  for (const r of [...fromRank.rows, ...allTime.rows]) {
    const key = normUrl(r.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ url: r.url, title: r.title, content: r.content });
    if (out.length >= target) break;
  }
  return out;
}

// Nightly cron: rebuild every GA-connected company's rollup once, then re-sync the
// test set for companies whose test_links_refresh_mode = 'daily'. Static companies
// keep their frozen set (and read the fresh rollup only when they click refresh).
export async function runDailyTestLinkRefresh(pool) {
  const { rows: companies } = await pool.query(
    `SELECT DISTINCT w.company_id, w.test_links_refresh_mode
     FROM app.web_content_html_elements w
     JOIN app.data_integrations di
       ON di.company_id = w.company_id AND di.integration_type = 'googleAnalytics' AND di.is_connected = true`
  );
  let ranked = 0, synced = 0;
  for (const c of companies) {
    try {
      await refreshPageRank(pool, c.company_id);
      ranked++;
      if (c.test_links_refresh_mode === "daily") { await syncTestLinksFromRank(pool, c.company_id); synced++; }
    } catch (e) {
      console.error(`[test-links cron] ${c.company_id} failed:`, e.message);
    }
  }
  return { ranked, synced };
}

// Remove any test link whose URL is now a failed (is_valid=false) or excluded page.
// Test links must NEVER reference a failed/excluded URL, so this is enforced on
// every read + upload + sync, and whenever a page is excluded or scrape-fails.
// Returns the number pruned. (Manual URLs not yet crawled are kept - they're
// neither failed nor excluded until a scrape says otherwise.)
export async function pruneBadTestLinks(pool, companyId) {
  const { rowCount } = await pool.query(
    `DELETE FROM app.web_content_test_links tl
     USING app.web_pages wp
     WHERE tl.company_id = $1 AND wp.company_id = $1
       AND app.norm_url(wp.url) = app.norm_url(tl.url)
       AND (wp.is_excluded = true OR wp.is_valid = false)`,
    [companyId]
  );
  return rowCount;
}

// Add manual URLs (deduped, capped at the pool size across all manual rows).
export async function addManualTestLinks(pool, companyId, urls) {
  const { rows: existing } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM app.web_content_test_links WHERE company_id = $1 AND source = 'manual'`,
    [companyId]
  );
  let room = MAX_TEST_LINKS - (existing[0]?.n || 0);
  let added = 0;
  const seen = new Set();
  for (const raw of urls) {
    if (room <= 0) break;
    const u = decodeUrl(String(raw || "").trim()).split("?")[0];
    if (!/^https?:\/\//i.test(u)) continue;
    const key = normUrl(u);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const { rowCount } = await pool.query(
      `INSERT INTO app.web_content_test_links (company_id, url, title, source, is_selected)
       VALUES ($1, $2,
         (SELECT title FROM app.web_pages wp WHERE wp.company_id = $1 AND app.norm_url(wp.url) = app.norm_url($2) LIMIT 1),
         'manual', true)
       ON CONFLICT (company_id, url) DO NOTHING`,
      [companyId, u]
    );
    if (rowCount) { added++; room--; }
  }
  // Drop anything that's already a failed/excluded page.
  const pruned = await pruneBadTestLinks(pool, companyId);
  return Math.max(0, added - pruned);
}
