import { Router } from "express";
import { authenticate, withCompany } from "../middleware/auth.js";
import { processNextAttributeJob, repropagate, retagPagesScoped } from "../lib/attributeQueue.js";
import { crawlPage, contentHash, matchesExclusion, decodeUrl, isValidTitle } from "../lib/webCrawler.js";
import { tagPage, isAIConfigured, groupValues, suggestAttributes } from "../lib/attributeAI.js";
import { recordAiUsage } from "../lib/aiUsage.js";
import { refreshGaTestLinks, addManualTestLinks, pruneBadTestLinks, gaTopValidPagesForTest, MAX_TEST_LINKS } from "../lib/attributeTestLinks.js";
import { triggerContentScrape, cancelContentScrape } from "../lib/contentScrapeTrigger.js";
import { ruleFieldRegistry, previewRule, repropagateRule } from "../lib/attributeRules.js";
import { assignEntities, unassign, resolveSegmentEntities, resolveIdentifiers, findSingleConflicts, findMultiAssigned, recomputeManualCounts } from "../lib/attributeManual.js";

// Load the scraper config for the CURRENT workspace for on-demand crawls.
async function loadCrawlConfig(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT error_strings, valid_content_min_length, valid_title_min_length
     FROM app.web_content_html_elements WHERE company_id = $1
     ORDER BY created_date ASC LIMIT 1`,
    [companyId]
  );
  const cfg = rows[0] || {};
  return {
    minLen: cfg.valid_content_min_length || 60,
    titleMinLen: cfg.valid_title_min_length ?? 1,
    errorStrings: cfg.error_strings || [],
  };
}

// Attributes API - custom targeting dimensions (behavioral / rule / manual).
// Phase 1 ships the behavioral (web-content) source end to end.

export function createAttributesRouter(pool) {
  const router = Router();
  router.use(authenticate, withCompany(pool));

  const fail = (res, err) => res.status(500).json({ error: String(err.message || err) });

  // ── Static routes (declared before "/:id" so they aren't shadowed) ──

  // Crawl source + controls shown on the Content tab.
  router.get("/crawl-settings", async (req, res) => {
    try {
      const { rows: cfg } = await pool.query(
        `SELECT url_pattern, excluded_url_patterns, valid_content_min_length, valid_title_min_length
         FROM app.web_content_html_elements WHERE company_id = $1
         ORDER BY created_date ASC LIMIT 1`,
        [req.companyId]
      );
      const { rows: dom } = await pool.query(
        `SELECT url_domain FROM app.company_report_config WHERE company_id = $1
         ORDER BY created_date ASC LIMIT 1`,
        [req.companyId]
      );
      const { rows: ga } = await pool.query(
        `SELECT config, is_connected, is_synced FROM app.data_integrations
         WHERE company_id = $1 AND integration_type = 'googleAnalytics' LIMIT 1`,
        [req.companyId]
      );
      // How many usable pages have been crawled - drives the "Crawl pages" setup
      // gate (attributes can't be created until at least one page is crawled).
      const { rows: pc } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM app.web_pages
         WHERE company_id = $1 AND is_valid = true AND is_excluded = false`,
        [req.companyId]
      );
      res.json({
        ga_connected:     ga[0]?.is_connected || false,
        ga_synced:        ga[0]?.is_synced || false,
        ga_property_name: ga[0]?.config?.propertyName || null,
        ga_property_id:   ga[0]?.config?.propertyId || null,
        url_domain:       dom[0]?.url_domain || null,
        url_pattern:      cfg[0]?.url_pattern || "",
        excluded_url_patterns: cfg[0]?.excluded_url_patterns || [],
        valid_content_min_length: cfg[0]?.valid_content_min_length ?? 60,
        valid_title_min_length:   cfg[0]?.valid_title_min_length ?? 1,
        crawled_pages:    pc[0]?.n || 0,
      });
    } catch (err) { fail(res, err); }
  });

  router.patch("/crawl-settings", async (req, res) => {
    try {
      const { rows: cfgRows } = await pool.query(
        `SELECT id FROM app.web_content_html_elements WHERE company_id = $1
         ORDER BY created_date ASC LIMIT 1`,
        [req.companyId]
      );
      if (!cfgRows.length) return res.status(404).json({ error: "No crawl config row" });
      const id = cfgRows[0].id;

      const sets = [];
      const params = [id];
      let patterns = null;
      if ("excluded_url_patterns" in req.body && Array.isArray(req.body.excluded_url_patterns)) {
        patterns = [...new Set(req.body.excluded_url_patterns.map((p) => String(p || "").trim()).filter(Boolean))];
        params.push(patterns);
        sets.push(`excluded_url_patterns = $${params.length}`);
      }
      // Validity thresholds: min chars for content (default 60) and title (default 1).
      const clamp = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
      if ("valid_content_min_length" in req.body) {
        params.push(clamp(req.body.valid_content_min_length, 0, 100000, 60));
        sets.push(`valid_content_min_length = $${params.length}`);
      }
      if ("valid_title_min_length" in req.body) {
        params.push(clamp(req.body.valid_title_min_length, 0, 1000, 1));
        sets.push(`valid_title_min_length = $${params.length}`);
      }
      const revalidate = "valid_content_min_length" in req.body || "valid_title_min_length" in req.body;
      if (sets.length) {
        // scope by company_id as well as the row id (defence in depth)
        params.push(req.companyId);
        await pool.query(
          `UPDATE app.web_content_html_elements SET ${sets.join(", ")} WHERE id = $1 AND company_id = $${params.length}`,
          params
        );
      }

      // Threshold changed: re-evaluate already-crawled pages against the new minimums
      // (+ existing error strings) so the Valid/Failed split updates immediately - a
      // lower title/content minimum can flip previously-failed pages to Valid.
      if (revalidate) {
        const { rows: c } = await pool.query(
          `SELECT error_strings, valid_content_min_length AS cmin, valid_title_min_length AS tmin
           FROM app.web_content_html_elements WHERE company_id = $1 ORDER BY created_date ASC LIMIT 1`,
          [req.companyId]
        );
        const es = c[0]?.error_strings || [];
        const cmin = c[0]?.cmin ?? 60;
        const tmin = c[0]?.tmin ?? 1;
        await pool.query(
          `UPDATE app.web_pages SET
             is_valid_content = (char_length(coalesce(content,'')) >= $2
               AND NOT (lower(coalesce(content,'')) LIKE ANY (SELECT '%'||lower(x)||'%' FROM unnest($4::text[]) x))),
             is_valid_title = (char_length(btrim(coalesce(title,''))) >= $3
               AND NOT (lower(coalesce(title,'')) LIKE ANY (SELECT '%'||lower(x)||'%' FROM unnest($4::text[]) x)))
           WHERE company_id = $1`,
          [req.companyId, cmin, tmin, es]
        );
        await pool.query(
          `UPDATE app.web_pages SET is_valid = (is_valid_content AND is_valid_title) WHERE company_id = $1`,
          [req.companyId]
        );
      }

      // When exclusions change, immediately exclude already-crawled matches and
      // re-resolve the affected attributes (so targeting reflects it right away).
      if (patterns) {
        const { rows: pages } = await pool.query(
          `SELECT id, url FROM app.web_pages WHERE company_id = $1 AND is_excluded = false`,
          [req.companyId]
        );
        const hitIds = pages.filter((p) => matchesExclusion(p.url, patterns)).map((p) => p.id);
        if (hitIds.length) {
          await pool.query(`UPDATE app.web_pages SET is_excluded = true WHERE id = ANY($1::uuid[]) AND company_id = $2`, [hitIds, req.companyId]);
          const { rows: aff } = await pool.query(
            `SELECT DISTINCT attribute_id FROM app.page_attribute_values WHERE page_id = ANY($1::uuid[])`,
            [hitIds]
          );
          const attrIds = aff.map((a) => a.attribute_id);
          if (attrIds.length) {
            try { await repropagate(pool, req.companyId, attrIds); }
            catch (e) { console.error("[attr] repropagate after exclusions failed:", e.message); }
          }
        }
        // newly-excluded pages must drop out of the test-link set
        await pruneBadTestLinks(pool, req.companyId).catch(() => {});
        return res.json({ ok: true, excluded_now: hitIds.length });
      }
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ── Test links (managed dry-run sample set) ─────────────────
  router.get("/test-links", async (req, res) => {
    try {
      // Guarantee: test links never include failed/excluded URLs (prune on read).
      await pruneBadTestLinks(pool, req.companyId).catch(() => {});
      const { rows } = await pool.query(
        `SELECT id, url, title, source, is_selected, hits
         FROM app.web_content_test_links WHERE company_id = $1
         ORDER BY source, hits DESC, lower(url)`,
        [req.companyId]
      );
      const { rows: cfg } = await pool.query(
        `SELECT test_links_refresh_mode, test_links_refreshed_at
         FROM app.web_content_html_elements WHERE company_id = $1 LIMIT 1`,
        [req.companyId]
      );
      res.json({
        links: rows,
        max: MAX_TEST_LINKS,
        refresh_mode: cfg[0]?.test_links_refresh_mode || "static",
        refreshed_at: cfg[0]?.test_links_refreshed_at || null,
      });
    } catch (err) { fail(res, err); }
  });

  // Upload manual URLs (capped at MAX_TEST_LINKS manual rows).
  router.post("/test-links/upload", async (req, res) => {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    if (!urls.length) return res.status(400).json({ error: "urls required" });
    try {
      const added = await addManualTestLinks(pool, req.companyId, urls);
      res.json({ ok: true, added });
    } catch (err) { fail(res, err); }
  });

  // Refresh the GA-sourced top pages now.
  router.post("/test-links/refresh", async (req, res) => {
    try {
      const count = await refreshGaTestLinks(pool, req.companyId);
      res.json({ ok: true, count });
    } catch (err) { fail(res, err); }
  });

  // refresh_mode: static | daily (auto top-50 GA refresh).
  router.patch("/test-links/settings", async (req, res) => {
    const mode = req.body?.refresh_mode === "daily" ? "daily" : "static";
    try {
      await pool.query(
        `UPDATE app.web_content_html_elements SET test_links_refresh_mode = $2 WHERE company_id = $1`,
        [req.companyId, mode]
      );
      res.json({ ok: true, refresh_mode: mode });
    } catch (err) { fail(res, err); }
  });

  // Toggle which links are included in the next dry-run.
  router.patch("/test-links/select", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    const selected = !!req.body?.is_selected;
    try {
      if (ids) {
        await pool.query(
          `UPDATE app.web_content_test_links SET is_selected = $3 WHERE company_id = $1 AND id = ANY($2::uuid[])`,
          [req.companyId, ids, selected]
        );
      } else {
        // no ids → set all
        await pool.query(
          `UPDATE app.web_content_test_links SET is_selected = $2 WHERE company_id = $1`,
          [req.companyId, selected]
        );
      }
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  router.delete("/test-links/:linkId", async (req, res) => {
    try {
      await pool.query(`DELETE FROM app.web_content_test_links WHERE id = $1 AND company_id = $2`,
        [req.params.linkId, req.companyId]);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ── Rule attributes ─────────────────────────────────────────
  // Whitelisted fields + operators for the rule builder.
  router.get("/rule-fields", (req, res) => {
    try { res.json(ruleFieldRegistry()); } catch (err) { fail(res, err); }
  });

  // Live "how many profiles match" for a single rule (during editing).
  router.post("/rule-preview", async (req, res) => {
    try {
      const n = await previewRule(pool, req.companyId, req.body?.scope, req.body?.rule || {});
      res.json({ count: n });
    } catch (err) { fail(res, err); }
  });

  // Options for the segment builder (approved values only).
  router.get("/options", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT a.id AS attribute_id, a.name AS attribute_name, a.source, a.scope, a.group_label,
                v.id AS value_id, COALESCE(v.display_label, v.value) AS value, v.group_name, v.profile_count
         FROM app.attributes a
         JOIN app.attribute_values v
           ON v.attribute_id = a.id AND v.is_approved = true AND v.merged_into IS NULL
         WHERE a.company_id = $1 AND a.status = 'active'
         ORDER BY a.name, v.profile_count DESC, lower(v.value)`,
        [req.companyId]
      );
      const byAttr = {};
      for (const r of rows) {
        (byAttr[r.attribute_id] ||= { id: r.attribute_id, name: r.attribute_name, source: r.source, scope: r.scope, group_label: r.group_label, values: [] })
          .values.push({ id: r.value_id, value: r.value, group_name: r.group_name, profile_count: r.profile_count });
      }
      res.json(Object.values(byAttr));
    } catch (err) { fail(res, err); }
  });

  // Analytics rollup: coverage & health across attributes / values / profile tags.
  router.get("/analytics", async (req, res) => {
    const c = [req.companyId];
    const PENDING = "v.is_exception AND NOT v.is_approved AND NOT v.is_blocked AND v.merged_into IS NULL";
    try {
      const [
        kpis, bySource, coverage, topValues, valueHealth,
        reviewBacklog, taggingOverTime, pageCoverage, table,
      ] = await Promise.all([
        pool.query(
          `SELECT
             (SELECT COUNT(*) FROM app.attributes WHERE company_id = $1)::int AS total_attributes,
             (SELECT COUNT(*) FROM app.attributes WHERE company_id = $1 AND status = 'active')::int AS active_attributes,
             (SELECT COUNT(*) FROM app.attribute_values v WHERE v.company_id = $1 AND v.is_approved AND v.merged_into IS NULL)::int AS approved_values,
             (SELECT COUNT(*) FROM app.attribute_values v WHERE v.company_id = $1 AND ${PENDING})::int AS pending_values,
             (SELECT COUNT(*) FROM app.profile_attribute_values WHERE company_id = $1)::int AS total_tags,
             (SELECT COUNT(DISTINCT entity_type || ':' || entity_id) FROM app.profile_attribute_values WHERE company_id = $1)::int AS profiles_covered`, c),
        pool.query(
          `SELECT source AS name, COUNT(*)::int AS value
             FROM app.attributes WHERE company_id = $1 GROUP BY source ORDER BY value DESC`, c),
        pool.query(
          `SELECT a.name AS name, COUNT(DISTINCT pv.entity_type || ':' || pv.entity_id)::int AS value
             FROM app.attributes a
             LEFT JOIN app.profile_attribute_values pv ON pv.attribute_id = a.id
            WHERE a.company_id = $1
            GROUP BY a.id, a.name ORDER BY value DESC LIMIT 12`, c),
        pool.query(
          `SELECT COALESCE(v.display_label, v.value) AS name, v.profile_count::int AS value, a.name AS attribute
             FROM app.attribute_values v JOIN app.attributes a ON a.id = v.attribute_id
            WHERE v.company_id = $1 AND v.is_approved AND v.merged_into IS NULL AND v.profile_count > 0
            ORDER BY v.profile_count DESC LIMIT 15`, c),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE v.is_approved AND v.merged_into IS NULL)::int AS approved,
             COUNT(*) FILTER (WHERE ${PENDING})::int AS pending,
             COUNT(*) FILTER (WHERE v.merged_into IS NOT NULL)::int AS merged
             FROM app.attribute_values v WHERE v.company_id = $1`, c),
        pool.query(
          `SELECT a.name AS name, COUNT(*)::int AS value
             FROM app.attribute_values v JOIN app.attributes a ON a.id = v.attribute_id
            WHERE v.company_id = $1 AND ${PENDING}
            GROUP BY a.id, a.name ORDER BY value DESC LIMIT 12`, c),
        pool.query(
          `SELECT to_char(date_trunc('month', first_seen), 'YYYY-MM') AS name, COUNT(*)::int AS value
             FROM app.profile_attribute_values
            WHERE company_id = $1 AND first_seen IS NOT NULL
            GROUP BY 1 ORDER BY 1 ASC`, c),
        pool.query(
          `SELECT a.name AS name, COUNT(DISTINCT pav.page_id)::int AS value
             FROM app.attributes a JOIN app.page_attribute_values pav ON pav.attribute_id = a.id
            WHERE a.company_id = $1
            GROUP BY a.id, a.name ORDER BY value DESC LIMIT 12`, c),
        pool.query(
          `SELECT a.id, a.name, a.source, a.status,
                  (SELECT COUNT(*) FROM app.attribute_values v WHERE v.attribute_id = a.id AND v.merged_into IS NULL)::int AS value_count,
                  (SELECT COUNT(*) FROM app.attribute_values v WHERE v.attribute_id = a.id AND ${PENDING})::int AS pending_count,
                  (SELECT COUNT(DISTINCT pv.entity_type || ':' || pv.entity_id) FROM app.profile_attribute_values pv WHERE pv.attribute_id = a.id)::int AS profiles_covered
             FROM app.attributes a WHERE a.company_id = $1
            ORDER BY profiles_covered DESC, a.name`, c),
      ]);
      res.json({
        kpis: kpis.rows[0],
        by_source: bySource.rows,
        coverage: coverage.rows,
        top_values: topValues.rows,
        value_health: [
          { name: "Approved", value: valueHealth.rows[0].approved },
          { name: "Pending review", value: valueHealth.rows[0].pending },
          { name: "Merged", value: valueHealth.rows[0].merged },
        ],
        review_backlog: reviewBacklog.rows,
        tagging_over_time: taggingOverTime.rows,
        page_coverage: pageCoverage.rows,
        table: table.rows,
      });
    } catch (err) { fail(res, err); }
  });

  // Derived attributes for a single profile (Profiles page affinities).
  router.get("/profile/:entityType/:entityId", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT a.name AS attribute_name, COALESCE(v.display_label, v.value) AS value,
                pv.source, pv.score
         FROM app.profile_attribute_values pv
         JOIN app.attributes a       ON a.id = pv.attribute_id
         JOIN app.attribute_values v ON v.id = pv.attribute_value_id
         WHERE pv.company_id = $1 AND pv.entity_type = $2 AND pv.entity_id = $3
           AND a.status = 'active'
         ORDER BY a.name, pv.score DESC`,
        [req.companyId, req.params.entityType, req.params.entityId]
      );
      res.json(rows);
    } catch (err) { fail(res, err); }
  });

  // ── Crawl inventory (shared across content attributes) ──────
  router.get("/web-pages", async (req, res) => {
    try {
      const { status = "all", search = "" } = req.query;
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      const params = [req.companyId];
      let where = "company_id = $1";
      // valid = readable content & title, not excluded. failed = not excluded but
      // scrape failed or invalid title/content (or tagging failed). excluded = is_excluded.
      if (status === "valid")    where += " AND is_valid = true AND is_excluded = false";
      // "Changed" = a page that was ALREADY tagged and whose content changed since
      // (needs_retag + has existing tags). Never-tagged pages are handled by a normal
      // Reconstruct, not this review flow.
      if (status === "changed")  where += " AND is_valid = true AND is_excluded = false AND needs_retag = true AND EXISTS (SELECT 1 FROM app.page_attribute_values pav WHERE pav.page_id = wp.id)";
      if (status === "failed")   where += " AND is_valid = false AND is_excluded = false";
      if (status === "excluded") where += " AND is_excluded = true";
      if (search) { params.push(`%${search}%`); where += ` AND (url ILIKE $${params.length} OR title ILIKE $${params.length})`; }

      const { rows: counts } = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE is_valid = true  AND is_excluded = false)  AS valid,
           COUNT(*) FILTER (WHERE is_valid = true  AND is_excluded = false AND needs_retag = true
                            AND EXISTS (SELECT 1 FROM app.page_attribute_values pav WHERE pav.page_id = web_pages.id)) AS changed,
           COUNT(*) FILTER (WHERE is_valid = false AND is_excluded = false)   AS failed,
           COUNT(*) FILTER (WHERE is_excluded = true)                        AS excluded,
           COUNT(*)                                                          AS total
         FROM app.web_pages WHERE company_id = $1`,
        [req.companyId]
      );
      params.push(limit, offset);
      const { rows } = await pool.query(
        `SELECT id, url, title, word_count, is_valid, is_valid_content, is_valid_title,
                is_excluded, excluded_type, excluded_value, needs_retag, fetch_method,
                og_updated_time, last_crawled, last_reviewed_date,
                metadata->>'crawl_reason' AS crawl_reason,
                (SELECT COUNT(*) FROM app.page_attribute_values pav WHERE pav.page_id = wp.id) AS tag_count,
                (SELECT COALESCE(json_agg(t ORDER BY t->>'attr'), '[]'::json) FROM (
                   SELECT DISTINCT jsonb_build_object('attr', a.name, 'value', av.value) AS t
                   FROM app.page_attribute_values pav2
                   JOIN app.attribute_values av ON av.id = pav2.attribute_value_id
                   JOIN app.attributes a        ON a.id = pav2.attribute_id
                   WHERE pav2.page_id = wp.id
                 ) tags) AS tags
         FROM app.web_pages wp
         WHERE ${where}
         ORDER BY is_valid DESC, word_count DESC, last_crawled DESC NULLS LAST
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      res.json({ pages: rows, counts: counts[0] });
    } catch (err) { fail(res, err); }
  });

  // Add + crawl a single URL on demand.
  router.post("/web-pages", async (req, res) => {
    const url = decodeUrl(String(req.body?.url || "").trim());
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "A valid http(s) URL is required" });
    try {
      const cfg = await loadCrawlConfig(pool, req.companyId);
      const r = await crawlPage(url, cfg);
      const text = r.text || "";
      const validContent = r.ok;
      const validTitle = isValidTitle(r.title, cfg.errorStrings, cfg.titleMinLen);
      const meta = JSON.stringify({ crawl_reason: r.ok ? null : (r.reason || "no content") });
      const { rows } = await pool.query(
        `INSERT INTO app.web_pages
           (company_id, url, title, content, excerpt, content_hash, word_count,
            is_valid, is_valid_content, is_valid_title, is_manual, needs_retag, fetch_method, last_crawled, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11, $12, NOW(), $13::jsonb)
         ON CONFLICT (company_id, url) DO UPDATE SET
           title = EXCLUDED.title, content = EXCLUDED.content, excerpt = EXCLUDED.excerpt,
           content_hash = EXCLUDED.content_hash, word_count = EXCLUDED.word_count,
           is_valid = EXCLUDED.is_valid, is_valid_content = EXCLUDED.is_valid_content,
           is_valid_title = EXCLUDED.is_valid_title, is_excluded = false,
           excluded_type = NULL, excluded_value = NULL,
           needs_retag = (app.web_pages.content_hash IS DISTINCT FROM EXCLUDED.content_hash),
           fetch_method = EXCLUDED.fetch_method, last_crawled = NOW(),
           metadata = app.web_pages.metadata || EXCLUDED.metadata
         RETURNING id, url, title, word_count, is_valid, is_valid_content, is_valid_title, is_excluded, fetch_method, last_crawled`,
        [req.companyId, url, r.title || "", text, text.slice(0, 600), contentHash(text),
         text.split(/\s+/).filter(Boolean).length, validContent && validTitle, validContent, validTitle, r.ok, r.method, meta]
      );
      res.status(201).json({ ...rows[0], ok: r.ok, reason: r.reason });
    } catch (err) { fail(res, err); }
  });

  // Exclude / re-include a page (re-resolves affected attributes immediately).
  // Excluding by a single page records excluded_type='exact' + the URL.
  router.patch("/web-pages/:pageId", async (req, res) => {
    if (!("is_excluded" in (req.body || {}))) return res.status(400).json({ error: "is_excluded required" });
    try {
      const excluded = !!req.body.is_excluded;
      const { rows } = await pool.query(
        `UPDATE app.web_pages
         SET is_excluded = $3,
             excluded_type  = CASE WHEN $3 THEN 'exact' ELSE NULL END,
             excluded_value = CASE WHEN $3 THEN url ELSE NULL END
         WHERE id = $1 AND company_id = $2 RETURNING id`,
        [req.params.pageId, req.companyId, excluded]
      );
      if (!rows.length) return res.status(404).json({ error: "Page not found" });
      const { rows: attrs } = await pool.query(
        `SELECT DISTINCT attribute_id FROM app.page_attribute_values WHERE page_id = $1`,
        [req.params.pageId]
      );
      const ids = attrs.map((a) => a.attribute_id);
      if (ids.length) {
        try { await repropagate(pool, req.companyId, ids); }
        catch (e) { console.error("[attr] repropagate after exclude failed:", e.message); }
      }
      // an excluded page must not remain in the test-link set
      if (excluded) await pruneBadTestLinks(pool, req.companyId).catch(() => {});
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // Exclude EVERY failed page in one go (the "exclude all" action on the Failed
  // view). Failed = unreadable/invalid and not already excluded - these are never
  // tagged anyway, so no repropagation is needed; just drop them from crawling and
  // the test-link set.
  router.post("/web-pages/exclude-failed", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE app.web_pages
         SET is_excluded = true, excluded_type = 'exact', excluded_value = url
         WHERE company_id = $1 AND is_valid = false AND is_excluded = false
         RETURNING id`,
        [req.companyId]
      );
      if (rows.length) await pruneBadTestLinks(pool, req.companyId).catch(() => {});
      res.json({ ok: true, excluded: rows.length });
    } catch (err) { fail(res, err); }
  });

  // ── Changed pages (content changed since last tagged) ───────
  // Re-tag the given pages with ONLY the chosen attributes (others keep their tags).
  router.post("/web-pages/retag", async (req, res) => {
    if (!isAIConfigured()) return res.status(400).json({ error: "AI is not configured." });
    const pageIds = Array.isArray(req.body?.page_ids) ? req.body.page_ids : [];
    const attributeIds = Array.isArray(req.body?.attribute_ids) ? req.body.attribute_ids : [];
    if (!pageIds.length || !attributeIds.length) return res.status(400).json({ error: "page_ids and attribute_ids required" });
    try {
      const r = await retagPagesScoped(pool, req.companyId, pageIds, attributeIds, (u) => recordAiUsage(pool, {
        companyId: req.companyId, userId: req.user?.id, feature: "attribute_tag",
        model: u.model, inputTokens: u.input, outputTokens: u.output, metadata: { scoped_retag: true },
      }));
      res.json({ ok: true, ...r });
    } catch (err) { fail(res, err); }
  });

  // "Keep original tags": dismiss the change on the given pages without re-tagging.
  router.post("/web-pages/keep", async (req, res) => {
    const pageIds = Array.isArray(req.body?.page_ids) ? req.body.page_ids : [];
    if (!pageIds.length) return res.status(400).json({ error: "page_ids required" });
    try {
      const { rowCount } = await pool.query(
        `UPDATE app.web_pages SET needs_retag = false WHERE company_id = $1 AND id = ANY($2::uuid[])`,
        [req.companyId, pageIds]
      );
      res.json({ ok: true, kept: rowCount });
    } catch (err) { fail(res, err); }
  });

  // Re-run specific pages. mode='scrape' re-crawls them now (Phase 1: Node);
  // mode='tag' flags them needs_retag and enqueues a tag pass.
  router.post("/web-pages/rerun", async (req, res) => {
    const ids = Array.isArray(req.body?.page_ids) ? req.body.page_ids : [];
    const mode = req.body?.mode === "scrape" ? "scrape" : "tag";
    if (!ids.length) return res.status(400).json({ error: "page_ids required" });
    try {
      if (mode === "scrape") {
        const cfg = await loadCrawlConfig(pool, req.companyId);
        const { rows: pages } = await pool.query(
          `SELECT id, url FROM app.web_pages WHERE company_id = $1 AND id = ANY($2::uuid[])`,
          [req.companyId, ids]
        );
        let rescraped = 0;
        for (const p of pages) {
          try {
            const r = await crawlPage(p.url, cfg);
            const text = r.text || "";
            const validTitle = isValidTitle(r.title, cfg.errorStrings, cfg.titleMinLen);
            await pool.query(
              `UPDATE app.web_pages SET
                 title = $3, content = $4, excerpt = $5, content_hash = $6, word_count = $7,
                 is_valid = $8, is_valid_content = $9, is_valid_title = $10,
                 needs_retag = (content_hash IS DISTINCT FROM $6),
                 fetch_method = $11, last_crawled = NOW(),
                 metadata = metadata || $12::jsonb
               WHERE id = $1 AND company_id = $2`,
              [p.id, req.companyId, r.title || "", text, text.slice(0, 600), contentHash(text),
               text.split(/\s+/).filter(Boolean).length, r.ok && validTitle, r.ok, validTitle,
               r.method, JSON.stringify({ crawl_reason: r.ok ? null : (r.reason || "no content") })]
            );
            rescraped++;
          } catch (e) { console.warn(`[attr] rerun scrape failed ${p.url}:`, e.message); }
        }
        // a re-scrape that changed content needs re-tagging; kick the worker
        processNextAttributeJob(pool).catch(() => {});
        // a page that just failed re-scrape must not stay in the test-link set
        await pruneBadTestLinks(pool, req.companyId).catch(() => {});
        return res.json({ ok: true, mode, rescraped });
      }
      // tag mode
      await pool.query(
        `UPDATE app.web_pages SET needs_retag = true WHERE company_id = $1 AND id = ANY($2::uuid[])`,
        [req.companyId, ids]
      );
      await enqueueTag(req.companyId, req.user.id, null);
      res.json({ ok: true, mode, flagged: ids.length });
    } catch (err) { fail(res, err); }
  });

  // Manually tag a page with an attribute value (curate/correct the AI). Creates the
  // value as an approved curated value if it doesn't exist; respects single-value
  // attributes by replacing any existing value on that page.
  router.post("/pages/:pageId/tags", async (req, res) => {
    const attributeId = req.body?.attribute_id;
    const value = String(req.body?.value || "").trim();
    if (!attributeId || !value) return res.status(400).json({ error: "attribute_id and value are required" });
    try {
      const { rows: pg } = await pool.query(
        `SELECT id FROM app.web_pages WHERE id = $1 AND company_id = $2`,
        [req.params.pageId, req.companyId]
      );
      if (!pg.length) return res.status(404).json({ error: "Page not found" });
      const { rows: attr } = await pool.query(
        `SELECT id, value_type FROM app.attributes WHERE id = $1 AND company_id = $2`,
        [attributeId, req.companyId]
      );
      if (!attr.length) return res.status(404).json({ error: "Attribute not found" });
      // Upsert an approved curated value (so it's immediately eligible for targeting).
      const { rows: val } = await pool.query(
        `INSERT INTO app.attribute_values (company_id, attribute_id, value, display_label, is_approved, is_exception)
         VALUES ($1,$2,$3,$4,true,false)
         ON CONFLICT (attribute_id, lower(value))
         DO UPDATE SET is_approved = true, is_exception = false, is_blocked = false, merged_into = NULL, updated_date = NOW()
         RETURNING id`,
        [req.companyId, attributeId, value, req.body?.display_label || null]
      );
      const valueId = val[0].id;
      // Single value-per-page: a new tag replaces any other value of this attribute.
      if (attr[0].value_type === "single") {
        await pool.query(
          `DELETE FROM app.page_attribute_values
           WHERE page_id = $1 AND attribute_id = $2 AND company_id = $3 AND attribute_value_id <> $4`,
          [req.params.pageId, attributeId, req.companyId, valueId]
        );
      }
      await pool.query(
        `INSERT INTO app.page_attribute_values (company_id, page_id, attribute_id, attribute_value_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT (page_id, attribute_value_id) DO NOTHING`,
        [req.companyId, req.params.pageId, attributeId, valueId]
      );
      try { await repropagate(pool, req.companyId, [attributeId]); }
      catch (e) { console.error("[attr] repropagate after manual tag failed:", e.message); }
      res.status(201).json({ ok: true, value_id: valueId });
    } catch (err) { fail(res, err); }
  });

  // Remove one AI-assigned value from one page (verify/correct a tag).
  router.delete("/pages/:pageId/tags/:valueId", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `DELETE FROM app.page_attribute_values
         WHERE page_id = $1 AND attribute_value_id = $2 AND company_id = $3
         RETURNING attribute_id`,
        [req.params.pageId, req.params.valueId, req.companyId]
      );
      if (rows.length) {
        try { await repropagate(pool, req.companyId, [rows[0].attribute_id]); }
        catch (e) { console.error("[attr] repropagate after untag failed:", e.message); }
      }
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // Cross-attribute review feed: every AI-discovered value outside the curated
  // set, with sample pages, so users can verify and approve/merge/reject in one place.

  // ── Verification sync (page review  <->  value approval) ─────────────────────
  // A tag (page+value) is "verified" when its value is approved; a value spans
  // many pages. Keep web_pages.last_reviewed_date and attribute_values.is_approved
  // in lockstep, both directions.

  // After page(s) are reviewed: approve every web_content value whose tagged pages
  // are ALL now reviewed (so verifying the only page carrying "Telegram" approves
  // the Telegram value). Re-propagates the affected attributes.
  async function approveFullyReviewedValues(companyId) {
    const { rows } = await pool.query(
      `UPDATE app.attribute_values v
       SET is_approved = true, is_exception = false, updated_date = NOW()
       FROM app.attributes a
       WHERE v.attribute_id = a.id AND a.source = 'web_content'
         AND v.company_id = $1 AND v.is_approved = false AND v.is_blocked = false AND v.merged_into IS NULL
         AND EXISTS (SELECT 1 FROM app.page_attribute_values pav WHERE pav.attribute_value_id = v.id)
         AND NOT EXISTS (
           SELECT 1 FROM app.page_attribute_values pav
           JOIN app.web_pages wp ON wp.id = pav.page_id
           WHERE pav.attribute_value_id = v.id AND wp.is_excluded = false AND wp.last_reviewed_date IS NULL
         )
       RETURNING v.attribute_id`,
      [companyId]
    );
    const attrIds = [...new Set(rows.map((r) => r.attribute_id))];
    if (attrIds.length) {
      try { await repropagate(pool, companyId, attrIds); }
      catch (e) { console.error("[attr] repropagate after auto-approve failed:", e.message); }
    }
  }

  // After value(s) are approved: mark a page reviewed once ALL its tags' values are
  // approved (fully verified). Pages with remaining pending tags stay needs_review
  // (partially verified - the verified tags show a check, the rest stay pending).
  async function markFullyApprovedPagesReviewed(companyId) {
    await pool.query(
      `UPDATE app.web_pages wp SET last_reviewed_date = NOW()
       WHERE wp.company_id = $1 AND wp.is_excluded = false AND wp.last_reviewed_date IS NULL
         AND EXISTS (SELECT 1 FROM app.page_attribute_values pav WHERE pav.page_id = wp.id)
         AND NOT EXISTS (
           SELECT 1 FROM app.page_attribute_values pav
           JOIN app.attribute_values av ON av.id = pav.attribute_value_id
           LEFT JOIN app.attribute_values cav ON cav.id = av.merged_into
           WHERE pav.page_id = wp.id AND COALESCE(cav.is_approved, av.is_approved) = false
         )`,
      [companyId]
    );
  }

  router.get("/review", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT v.id, v.value, v.display_label, v.attribute_id, v.page_count,
                a.name AS attribute_name,
                (SELECT COALESCE(json_agg(s), '[]'::json) FROM (
                   SELECT wp.title, wp.url
                   FROM app.page_attribute_values pav
                   JOIN app.web_pages wp ON wp.id = pav.page_id
                   WHERE pav.attribute_value_id = v.id
                   ORDER BY wp.word_count DESC LIMIT 3
                 ) s) AS sample_pages
         FROM app.attribute_values v
         JOIN app.attributes a ON a.id = v.attribute_id
         WHERE v.company_id = $1 AND a.source = 'web_content'
           AND v.is_exception = true AND v.is_approved = false
           AND v.is_blocked = false AND v.merged_into IS NULL
         ORDER BY a.name, v.page_count DESC, lower(v.value)`,
        [req.companyId]
      );
      res.json(rows);
    } catch (err) { fail(res, err); }
  });

  // Page-centric review feed: every tagged page with its values, flagged
  // needs_review when the page is new or gained a label since it was last reviewed.
  router.get("/tagged-pages", async (req, res) => {
    try {
      // Untagged feed: valid, non-excluded pages the AI assigned NO tags to, so the
      // user can confirm they're correctly untagged (Verify sets last_reviewed_date).
      if (req.query.filter === "untagged") {
        const { rows } = await pool.query(
          `SELECT wp.id, wp.url, wp.title, wp.word_count, wp.last_crawled, wp.last_reviewed_date,
                  (wp.last_reviewed_date IS NULL) AS needs_review,
                  '[]'::json AS tags
           FROM app.web_pages wp
           WHERE wp.company_id = $1 AND wp.is_excluded = false AND wp.is_valid = true
             AND NOT EXISTS (SELECT 1 FROM app.page_attribute_values pav WHERE pav.page_id = wp.id)
           ORDER BY needs_review DESC, wp.last_crawled DESC NULLS LAST
           LIMIT 300`,
          [req.companyId]
        );
        return res.json({ pages: rows, summary: { new_pages: 0, new_labels: 0 } });
      }
      const onlyNew = req.query.filter === "new";
      const params = [req.companyId];
      let having = "";
      if (onlyNew) {
        having = `HAVING wp.last_reviewed_date IS NULL
                  OR MAX(pav.created_date) > wp.last_reviewed_date`;
      }
      const { rows } = await pool.query(
        `SELECT wp.id, wp.url, wp.title, wp.word_count, wp.last_crawled, wp.last_reviewed_date,
                (wp.last_reviewed_date IS NULL OR MAX(pav.created_date) > wp.last_reviewed_date) AS needs_review,
                COALESCE(json_agg(DISTINCT jsonb_build_object(
                  'value_id', av.id, 'attribute_id', a.id, 'attribute', a.name,
                  'value', av.value, 'label', av.display_label,
                  'is_approved', COALESCE(cav.is_approved, av.is_approved),
                  'is_new', (wp.last_reviewed_date IS NULL OR pav.created_date > wp.last_reviewed_date)
                )), '[]'::json) AS tags
         FROM app.web_pages wp
         JOIN app.page_attribute_values pav ON pav.page_id = wp.id
         JOIN app.attribute_values av       ON av.id = pav.attribute_value_id
         LEFT JOIN app.attribute_values cav ON cav.id = av.merged_into
         JOIN app.attributes a              ON a.id = pav.attribute_id
         WHERE wp.company_id = $1 AND wp.is_excluded = false
         GROUP BY wp.id
         ${having}
         ORDER BY needs_review DESC, wp.last_crawled DESC NULLS LAST
         LIMIT 300`,
        params
      );
      const { rows: summary } = await pool.query(
        `SELECT
           COUNT(DISTINCT wp.id) FILTER (WHERE wp.last_reviewed_date IS NULL) AS new_pages,
           COUNT(*) FILTER (WHERE wp.last_reviewed_date IS NULL OR pav.created_date > wp.last_reviewed_date) AS new_labels
         FROM app.web_pages wp
         JOIN app.page_attribute_values pav ON pav.page_id = wp.id
         WHERE wp.company_id = $1 AND wp.is_excluded = false`,
        [req.companyId]
      );
      res.json({ pages: rows, summary: summary[0] || { new_pages: 0, new_labels: 0 } });
    } catch (err) { fail(res, err); }
  });

  // Mark a page reviewed (clears its needs_review until a new label arrives).
  router.post("/pages/:pageId/review", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE app.web_pages SET last_reviewed_date = NOW()
         WHERE id = $1 AND company_id = $2 RETURNING id`,
        [req.params.pageId, req.companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Page not found" });
      // Verifying this page may complete the review of a value (all its pages now
      // reviewed) -> approve it so the attribute-details values tab reflects it.
      await approveFullyReviewedValues(req.companyId);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // Mark all pages in the current feed reviewed at once (tagged feed by default,
  // or the valid untagged pages when reviewing the Untagged tab).
  router.post("/tagged-pages/review-all", async (req, res) => {
    try {
      if (req.query.filter === "untagged") {
        await pool.query(
          `UPDATE app.web_pages SET last_reviewed_date = NOW()
           WHERE company_id = $1 AND is_excluded = false AND is_valid = true
             AND NOT EXISTS (SELECT 1 FROM app.page_attribute_values pav WHERE pav.page_id = web_pages.id)`,
          [req.companyId]
        );
        return res.json({ ok: true });
      }
      await pool.query(
        `UPDATE app.web_pages SET last_reviewed_date = NOW()
         WHERE company_id = $1 AND is_excluded = false
           AND id IN (SELECT DISTINCT page_id FROM app.page_attribute_values WHERE company_id = $1)`,
        [req.companyId]
      );
      await approveFullyReviewedValues(req.companyId);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // Review-tab badge: pages needing attention = tagged pages with new/unreviewed
  // labels + valid untagged pages never reviewed. One number for the whole feed.
  router.get("/review-count", async (req, res) => {
    try {
      const { rows: tagged } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM (
           SELECT wp.id
           FROM app.web_pages wp
           JOIN app.page_attribute_values pav ON pav.page_id = wp.id
           WHERE wp.company_id = $1 AND wp.is_excluded = false
           GROUP BY wp.id
           HAVING wp.last_reviewed_date IS NULL OR MAX(pav.created_date) > wp.last_reviewed_date
         ) q`,
        [req.companyId]
      );
      const { rows: untagged } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM app.web_pages wp
         WHERE wp.company_id = $1 AND wp.is_excluded = false AND wp.is_valid = true
           AND wp.last_reviewed_date IS NULL
           AND NOT EXISTS (SELECT 1 FROM app.page_attribute_values pav WHERE pav.page_id = wp.id)`,
        [req.companyId]
      );
      res.json({ count: (tagged[0]?.n || 0) + (untagged[0]?.n || 0) });
    } catch (err) { fail(res, err); }
  });

  // AI suggests new attributes by reading a sample of already-crawled pages.
  router.post("/suggest", async (req, res) => {
    if (!isAIConfigured()) return res.status(400).json({ error: "AI is not configured." });
    try {
      const { rows: pages } = await pool.query(
        `SELECT url, title, content FROM app.web_pages
         WHERE company_id = $1 AND is_valid = true AND is_excluded = false AND content <> ''
         ORDER BY word_count DESC LIMIT 12`,
        [req.companyId]
      );
      if (!pages.length) {
        return res.json({ suggestions: [], note: "No crawled pages yet - run a reconstruct first, then I can read your site and suggest attributes." });
      }
      const { rows: existing } = await pool.query(
        `SELECT name FROM app.attributes WHERE company_id = $1 AND source = 'web_content'`,
        [req.companyId]
      );
      const suggestions = await suggestAttributes(pages, existing.map((e) => e.name), (u) =>
        recordAiUsage(pool, {
          companyId: req.companyId, userId: req.user?.id, feature: "attribute_suggest",
          model: u.model, inputTokens: u.input, outputTokens: u.output,
        }));
      res.json({ suggestions });
    } catch (err) { fail(res, err); }
  });

  // ── Attributes ──────────────────────────────────────────────
  router.get("/", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT a.*,
           (SELECT COUNT(*) FROM app.attribute_values v
             WHERE v.attribute_id = a.id AND v.merged_into IS NULL) AS value_count,
           (SELECT COUNT(*) FROM app.attribute_values v
             WHERE v.attribute_id = a.id AND v.merged_into IS NULL
               AND v.is_exception = true AND v.is_approved = false) AS pending_count,
           (SELECT COUNT(DISTINCT pv.entity_type || ':' || pv.entity_id)
             FROM app.profile_attribute_values pv WHERE pv.attribute_id = a.id) AS profile_count
         FROM app.attributes a
         WHERE a.company_id = $1
         ORDER BY a.created_date DESC`,
        [req.companyId]
      );
      res.json(rows);
    } catch (err) { fail(res, err); }
  });

  router.post("/", async (req, res) => {
    const { name, description = "", source = "web_content", value_type = "multi",
            scope = "both", extract_from = "both", status = "draft", rule = {}, values = [] } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const trimmed = name.trim();
    try {
      // Names must be unique within a workspace (case-insensitive) so they're
      // unambiguous in segments, pop-ups, and on profiles.
      const { rows: dup } = await pool.query(
        `SELECT 1 FROM app.attributes WHERE company_id = $1 AND lower(name) = lower($2) LIMIT 1`,
        [req.companyId, trimmed]
      );
      if (dup.length) return res.status(409).json({ error: `An attribute named "${trimmed}" already exists.`, code: "DUPLICATE_NAME" });
      // Content (web_content) attributes always apply to both audiences - their page
      // tags propagate to known customers AND anonymous visitors. Scope is not user-
      // editable for them.
      const finalScope = source === "web_content" ? "both" : scope;
      const { rows } = await pool.query(
        `INSERT INTO app.attributes (company_id, created_by, name, description, source, value_type, scope, extract_from, status, rule)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.companyId, req.user.id, trimmed, description, source, value_type, finalScope, extract_from, status, JSON.stringify(rule)]
      );
      const attr = rows[0];
      // Seed the user-provided values list as approved (the expected vocabulary).
      if (Array.isArray(values) && values.length) {
        for (const raw of values) {
          const v = String(raw || "").trim();
          if (!v) continue;
          await pool.query(
            `INSERT INTO app.attribute_values (company_id, attribute_id, value, is_approved, is_exception)
             VALUES ($1,$2,$3,true,false)
             ON CONFLICT (attribute_id, lower(value)) DO NOTHING`,
            [req.companyId, attr.id, v]
          );
        }
      }
      res.status(201).json(attr);
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: `An attribute named "${trimmed}" already exists.`, code: "DUPLICATE_NAME" });
      fail(res, err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    // Let literal sub-paths (e.g. /jobs, /jobs/latest) defined later fall through
    // instead of being captured here as a non-UUID :id.
    if (!/^[0-9a-fA-F-]{32,36}$/.test(req.params.id)) return next();
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.attributes WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Attribute not found" });
      const { rows: values } = await pool.query(
        `SELECT * FROM app.attribute_values
         WHERE attribute_id = $1
         ORDER BY merged_into NULLS FIRST, is_approved DESC, profile_count DESC, lower(value) ASC`,
        [req.params.id]
      );
      res.json({ ...rows[0], values });
    } catch (err) { fail(res, err); }
  });

  router.patch("/:id", async (req, res) => {
    const allowed = ["name", "description", "value_type", "scope", "extract_from", "status", "rule", "group_label"];
    const cols = allowed.filter((k) => k in (req.body || {}));
    if (!cols.length) return res.status(400).json({ error: "No valid fields" });
    try {
      // Once content tags have been applied, extract_from / value_type are locked
      // (changing them would silently invalidate the applied tags). The user must
      // clone the attribute into a fresh draft to change them.
      const { rows: cur } = await pool.query(
        `SELECT source, content_applied, extract_from, value_type FROM app.attributes WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.companyId]
      );
      if (!cur.length) return res.status(404).json({ error: "Attribute not found" });
      // Content attributes always apply to both audiences - scope can't be changed.
      if (cur[0].source === "web_content" && "scope" in req.body) req.body.scope = "both";
      // Renames must keep names unique within the workspace (case-insensitive).
      if ("name" in req.body) {
        const newName = String(req.body.name || "").trim();
        if (!newName) return res.status(400).json({ error: "name cannot be empty" });
        const { rows: dup } = await pool.query(
          `SELECT 1 FROM app.attributes WHERE company_id = $1 AND lower(name) = lower($2) AND id <> $3 LIMIT 1`,
          [req.companyId, newName, req.params.id]
        );
        if (dup.length) return res.status(409).json({ error: `An attribute named "${newName}" already exists.`, code: "DUPLICATE_NAME" });
      }
      if (cur[0].source === "web_content" && cur[0].content_applied) {
        const changingLocked =
          ("extract_from" in req.body && req.body.extract_from !== cur[0].extract_from) ||
          ("value_type"  in req.body && req.body.value_type  !== cur[0].value_type);
        if (changingLocked) {
          return res.status(409).json({
            error: "This attribute's values are already applied to content. Clone it to change Extract from / Values per page.",
            code: "LOCKED_APPLIED",
          });
        }
      }
      // Switching to single value-per-person is only valid if no one currently
      // carries more than one value - otherwise it's ambiguous which to keep.
      if (req.body.value_type === "single") {
        const dupes = await findMultiAssigned(pool, req.companyId, req.params.id);
        if (dupes.length) {
          return res.status(409).json({
            error: "Some people have more than one value. Resolve the duplicates before switching to single.",
            conflicts: dupes,
          });
        }
      }
      const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(", ");
      const vals = cols.map((c) => (c === "rule" ? JSON.stringify(req.body[c]) : c === "name" ? String(req.body[c]).trim() : req.body[c]));
      const { rows } = await pool.query(
        `UPDATE app.attributes SET ${sets} WHERE id = $1 AND company_id = $2 RETURNING *`,
        [req.params.id, req.companyId, ...vals]
      );
      if (!rows.length) return res.status(404).json({ error: "Attribute not found" });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "An attribute with that name already exists.", code: "DUPLICATE_NAME" });
      fail(res, err);
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM app.attributes WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // Clone an attribute into a fresh draft (so locked fields can be edited). Copies
  // settings + approved values; does NOT copy page/profile tags or run history.
  router.post("/:id/clone", async (req, res) => {
    try {
      const { rows: src } = await pool.query(
        `SELECT * FROM app.attributes WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.companyId]
      );
      if (!src.length) return res.status(404).json({ error: "Attribute not found" });
      const a = src[0];
      // Find a free name so the clone never collides (names are unique per workspace).
      const base = String(req.body?.name || `${a.name} (copy)`).trim();
      let name = base;
      for (let n = 2; ; n++) {
        const { rows: dup } = await pool.query(
          `SELECT 1 FROM app.attributes WHERE company_id = $1 AND lower(name) = lower($2) LIMIT 1`,
          [req.companyId, name]
        );
        if (!dup.length) break;
        name = `${base} ${n}`;
      }
      const { rows } = await pool.query(
        `INSERT INTO app.attributes
           (company_id, created_by, name, description, source, value_type, scope, extract_from, group_label, rule, status, content_applied)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',false) RETURNING *`,
        [req.companyId, req.user.id, name, a.description, a.source, a.value_type, a.scope,
         a.extract_from, a.group_label, a.rule]
      );
      const clone = rows[0];
      // copy approved, non-merged values as the starting vocabulary
      await pool.query(
        `INSERT INTO app.attribute_values (company_id, attribute_id, value, display_label, group_name, is_approved, is_exception)
         SELECT company_id, $1, value, display_label, group_name, true, false
         FROM app.attribute_values
         WHERE attribute_id = $2 AND is_approved = true AND merged_into IS NULL
         ON CONFLICT (attribute_id, lower(value)) DO NOTHING`,
        [clone.id, a.id]
      );
      res.status(201).json(clone);
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "An attribute with that name already exists.", code: "DUPLICATE_NAME" });
      fail(res, err);
    }
  });

  // ── Values ──────────────────────────────────────────────────
  // Add a curated value (immediately approved → used for targeting).
  router.post("/:id/values", async (req, res) => {
    const value = String(req.body?.value || "").trim();
    if (!value) return res.status(400).json({ error: "value is required" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.attribute_values (company_id, attribute_id, value, display_label, is_approved, is_exception)
         VALUES ($1,$2,$3,$4,true,false)
         ON CONFLICT (attribute_id, lower(value))
         DO UPDATE SET is_approved = true, is_exception = false, merged_into = NULL, updated_date = NOW()
         RETURNING *`,
        [req.companyId, req.params.id, value, req.body?.display_label || null]
      );
      // A brand-new curated value should be checked against existing pages WITHOUT
      // a full reconstruct: enqueue a scoped re-tag over stored content (active
      // web_content attributes only). Coalesced so rapid edits don't pile up.
      const { rows: a } = await pool.query(
        `SELECT source, status FROM app.attributes WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.companyId]
      );
      if (a[0]?.source === "web_content" && a[0]?.status === "active" && isAIConfigured()) {
        await enqueueTag(req.companyId, req.user.id, req.params.id, "retag_attribute");
      }
      res.status(201).json(rows[0]);
    } catch (err) { fail(res, err); }
  });

  // Approve / rename / un-approve / block a value (review-queue workflow).
  router.patch("/values/:valueId", async (req, res) => {
    const allowed = ["is_approved", "display_label", "value", "is_blocked", "group_name"];
    const cols = allowed.filter((k) => k in (req.body || {}));
    if (!cols.length) return res.status(400).json({ error: "No valid fields" });
    try {
      // Approving promotes an exception into the canonical set; blocking un-approves it.
      let extra = "";
      if (req.body.is_approved === true) extra += ", is_exception = false, is_blocked = false";
      if (req.body.is_blocked === true)  extra += ", is_approved = false";
      const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(", ");
      const { rows } = await pool.query(
        `UPDATE app.attribute_values SET ${sets}${extra}
         WHERE id = $1 AND company_id = $2 RETURNING *`,
        [req.params.valueId, req.companyId, ...cols.map((c) => req.body[c])]
      );
      if (!rows.length) return res.status(404).json({ error: "Value not found" });
      // Targeting eligibility changed → re-resolve profile tags immediately (no crawl/LLM).
      if ("is_approved" in req.body || "is_blocked" in req.body) {
        try { await repropagate(pool, req.companyId, [rows[0].attribute_id]); }
        catch (e) { console.error("[attr] repropagate after value update failed:", e.message); }
      }
      // Approving a value can fully-verify pages whose every tag is now approved.
      if (req.body.is_approved === true) await markFullyApprovedPagesReviewed(req.companyId);
      res.json(rows[0]);
    } catch (err) { fail(res, err); }
  });

  // Bulk approve / reject / merge / set-group across values (one coalesced
  // re-propagate). approve|reject change targeting; merge folds many values
  // into one canonical; set_group rolls values up under a grouping dimension.
  router.post("/values/bulk", async (req, res) => {
    const ids = req.body?.value_ids;
    const action = req.body?.action;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "value_ids required" });
    if (!["approve", "reject", "merge", "set_group"].includes(action)) {
      return res.status(400).json({ error: "action must be approve|reject|merge|set_group" });
    }
    try {
      let rows;
      if (action === "merge") {
        const target = req.body?.target_id;
        if (!target) return res.status(400).json({ error: "target_id is required to merge" });
        // Target must belong to THIS company; merges stay within one attribute.
        const { rows: tgt } = await pool.query(
          `SELECT attribute_id FROM app.attribute_values WHERE id = $1 AND company_id = $2`,
          [target, req.companyId]
        );
        if (!tgt.length) return res.status(404).json({ error: "Merge target not found" });
        const sources = ids.filter((id) => id !== target); // never merge the target into itself
        if (!sources.length) return res.status(400).json({ error: "Select values other than the merge target" });
        ({ rows } = await pool.query(
          `UPDATE app.attribute_values SET merged_into = $3, is_approved = false, updated_date = NOW()
           WHERE id = ANY($1::uuid[]) AND company_id = $2 AND attribute_id = $4 AND id <> $3 RETURNING attribute_id`,
          [sources, req.companyId, target, tgt[0].attribute_id]
        ));
      } else if (action === "set_group") {
        const raw = req.body?.group_name;
        const group = raw == null || String(raw).trim() === "" ? null : String(raw).trim();
        ({ rows } = await pool.query(
          `UPDATE app.attribute_values SET group_name = $3, updated_date = NOW()
           WHERE id = ANY($1::uuid[]) AND company_id = $2 RETURNING attribute_id`,
          [ids, req.companyId, group]
        ));
      } else {
        const set = action === "approve"
          ? "is_approved = true, is_exception = false, is_blocked = false"
          : "is_blocked = true, is_approved = false";
        ({ rows } = await pool.query(
          `UPDATE app.attribute_values SET ${set}, updated_date = NOW()
           WHERE id = ANY($1::uuid[]) AND company_id = $2 RETURNING attribute_id`,
          [ids, req.companyId]
        ));
      }
      const attrIds = [...new Set(rows.map((r) => r.attribute_id))];
      // Grouping is metadata only - it doesn't change which profiles get tagged.
      if (attrIds.length && action !== "set_group") {
        try { await repropagate(pool, req.companyId, attrIds); }
        catch (e) { console.error("[attr] repropagate after bulk failed:", e.message); }
      }
      // Approving values can fully-verify pages whose every tag is now approved.
      if (action === "approve") await markFullyApprovedPagesReviewed(req.companyId);
      res.json({ ok: true, updated: rows.length });
    } catch (err) { fail(res, err); }
  });

  // Pages a value was extracted from (verify why a value exists).
  router.get("/values/:valueId/pages", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT wp.id, wp.url, wp.title, wp.excerpt
         FROM app.page_attribute_values pav
         JOIN app.web_pages wp ON wp.id = pav.page_id
         WHERE pav.attribute_value_id = $1 AND pav.company_id = $2
         ORDER BY wp.word_count DESC LIMIT 100`,
        [req.params.valueId, req.companyId]
      );
      res.json(rows);
    } catch (err) { fail(res, err); }
  });

  // Merge a value into a canonical one (takes effect on next reconstruct).
  router.post("/values/:valueId/merge", async (req, res) => {
    const target = req.body?.target_id;
    if (!target) return res.status(400).json({ error: "target_id is required" });
    if (target === req.params.valueId) return res.status(400).json({ error: "Cannot merge a value into itself" });
    try {
      // Target must belong to THIS company; merges stay within one attribute.
      const { rows: tgt } = await pool.query(
        `SELECT attribute_id FROM app.attribute_values WHERE id = $1 AND company_id = $2`,
        [target, req.companyId]
      );
      if (!tgt.length) return res.status(404).json({ error: "Merge target not found" });
      const { rows } = await pool.query(
        `UPDATE app.attribute_values
         SET merged_into = $3, is_approved = false, updated_date = NOW()
         WHERE id = $1 AND company_id = $2 AND attribute_id = $4 RETURNING *`,
        [req.params.valueId, req.companyId, target, tgt[0].attribute_id]
      );
      if (!rows.length) return res.status(404).json({ error: "Value not found, or not in the target's attribute" });
      // Canonical resolution changed → re-resolve profile tags immediately.
      try { await repropagate(pool, req.companyId, [rows[0].attribute_id]); }
      catch (e) { console.error("[attr] repropagate after merge failed:", e.message); }
      res.json(rows[0]);
    } catch (err) { fail(res, err); }
  });

  // Un-merge: detach a merged value so it stands on its own again. A curated
  // value returns approved; an AI-discovered one returns to the review queue.
  router.post("/values/:valueId/unmerge", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE app.attribute_values
         SET merged_into = NULL,
             is_approved = CASE WHEN is_exception THEN false ELSE true END,
             updated_date = NOW()
         WHERE id = $1 AND company_id = $2 AND merged_into IS NOT NULL
         RETURNING *`,
        [req.params.valueId, req.companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Merged value not found" });
      try { await repropagate(pool, req.companyId, [rows[0].attribute_id]); }
      catch (e) { console.error("[attr] repropagate after unmerge failed:", e.message); }
      res.json(rows[0]);
    } catch (err) { fail(res, err); }
  });

  router.delete("/values/:valueId", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `DELETE FROM app.attribute_values WHERE id = $1 AND company_id = $2 RETURNING attribute_id`,
        [req.params.valueId, req.companyId]
      );
      if (rows.length) {
        try { await repropagate(pool, req.companyId, [rows[0].attribute_id]); }
        catch (e) { console.error("[attr] repropagate after delete failed:", e.message); }
      }
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ── Tagged pages (behavioral evidence) ──────────────────────
  router.get("/:id/pages", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT wp.id, wp.url, wp.title, wp.excerpt, wp.word_count, wp.fetch_method, wp.last_crawled,
                json_agg(DISTINCT jsonb_build_object('id', av.id, 'value', av.value)) AS values
         FROM app.page_attribute_values pav
         JOIN app.web_pages wp        ON wp.id = pav.page_id
         JOIN app.attribute_values av ON av.id = pav.attribute_value_id
         WHERE pav.attribute_id = $1 AND pav.company_id = $2
         GROUP BY wp.id
         ORDER BY wp.last_crawled DESC NULLS LAST
         LIMIT 300`,
        [req.params.id, req.companyId]
      );
      res.json(rows);
    } catch (err) { fail(res, err); }
  });

  // ── Run / jobs ──────────────────────────────────────────────
  // Create a job of a given type (behavioral = refresh+tag, refresh = scrape only,
  // tag = tag only, retag_attribute = scoped to one attribute over stored content).
  const createJob = async (companyId, userId, attributeId, jobType) => {
    const { rows } = await pool.query(
      `INSERT INTO app.attribute_jobs (company_id, attribute_id, job_type, triggered_by, status, phase)
       VALUES ($1,$2,$3,$4,'queued','queued') RETURNING *`,
      [companyId, attributeId, jobType, userId]
    );
    processNextAttributeJob(pool).catch((e) => console.error("[attr] kick failed:", e.message));
    return rows[0];
  };
  const isBusy = async (companyId, attributeId) => {
    const { rows } = await pool.query(
      `SELECT id FROM app.attribute_jobs
       WHERE company_id = $1 AND status IN ('queued','running')
         AND (attribute_id = $2 OR attribute_id IS NULL OR $2 IS NULL)
       LIMIT 1`,
      [companyId, attributeId]
    );
    return rows.length > 0;
  };
  // Scoped/automatic tag enqueue used by re-run + new-value flows. Coalesces
  // against already-QUEUED work only - a job that's currently RUNNING must NOT
  // cause this to be dropped (the worker is single-flight, so a newly queued job
  // simply runs after the current one drains). Otherwise a new value added during
  // a reconstruct would be silently lost until the next manual run.
  const enqueueTag = async (companyId, userId, attributeId, jobType = "tag") => {
    const { rows } = await pool.query(
      `SELECT id FROM app.attribute_jobs
       WHERE company_id = $1 AND status = 'queued'
         AND (attribute_id = $2 OR attribute_id IS NULL OR $2 IS NULL)
       LIMIT 1`,
      [companyId, attributeId]
    );
    if (rows.length) return null;   // an equivalent job is already waiting
    return createJob(companyId, userId, attributeId, jobType);
  };

  const enqueue = async (req, res, attributeId, jobType = "behavioral") => {
    try {
      if (await isBusy(req.companyId, attributeId)) {
        return res.status(409).json({ error: "A reconstruct job is already running." });
      }
      const job = await createJob(req.companyId, req.user.id, attributeId, jobType);
      res.status(202).json(job);
    } catch (err) { fail(res, err); }
  };

  // Reconstruct = TAG ONLY, over the already-crawled valid pages in app.web_pages.
  // Crawling is a separate, explicit step ("Crawl pages" / refresh) so we never
  // scrape the whole site twice. Per-attribute = re-tag that one attribute across
  // every valid page; "all" = tag every active attribute over new/changed pages.
  router.post("/:id/run", (req, res) => enqueue(req, res, req.params.id, "retag_attribute")); // re-tag one attribute
  router.post("/run", (req, res) => enqueue(req, res, null, "tag"));            // tag all active attributes
  router.post("/tag", (req, res) => enqueue(req, res, null, "tag"));            // tag new/changed pages only

  // Refresh (scrape new/changed pages). Prefers the Selenium Airflow DAG when
  // configured; otherwise the Node worker crawls in-process (Phase-1 fallback).
  router.post("/refresh", async (req, res) => {
    try {
      if (await isBusy(req.companyId, null)) return res.status(409).json({ error: "A reconstruct job is already running." });
      const job = await createJob(req.companyId, req.user.id, null, "refresh");
      // Auto-load the GA top pages into the Test-tab sample set so testing is ready
      // without a separate "Load from GA" click. Fire-and-forget (builds the rollup
      // lazily); failed/excluded URLs are pruned whenever the set is read.
      refreshGaTestLinks(pool, req.companyId).catch((e) => console.warn("[attr] test-link auto-load failed:", e.message));
      try {
        const r = await triggerContentScrape(pool, req.companyId, { jobId: job.id });
        if (r.triggered) {
          // claim the job so the Node worker won't also crawl; the DAG webhook completes it.
          await pool.query(`UPDATE app.attribute_jobs SET status='running', phase='scraping', started_at=NOW() WHERE id=$1`, [job.id]);
        }
      } catch (e) { console.error("[attr] scrape DAG trigger failed, falling back to Node:", e.message); }
      res.status(202).json(job);
    } catch (err) { fail(res, err); }
  });

  // Auto-group this attribute's approved values with AI under group_label.
  router.post("/:id/autogroup", async (req, res) => {
    if (!isAIConfigured()) return res.status(400).json({ error: "AI is not configured." });
    try {
      const { rows: arows } = await pool.query(
        `SELECT group_label FROM app.attributes WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.companyId]
      );
      if (!arows.length) return res.status(404).json({ error: "Attribute not found" });
      const label = String(req.body?.group_label || arows[0].group_label || "").trim();
      if (!label) return res.status(400).json({ error: "Set a grouping dimension (e.g. Continent) first." });
      // persist the label if the caller supplied/changed it
      if (req.body?.group_label) {
        await pool.query(`UPDATE app.attributes SET group_label = $1 WHERE id = $2 AND company_id = $3`,
          [label, req.params.id, req.companyId]);
      }
      const { rows: vals } = await pool.query(
        `SELECT id, value FROM app.attribute_values
         WHERE attribute_id = $1 AND is_approved = true AND merged_into IS NULL`,
        [req.params.id]
      );
      if (!vals.length) return res.json({ ok: true, grouped: 0 });
      const mapping = await groupValues(label, vals.map((v) => v.value), (u) =>
        recordAiUsage(pool, {
          companyId: req.companyId, userId: req.user?.id, feature: "attribute_group",
          model: u.model, inputTokens: u.input, outputTokens: u.output,
          metadata: { attribute_id: req.params.id },
        }));
      let grouped = 0;
      for (const v of vals) {
        const g = mapping[v.value];
        if (g) { await pool.query(`UPDATE app.attribute_values SET group_name = $1 WHERE id = $2 AND company_id = $3`, [g, v.id, req.companyId]); grouped++; }
      }
      res.json({ ok: true, group_label: label, grouped });
    } catch (err) { fail(res, err); }
  });

  // Recompute a rule attribute: sync its values from the ruleset, evaluate over
  // profiles (first-match), and write the profile tags. Synchronous (pure SQL).
  router.post("/:id/recompute", async (req, res) => {
    try {
      const r = await repropagateRule(pool, req.companyId, req.params.id);
      res.json(r);
    } catch (err) { fail(res, err); }
  });

  // ── Manual attributes: assign values to specific people ─────
  const loadAttr = async (id, companyId) => {
    const { rows } = await pool.query(`SELECT scope, value_type, source FROM app.attributes WHERE id = $1 AND company_id = $2`, [id, companyId]);
    return rows[0];
  };
  // Manual attributes can tag either audience; the entity type comes from the
  // assignment (which segment / audience toggle the user chose). Rule attributes
  // are pinned by their scope.
  const entityTypeFor = (a, requested) => {
    if (a?.source === "manual") return requested === "anonymous" ? "anonymous" : "customer";
    return a?.scope === "anonymous" ? "anonymous" : "customer";
  };

  // Shared commit: for single value_type, a first pass (confirm !== true) returns
  // any people already on a different value so the UI can warn + offer "Move here";
  // confirm:true (or multi) proceeds, moving them (single deletes their old value).
  const commitAssign = async (res, a, attributeId, companyId, valueId, entityType, ids, confirm, extra = {}) => {
    const single = a.value_type === "single";
    if (single && confirm !== true) {
      const conflicts = await findSingleConflicts(pool, companyId, attributeId, valueId, entityType, ids);
      if (conflicts.length) return res.json({ pending: true, conflicts, target_count: ids.length, ...extra });
    }
    const n = await assignEntities(pool, companyId, attributeId, valueId, entityType, ids, { single });
    return res.json({ assigned: n, ...extra });
  };

  // Assign a value to an explicit list of entity ids (from search picks).
  router.post("/:id/assign", async (req, res) => {
    try {
      const a = await loadAttr(req.params.id, req.companyId);
      if (!a) return res.status(404).json({ error: "Attribute not found" });
      if (!req.body?.value_id) return res.status(400).json({ error: "value_id required" });
      const entityType = entityTypeFor(a, req.body.entity_type);
      await commitAssign(res, a, req.params.id, req.companyId, req.body.value_id, entityType, req.body.entity_ids || [], req.body.confirm);
    } catch (err) { fail(res, err); }
  });

  // Assign a value to everyone in a segment (least-effort path).
  router.post("/:id/assign-segment", async (req, res) => {
    try {
      const a = await loadAttr(req.params.id, req.companyId);
      if (!a) return res.status(404).json({ error: "Attribute not found" });
      if (!req.body?.value_id || !req.body?.segment_id) return res.status(400).json({ error: "value_id and segment_id required" });
      const { entityType: segType, ids } = await resolveSegmentEntities(pool, req.companyId, req.body.segment_id);
      // Manual attrs follow the segment's audience; rule attrs must match their scope.
      const entityType = a.source === "manual" ? (segType || "customer") : entityTypeFor(a);
      if (a.source !== "manual" && segType && segType !== entityType) {
        return res.status(400).json({ error: `That segment targets ${segType}s, but this attribute applies to ${entityType}s.` });
      }
      await commitAssign(res, a, req.params.id, req.companyId, req.body.value_id, entityType, ids, req.body.confirm);
    } catch (err) { fail(res, err); }
  });

  // Assign a value to a pasted/imported list of identifiers (email/member_id/visitor_id).
  router.post("/:id/assign-import", async (req, res) => {
    try {
      const a = await loadAttr(req.params.id, req.companyId);
      if (!a) return res.status(404).json({ error: "Attribute not found" });
      if (!req.body?.value_id) return res.status(400).json({ error: "value_id required" });
      const entityType = entityTypeFor(a, req.body.entity_type);
      const submitted = (req.body.identifiers || []).filter((x) => String(x || "").trim());
      const ids = await resolveIdentifiers(pool, req.companyId, entityType, submitted);
      await commitAssign(res, a, req.params.id, req.companyId, req.body.value_id, entityType, ids,
        req.body.confirm, { matched: ids.length, submitted: submitted.length });
    } catch (err) { fail(res, err); }
  });

  router.post("/:id/unassign", async (req, res) => {
    try {
      const a = await loadAttr(req.params.id, req.companyId);
      if (!a) return res.status(404).json({ error: "Attribute not found" });
      const entityType = entityTypeFor(a, req.body.entity_type);
      await unassign(pool, req.companyId, req.params.id, req.body.value_id, entityType, req.body.entity_id);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // People carrying more than one value of this attribute - the blocker the UI
  // resolves before value_type can switch to 'single'.
  router.get("/:id/multi-assigned", async (req, res) => {
    try {
      const rows = await findMultiAssigned(pool, req.companyId, req.params.id);
      res.json(rows);
    } catch (err) { fail(res, err); }
  });

  // Resolve duplicates: for each (entity, kept value_id) drop that entity's OTHER
  // values of this attribute, so value_type can become 'single'. One call.
  router.post("/:id/resolve-duplicates", async (req, res) => {
    try {
      const keep = Array.isArray(req.body?.keep) ? req.body.keep : [];
      let resolved = 0;
      for (const k of keep) {
        if (!k?.entity_type || !k?.entity_id || !k?.value_id) continue;
        const { rowCount } = await pool.query(
          `DELETE FROM app.profile_attribute_values
           WHERE company_id = $1 AND attribute_id = $2 AND entity_type = $3 AND entity_id = $4
             AND attribute_value_id <> $5`,
          [req.companyId, req.params.id, k.entity_type, k.entity_id, k.value_id]
        );
        resolved += rowCount;
      }
      if (resolved) await recomputeManualCounts(pool, req.companyId, req.params.id);
      res.json({ resolved });
    } catch (err) { fail(res, err); }
  });

  // Assigned people for one value (for the detail list). Returns both audiences
  // (manual attrs can tag either), each row tagged with its entity_type.
  router.get("/:id/assignments", async (req, res) => {
    try {
      const a = await loadAttr(req.params.id, req.companyId);
      if (!a) return res.status(404).json({ error: "Attribute not found" });
      const limit = Math.min(Number(req.query.limit) || 50, 500);
      const { rows } = await pool.query(
        `SELECT pv.entity_id, pv.entity_type,
                cp.eng_full_name AS name, cp.primary_email AS email
         FROM app.profile_attribute_values pv
         LEFT JOIN app.customer_profiles cp
           ON cp.company_id = pv.company_id AND cp.member_id = pv.entity_id AND pv.entity_type = 'customer'
         WHERE pv.attribute_id = $1 AND pv.attribute_value_id = $2 AND pv.company_id = $3
         ORDER BY pv.created_date DESC LIMIT $4`,
        [req.params.id, req.query.value_id, req.companyId, limit]
      );
      res.json(rows);
    } catch (err) { fail(res, err); }
  });

  // Dry-run: extract values for this attribute on a pasted URL or a few sample
  // crawled pages, WITHOUT persisting. Lets users tune the instruction first.
  router.post("/:id/test", async (req, res) => {
    if (!isAIConfigured()) return res.status(400).json({ error: "AI is not configured." });
    try {
      const { rows: arows } = await pool.query(
        `SELECT id, name, description, value_type, extract_from FROM app.attributes WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.companyId]
      );
      if (!arows.length) return res.status(404).json({ error: "Attribute not found" });
      const { rows: enumRows } = await pool.query(
        `SELECT value FROM app.attribute_values WHERE attribute_id = $1 AND is_approved = true AND merged_into IS NULL`,
        [req.params.id]
      );
      const attribute = { ...arows[0], enumValues: enumRows.map((r) => r.value) };

      const url = decodeUrl(String(req.body?.url || "").trim());
      const useSelectedLinks = req.body?.use_test_links === true;
      let pages = [];
      if (url) {
        if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "Invalid URL" });
        const r = await crawlPage(url, await loadCrawlConfig(pool, req.companyId));
        if (!r.ok) return res.json({ samples: [], note: `Could not read that page: ${r.reason}` });
        pages = [{ url, title: r.title, content: r.text }];
      } else if (useSelectedLinks) {
        // Test the user's selected GA pages. Use the content we ALREADY crawled into
        // app.web_pages (fast, reliable, and exactly what a Reconstruct will tag) -
        // only fall back to a live fetch for a selected page not yet crawled. Links
        // pointing at excluded/invalid pages are skipped.
        const { rows: links } = await pool.query(
          `WITH sel AS (
             SELECT tl.url, tl.hits
             FROM app.web_content_test_links tl
             WHERE tl.company_id = $1 AND tl.is_selected = true
               AND NOT EXISTS (
                 SELECT 1 FROM app.web_pages wp
                 WHERE wp.company_id = $1
                   AND app.norm_url(wp.url) = app.norm_url(tl.url)
                   AND (wp.is_excluded = true OR wp.is_valid = false)
               )
             ORDER BY tl.hits DESC LIMIT 20
           )
           SELECT sel.url, wp.title AS wp_title, wp.content AS wp_content
           FROM sel
           LEFT JOIN LATERAL (
             SELECT title, content FROM app.web_pages wp
             WHERE wp.company_id = $1
               AND app.norm_url(wp.url) = app.norm_url(sel.url)
               AND wp.is_valid = true AND wp.is_excluded = false AND wp.content <> ''
             ORDER BY wp.word_count DESC LIMIT 1
           ) wp ON true
           ORDER BY sel.hits DESC`,
          [req.companyId]
        );
        if (!links.length) return res.json({ samples: [], note: "No pages selected. Tick some pages first." });
        let cfg = null;
        for (const l of links) {
          // Prefer already-crawled content; only hit the network for uncrawled pages.
          if (l.wp_content) { pages.push({ url: l.url, title: l.wp_title, content: l.wp_content }); continue; }
          try {
            cfg = cfg || await loadCrawlConfig(pool, req.companyId);
            const r = await crawlPage(l.url, cfg);
            if (r.ok) pages.push({ url: l.url, title: r.title, content: r.text });
            else pages.push({ url: l.url, title: r.title, content: "", _failed: r.reason });
          } catch (e) { pages.push({ url: l.url, title: "", content: "", _failed: e.message }); }
        }
      } else {
        // "Test top pages": the most-visited VALID pages by GA traffic
        // (ga_landing.path_exploration), top MAX_TEST_LINKS, widening the window as
        // needed. Already-crawled, so no live fetch here.
        pages = await gaTopValidPagesForTest(pool, req.companyId);
      }
      if (!pages.length) return res.json({ samples: [], note: "No crawled pages yet - click \"Crawl pages only\" first, or test a specific URL." });

      // Dry-run tag the sample in parallel (up to MAX_TEST_LINKS pages) so the test
      // returns quickly; order is preserved by writing each result to its index.
      const TEST_CONCURRENCY = 8;
      const samples = new Array(pages.length);
      let idx = 0;
      const worker = async () => {
        while (idx < pages.length) {
          const i = idx++;
          const page = pages[i];
          if (page._failed) { samples[i] = { url: page.url, title: page.title, values: [], error: `Could not read: ${page._failed}` }; continue; }
          try {
            const [r] = await tagPage(page, [attribute], (u) => recordAiUsage(pool, {
              companyId: req.companyId, userId: req.user?.id, feature: "attribute_tag",
              model: u.model, inputTokens: u.input, outputTokens: u.output,
              metadata: { attribute_id: attribute.id, test: true },
            }));
            samples[i] = { url: page.url, title: page.title, values: r?.values || [] };
          } catch (e) {
            samples[i] = { url: page.url, title: page.title, values: [], error: e.message };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(TEST_CONCURRENCY, pages.length) }, worker));
      res.json({ samples });
    } catch (err) { fail(res, err); }
  });

  // Recent run history (for the "last runs" recap in the detail view).
  // Per-attribute history is STRICTLY that attribute's own jobs - if the attribute
  // was never run on its own, its history is empty (global "Reconstruct all" runs
  // are not attributed to it here).
  router.get("/jobs", async (req, res) => {
    try {
      const params = [req.companyId];
      let where = "company_id = $1";
      if (req.query.attribute_id) { params.push(req.query.attribute_id); where += ` AND attribute_id = $2`; }
      const limit = Math.min(Number(req.query.limit) || 10, 50);
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT id, attribute_id, status, phase, progress, triggered_by,
                created_date, started_at, completed_at, error_message
         FROM app.attribute_jobs WHERE ${where}
         ORDER BY created_date DESC LIMIT $${params.length}`,
        params
      );
      res.json(rows);
    } catch (err) { fail(res, err); }
  });

  router.get("/jobs/latest", async (req, res) => {
    try {
      const params = [req.companyId];
      let where = "company_id = $1";
      if (req.query.attribute_id) { params.push(req.query.attribute_id); where += ` AND (attribute_id = $2 OR attribute_id IS NULL)`; }
      const { rows } = await pool.query(
        `SELECT * FROM app.attribute_jobs WHERE ${where} ORDER BY created_date DESC LIMIT 1`,
        params
      );
      res.json(rows[0] || null);
    } catch (err) { fail(res, err); }
  });

  router.post("/jobs/:jobId/cancel", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE app.attribute_jobs SET status = 'cancelled', completed_at = NOW()
         WHERE id = $1 AND company_id = $2 AND status IN ('queued','running') RETURNING *`,
        [req.params.jobId, req.companyId]
      );
      // Also stop the Selenium DAG if this crawl ran through Airflow (no-op for
      // Node-only crawls / when the run already finished). Don't let an Airflow
      // hiccup fail the cancel - the job is already marked cancelled.
      cancelContentScrape(req.companyId, req.params.jobId)
        .catch((e) => console.warn("[attr] DAG cancel failed (non-fatal):", e.message));
      res.json(rows[0] || { ok: true });
    } catch (err) { fail(res, err); }
  });

  return router;
}
