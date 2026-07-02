// Behavioral-attribute reconstruct worker.
// Jobs are rows in app.attribute_jobs. Up to ATTR_JOB_CONCURRENCY jobs run at
// once (one per company), each claimed with FOR UPDATE SKIP LOCKED so multiple
// server instances are safe. Pipeline:
//   discover URLs → crawl (hybrid) → AI-tag pages → propagate to profiles.
// AI-discovered values land as review-queue exceptions and do NOT affect
// targeting until approved; only approved values propagate.

import { randomUUID } from "crypto";
import { crawlPage, discoverUrls, contentHash, closeBrowser, isValidTitle, fetchSitemapLastmod, normUrl } from "./webCrawler.js";
import { tagPage, isAIConfigured } from "./attributeAI.js";
import { triggerContentScrape } from "./contentScrapeTrigger.js";
import { recordAiUsage, getAiQuota } from "./aiUsage.js";

// Cap how many blocked pages we hand to the Selenium DAG in one escalation.
const MAX_ESCALATE = 500;

const DISCOVERY_LOOKBACK_DAYS = 90;  // crawl every distinct page seen in the last 90 days
const CRAWL_CONCURRENCY = 5;
const RECRAWL_AFTER_MS = 24 * 60 * 60 * 1000;                        // reuse pages crawled <24h ago

// ── small helpers ─────────────────────────────────────────────
async function setJob(pool, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await pool.query(
    `UPDATE app.attribute_jobs SET ${sets}, updated_date = NOW() WHERE id = $1`,
    [id, ...keys.map((k) => fields[k])]
  );
}

async function mergeProgress(pool, id, patch) {
  await pool.query(
    `UPDATE app.attribute_jobs
     SET progress = progress || $2::jsonb, updated_date = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(patch)]
  );
}

// Lease-guarded heartbeat. Advances progress + updated_date ONLY while this worker
// still holds the job's current lease and the job is still 'running'. Returns false
// if the row was cancelled, or re-claimed by another worker after a stale reset
// (the re-claim stamps a fresh lease) - the caller must then stop immediately so a
// zombie worker can never keep crawling/tagging a job someone else now owns (which
// is what produced the "3750/2792" over-count). Empty patch = ownership probe.
async function heartbeat(pool, id, lease, patch = {}) {
  const { rows } = await pool.query(
    `UPDATE app.attribute_jobs
     SET progress = progress || $2::jsonb, updated_date = NOW()
     WHERE id = $1 AND status = 'running' AND progress->>'lease' = $3
     RETURNING id`,
    [id, JSON.stringify(patch), lease]
  );
  return rows.length > 0;
}

async function runBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

// Rolling pool: keeps `size` tasks in flight at all times (no per-batch barrier),
// so one slow page never stalls the others. fn receives (item, index).
async function mapPool(items, size, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

// ── pipeline ──────────────────────────────────────────────────
// One content job. opts:
//   scrape  - discover + (re)crawl new/changed pages into app.web_pages
//   tag     - LLM-tag new/changed pages (marker = content_hash + attr signature)
//   scopedRetag - re-tag ONE attribute over all valid pages (new-value flow);
//                 ignores the marker, replaces only that attribute's page tags
async function runContentJob(pool, job, opts = { scrape: true, tag: true, scopedRetag: false }) {
  const companyId = job.company_id;
  // The lease this worker claimed the job with (see drainAttributeJobs). Every
  // heartbeat is guarded by it: if a stale reset lets another worker re-claim the
  // job, our heartbeats fail and we bail out instead of double-running it.
  const lease = job.progress?.lease;

  // 1) Active web_content attributes (optionally a single one)
  const attrParams = [companyId];
  let attrWhere = "company_id = $1 AND source = 'web_content' AND status = 'active'";
  if (job.attribute_id) { attrParams.push(job.attribute_id); attrWhere += ` AND id = $2`; }
  const { rows: attrs } = await pool.query(
    `SELECT id, name, description, value_type, scope, extract_from FROM app.attributes WHERE ${attrWhere}`,
    attrParams
  );

  if (!attrs.length) {
    await setJob(pool, job.id, {
      status: "completed", phase: "done", completed_at: new Date().toISOString(),
    });
    await mergeProgress(pool, job.id, { note: "No active behavioral attributes to run." });
    return;
  }
  const attrIds = attrs.map((a) => a.id);

  // approved enum values become hints for the model
  const { rows: enumRows } = await pool.query(
    `SELECT attribute_id, value FROM app.attribute_values
     WHERE attribute_id = ANY($1::uuid[]) AND is_approved = true AND merged_into IS NULL`,
    [attrIds]
  );
  const enumMap = {};
  for (const r of enumRows) (enumMap[r.attribute_id] ||= []).push(r.value);
  const attributes = attrs.map((a) => ({ ...a, enumValues: enumMap[a.id] || [] }));

  // 2) Scraper config + domain for THIS workspace
  const { rows: cfgRows } = await pool.query(
    `SELECT url_pattern, error_strings, valid_content_min_length, valid_title_min_length, excluded_url_patterns
     FROM app.web_content_html_elements WHERE company_id = $1
     ORDER BY created_date ASC LIMIT 1`,
    [companyId]
  );
  const cfg = cfgRows[0] || {};
  const { rows: domRows } = await pool.query(
    `SELECT url_domain FROM app.company_report_config WHERE company_id = $1
     ORDER BY created_date ASC LIMIT 1`,
    [companyId]
  );
  const crawlOpts = {
    minLen: cfg.valid_content_min_length || 60,
    titleMinLen: cfg.valid_title_min_length ?? 1,
    errorStrings: cfg.error_strings || [],
  };

  // 3) Discover + 4) Crawl - only for refresh/full jobs (skipped for tag-only).
  if (opts.scrape) {
  await setJob(pool, job.id, { phase: "discovering" });
  const urls = await discoverUrls(pool, {
    companyId,
    urlPattern: cfg.url_pattern || "",
    urlDomain: domRows[0]?.url_domain || "",
    lookbackDays: DISCOVERY_LOOKBACK_DAYS,
    excludedPatterns: cfg.excluded_url_patterns || [],
  });
  await mergeProgress(pool, job.id, {
    pages_total: urls.length, pages_crawled: 0, pages_tagged: 0, values_found: 0, profiles_tagged: 0,
  });
  // No pages to crawl - almost always because GA data hasn't been synced yet
  // (discovery reads ga_landing.path_exploration). Say so instead of silently
  // "completing" with nothing.
  if (urls.length === 0) {
    await mergeProgress(pool, job.id, {
      note: "No pages found to crawl. Connect Google Analytics AND run a sync (Integrations → Sync) so we know which pages your visitors viewed - a site domain with a sitemap.xml also works.",
    });
  }

  // One sitemap fetch reveals the whole site's <lastmod> set, so we can skip pages
  // that haven't changed without opening each one. Best-effort (empty map = no-op).
  const lastmodMap = await fetchSitemapLastmod(domRows[0]?.url_domain || "");

  // 4) Crawl (hybrid, incremental)
  await setJob(pool, job.id, { phase: "scraping" });
  let crawled = 0, skipped = 0, aborted = false;
  const blockedUrls = [];   // pages the fast crawler couldn't read (escalated to Selenium)
  await runBatches(urls, CRAWL_CONCURRENCY, async (url) => {
    if (aborted) return;
    try {
      const { rows: existing } = await pool.query(
        `SELECT id, last_crawled, is_valid, metadata FROM app.web_pages WHERE company_id = $1 AND url = $2`,
        [companyId, url]
      );
      const row = existing[0];
      const lastCrawled = row?.last_crawled ? new Date(row.last_crawled) : null;
      const fresh = lastCrawled && (Date.now() - lastCrawled.getTime() < RECRAWL_AFTER_MS);
      // Sitemap says unchanged: lastmod older than our last crawl → skip the fetch.
      const lm = lastmodMap.get(normUrl(url));
      const sitemapUnchanged = row && row.is_valid && lastCrawled && lm && lm <= lastCrawled;
      if (row && row.is_valid && (fresh || sitemapUnchanged)) { crawled++; skipped++; return; }

      const res = await crawlPage(url, {
        ...crawlOpts,
        etag: row?.metadata?.http_etag || undefined,
        lastModified: row?.metadata?.http_last_modified || undefined,
      });
      // Conditional GET said 304 Not Modified → just refresh last_crawled, no re-tag.
      if (res.notModified && row) {
        await pool.query(`UPDATE app.web_pages SET last_crawled = NOW() WHERE id = $1`, [row.id]);
        crawled++; skipped++; return;
      }
      const text = res.text || "";
      const excerpt = text.slice(0, 600);
      const hash = contentHash(text);
      const validTitle = isValidTitle(res.title, crawlOpts.errorStrings, crawlOpts.titleMinLen);
      const meta = JSON.stringify({
        crawl_reason: res.ok ? null : (res.reason || "no content"),
        is_new: !row,
        http_etag: res.etag || null,
        http_last_modified: res.lastModified || null,
      });
      await pool.query(
        `INSERT INTO app.web_pages
           (company_id, url, title, content, excerpt, content_hash, word_count,
            is_valid, is_valid_content, is_valid_title, needs_retag, fetch_method, last_crawled, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11, NOW(), $12::jsonb)
         ON CONFLICT (company_id, url) DO UPDATE SET
           title = EXCLUDED.title, content = EXCLUDED.content, excerpt = EXCLUDED.excerpt,
           content_hash = EXCLUDED.content_hash, word_count = EXCLUDED.word_count,
           is_valid = EXCLUDED.is_valid, is_valid_content = EXCLUDED.is_valid_content,
           is_valid_title = EXCLUDED.is_valid_title, fetch_method = EXCLUDED.fetch_method, last_crawled = NOW(),
           needs_retag = app.web_pages.needs_retag OR (app.web_pages.content_hash IS DISTINCT FROM EXCLUDED.content_hash),
           metadata = app.web_pages.metadata || EXCLUDED.metadata`,
        [companyId, url, res.title || "", text, excerpt, hash,
         text.split(/\s+/).filter(Boolean).length, res.ok && validTitle, res.ok, validTitle, res.method, meta]
      );
      // Fast crawler got a blocked / empty / JS-only page - mark for Selenium escalation.
      if (!(res.ok && validTitle)) blockedUrls.push(url);
    } catch (e) {
      console.warn(`[attr] crawl failed ${url}:`, e.message);
      blockedUrls.push(url);
    } finally {
      crawled++;
      // Lease-guarded heartbeat doubles as the cancel/re-claim check: if it fails,
      // we've lost the job (cancelled or stale-reclaimed) - stop crawling at once.
      if (crawled % CRAWL_CONCURRENCY === 0) {
        if (!(await heartbeat(pool, job.id, lease, { pages_crawled: crawled }))) aborted = true;
      }
    }
  });
  await closeBrowser();
  if (aborted) return;
  await heartbeat(pool, job.id, lease, { pages_crawled: crawled, pages_skipped: skipped });

  // Auto-escalate: pages the fast in-process crawler couldn't read (Cloudflare /
  // bot-block / JS-rendered / empty) go to the Selenium DAG, which uses a real
  // headless browser. Fire-and-forget - when the DAG finishes, its scrape-complete
  // webhook enqueues a tag job that re-tags the rescued pages. No-op when Airflow
  // is not configured (triggerContentScrape returns {triggered:false}), so we
  // simply keep the Node results - never blocked on the DAG.
  if (blockedUrls.length) {
    try {
      const r = await triggerContentScrape(pool, companyId, { pageUrls: blockedUrls.slice(0, MAX_ESCALATE) });
      if (r?.triggered) {
        await mergeProgress(pool, job.id, {
          note: `${blockedUrls.length} page(s) couldn't be read by the fast crawler - deep-scraping them with Selenium; they'll be tagged automatically when it finishes.`,
        });
      }
    } catch (e) {
      console.warn("[attr] deep-scrape escalation failed (non-fatal):", e.message);
    }
  }
  } // end opts.scrape

  if (!(await heartbeat(pool, job.id, lease))) return;  // cancelled or re-claimed

  if (opts.tag) {
  // 5) Tag (skip if AI unavailable; re-tag when content OR the attribute
  //    definition changed - description, value_type, or approved-enum hints).
  //    scopedRetag forces a re-tag of the one attribute (new-value flow).
  await setJob(pool, job.id, { phase: "tagging" });
  const sig = contentHash(JSON.stringify(
    attributes
      .map((a) => ({ i: a.id, d: a.description, t: a.value_type, f: a.extract_from, e: (a.enumValues || []).slice().sort() }))
      .sort((x, y) => (x.i < y.i ? -1 : 1))
  ));
  if (!isAIConfigured()) {
    await mergeProgress(pool, job.id, { tagging_note: "AI not configured - skipped tagging." });
  } else if ((await getAiQuota(pool, { companyId })).over) {
    // Monthly AI limit reached: don't spend any more tokens tagging pages.
    await mergeProgress(pool, job.id, { tagging_note: "Monthly AI credit limit reached - tagging skipped. Upgrade your plan or wait for it to reset." });
  } else {
    const { rows: pages } = await pool.query(
      `SELECT id, url, title, content, content_hash, needs_retag, metadata
       FROM app.web_pages
       WHERE company_id = $1 AND is_valid = true AND is_excluded = false AND content <> ''`,
      [companyId]
    );
    let tagged = 0, valuesFound = 0, aborted = false;
    // LLM tagging is I/O-bound (each page waits seconds on Azure), so the loop was
    // the whole job's wall-clock. Run TAG_CONCURRENCY pages at once - the SDK's
    // built-in 429/5xx backoff (maxRetries in attributeAI.js) keeps us under the
    // deployment's rate limit. The AI call already covers ALL attributes per page,
    // so a page's tags are still derived from one call - no change to tag quality.
    const TAG_CONCURRENCY = Math.max(1, Number(process.env.ATTR_TAG_CONCURRENCY) || 8);
    await mapPool(pages, TAG_CONCURRENCY, async (page) => {
      if (aborted) return;
      const marker = `${page.content_hash}:${sig}`;
      // Re-tag when: scopedRetag (new-value flow), the page is flagged needs_retag
      // (e.g. a per-page "re-tag"), or the content+attribute signature changed.
      if (!opts.scopedRetag && !page.needs_retag && page.metadata?.tagged_sig === marker) { tagged++; return; }
      try {
        const results = await tagPage(page, attributes, (u) => recordAiUsage(pool, {
          companyId, feature: "attribute_tag", model: u.model,
          inputTokens: u.input, cachedTokens: u.cached, outputTokens: u.output,
          metadata: { page_id: page.id, job_id: job.id },
        }));
        for (const r of results) {
          // replace this page's tags for this attribute
          await pool.query(
            `DELETE FROM app.page_attribute_values WHERE page_id = $1 AND attribute_id = $2`,
            [page.id, r.attribute_id]
          );
          for (const value of r.values) {
            const v = await upsertValue(pool, companyId, r.attribute_id, value);
            if (v.is_blocked) continue; // stoplisted - never tag pages with it
            await pool.query(
              `INSERT INTO app.page_attribute_values (company_id, page_id, attribute_id, attribute_value_id)
               VALUES ($1,$2,$3,$4) ON CONFLICT (page_id, attribute_value_id) DO NOTHING`,
              [companyId, page.id, r.attribute_id, v.id]
            );
            valuesFound++;
          }
        }
        // content+sig are now reflected; clear the change flag for a full re-tag
        await pool.query(
          `UPDATE app.web_pages SET metadata = metadata || $2::jsonb,
             needs_retag = CASE WHEN $3 THEN false ELSE needs_retag END
           WHERE id = $1`,
          [page.id, JSON.stringify({ tagged_sig: marker }), !opts.scopedRetag]
        );
      } catch (e) {
        console.warn(`[attr] tag failed ${page.url}:`, e.message);
      }
      tagged++;
      // Stop mid-batch if the account crosses its monthly AI limit. Re-checked
      // periodically (not per page) to bound overshoot without a DB hit each time.
      if (tagged % 25 === 0 && (await getAiQuota(pool, { companyId })).over) aborted = true;
      // Heartbeat every ~TAG_CONCURRENCY completed pages (bumps updated_date): a slow
      // LLM call must never let a live job's updated_date drift past the stale-reset
      // window. The lease guard also catches a cancel or stale-reclaim here - if it
      // fails we've lost the job, so stop tagging (one write per batch, not per page).
      if (tagged % TAG_CONCURRENCY === 0) {
        if (!(await heartbeat(pool, job.id, lease, { pages_tagged: tagged, values_found: valuesFound }))) aborted = true;
      }
    });
    if (aborted) return;
    await heartbeat(pool, job.id, lease, { pages_tagged: tagged, values_found: valuesFound });
  }
  } // end opts.tag

  if (!(await heartbeat(pool, job.id, lease))) return;  // cancelled or re-claimed

  // 6) Propagate approved tags to profiles + recompute counts
  await setJob(pool, job.id, { phase: "propagating" });
  await repropagate(pool, companyId, attrIds);

  // Mark attributes whose values are now applied to content (locks extract_from).
  await pool.query(
    `UPDATE app.attributes a SET content_applied = true
     WHERE a.id = ANY($1::uuid[]) AND a.content_applied = false
       AND EXISTS (SELECT 1 FROM app.page_attribute_values pav WHERE pav.attribute_id = a.id)`,
    [attrIds]
  );

  // 7) Mark attributes done
  const { rows: profCount } = await pool.query(
    `SELECT COUNT(DISTINCT (entity_type, entity_id)) AS n
     FROM app.profile_attribute_values
     WHERE company_id = $1 AND attribute_id = ANY($2::uuid[])`,
    [companyId, attrIds]
  );
  await pool.query(
    `UPDATE app.attributes SET last_run_date = NOW(), last_run_status = 'success'
     WHERE id = ANY($1::uuid[])`,
    [attrIds]
  );
  await mergeProgress(pool, job.id, { profiles_tagged: Number(profCount[0]?.n || 0) });
  // Complete only if we still hold the lease - never mark done a job another worker
  // re-claimed and may still be running.
  await pool.query(
    `UPDATE app.attribute_jobs
     SET status = 'completed', phase = 'done', completed_at = NOW(), updated_date = NOW()
     WHERE id = $1 AND status = 'running' AND progress->>'lease' = $2`,
    [job.id, lease]
  );
}

// Find or create an attribute value. Unknown values enter the review queue
// (is_exception=true, is_approved=false) so they don't affect targeting.
async function upsertValue(pool, companyId, attributeId, value) {
  const { rows } = await pool.query(
    `INSERT INTO app.attribute_values (company_id, attribute_id, value, is_exception, is_approved)
     VALUES ($1,$2,$3,true,false)
     ON CONFLICT (attribute_id, lower(value)) DO UPDATE SET updated_date = NOW()
     RETURNING id, is_blocked`,
    [companyId, attributeId, value]
  );
  return rows[0];
}

async function propagate(pool, companyId, attrIds, entityType) {
  const isAnon = entityType === "anonymous";
  const profileTable = isAnon ? "app.anonymous_profiles" : "app.customer_profiles";
  const idCol   = isAnon ? "visitor_id" : "member_id";
  const pagesCol = isAnon ? "pages_visited" : "ga_pages_visited";
  const scopeVals = isAnon ? ["anonymous", "both"] : ["customer", "both"];

  await pool.query(
    `INSERT INTO app.profile_attribute_values
       (company_id, entity_type, entity_id, attribute_id, attribute_value_id, source, score, first_seen, last_seen)
     SELECT $1, $3, p.${idCol}, pav.attribute_id, cav.id, 'web_content',
            COUNT(DISTINCT wp.id), NOW(), NOW()
     FROM ${profileTable} p
     CROSS JOIN LATERAL unnest(p.${pagesCol}) AS vp(url)
     JOIN app.web_pages wp
       ON wp.company_id = $1 AND wp.is_excluded = false
          AND app.norm_url(wp.url) = app.norm_url(vp.url)
     JOIN app.page_attribute_values pav ON pav.page_id = wp.id
     JOIN app.attributes a       ON a.id = pav.attribute_id AND a.scope = ANY($4::text[])
     JOIN app.attribute_values av ON av.id = pav.attribute_value_id
     JOIN app.attribute_values cav ON cav.id = COALESCE(av.merged_into, av.id)
     WHERE pav.attribute_id = ANY($2::uuid[])
       AND cav.is_approved = true AND cav.merged_into IS NULL
       AND p.${idCol} IS NOT NULL AND p.${idCol} <> ''
     GROUP BY p.${idCol}, pav.attribute_id, cav.id
     ON CONFLICT (company_id, entity_type, entity_id, attribute_value_id)
     DO UPDATE SET score = EXCLUDED.score, last_seen = NOW(), source = 'web_content'
       WHERE app.profile_attribute_values.source = 'web_content'`,
    [companyId, attrIds, entityType, scopeVals]
  );
}

// Re-resolve profile tags from already-tagged pages (no crawl, no LLM) and
// refresh cached counts. Cheap enough to run synchronously when a value is
// approved / merged / deleted, so targeting reflects the change immediately.
export async function repropagate(pool, companyId, attrIds) {
  if (!attrIds?.length) return;
  await pool.query(
    `DELETE FROM app.profile_attribute_values
     WHERE company_id = $1 AND source = 'web_content' AND attribute_id = ANY($2::uuid[])`,
    [companyId, attrIds]
  );
  await propagate(pool, companyId, attrIds, "anonymous");
  await propagate(pool, companyId, attrIds, "customer");
  await pool.query(
    `UPDATE app.attribute_values av SET
       page_count    = (SELECT COUNT(DISTINCT pav.page_id) FROM app.page_attribute_values pav WHERE pav.attribute_value_id = av.id AND pav.company_id = $2),
       profile_count = (SELECT COUNT(*) FROM app.profile_attribute_values pv WHERE pv.attribute_value_id = av.id AND pv.company_id = $2)
     WHERE av.attribute_id = ANY($1::uuid[]) AND av.company_id = $2`,
    [attrIds, companyId]
  );
}

// Re-tag a SPECIFIC set of pages with a SPECIFIC set of attributes (the "changed
// pages" review flow). Only the chosen attributes' tags on those pages are replaced
// - every other attribute keeps its existing tags. Clears needs_retag on the pages
// (the user has made a decision) and repropagates the affected attributes. Runs
// inline with bounded concurrency; intended for the handful of changed pages a user
// reviews at a time.
export async function retagPagesScoped(pool, companyId, pageIds, attributeIds, onUsage = null) {
  if (!pageIds?.length || !attributeIds?.length) return { pages: 0, values: 0 };
  if (!isAIConfigured()) throw new Error("Azure OpenAI is not configured.");

  const { rows: attrs } = await pool.query(
    `SELECT id, name, description, value_type, scope, extract_from FROM app.attributes
     WHERE company_id = $1 AND source = 'web_content' AND status = 'active' AND id = ANY($2::uuid[])`,
    [companyId, attributeIds]
  );
  if (!attrs.length) return { pages: 0, values: 0 };
  const ids = attrs.map((a) => a.id);
  const { rows: enumRows } = await pool.query(
    `SELECT attribute_id, value FROM app.attribute_values
     WHERE attribute_id = ANY($1::uuid[]) AND is_approved = true AND merged_into IS NULL`,
    [ids]
  );
  const enumMap = {};
  for (const r of enumRows) (enumMap[r.attribute_id] ||= []).push(r.value);
  const attributes = attrs.map((a) => ({ ...a, enumValues: enumMap[a.id] || [] }));

  const { rows: allPages } = await pool.query(
    `SELECT id, url, title, content, content_hash FROM app.web_pages
     WHERE company_id = $1 AND id = ANY($2::uuid[])
       AND is_valid = true AND is_excluded = false AND content <> ''`,
    [companyId, pageIds]
  );
  // Cap per call so this synchronous request can't run long enough to time out; the
  // caller re-runs for the rest (unprocessed pages keep their needs_retag flag).
  const MAX_PER_CALL = Math.max(1, Number(process.env.ATTR_RETAG_MAX) || 100);
  const pages = allPages.slice(0, MAX_PER_CALL);
  const remaining = allPages.length - pages.length;

  let valuesFound = 0;
  const TAG_CONCURRENCY = Math.max(1, Number(process.env.ATTR_TAG_CONCURRENCY) || 8);
  await mapPool(pages, TAG_CONCURRENCY, async (page) => {
    try {
      const results = await tagPage(page, attributes, onUsage);
      for (const r of results) {
        // replace ONLY this (chosen) attribute's tags on the page
        await pool.query(
          `DELETE FROM app.page_attribute_values WHERE page_id = $1 AND attribute_id = $2`,
          [page.id, r.attribute_id]
        );
        for (const value of r.values) {
          const v = await upsertValue(pool, companyId, r.attribute_id, value);
          if (v.is_blocked) continue;
          await pool.query(
            `INSERT INTO app.page_attribute_values (company_id, page_id, attribute_id, attribute_value_id)
             VALUES ($1,$2,$3,$4) ON CONFLICT (page_id, attribute_value_id) DO NOTHING`,
            [companyId, page.id, r.attribute_id, v.id]
          );
          valuesFound++;
        }
      }
    } catch (e) {
      console.warn(`[attr] scoped retag failed ${page.url}:`, e.message);
    }
  });

  // Clear the "changed" flag only on the pages we actually processed this call.
  const doneIds = pages.map((p) => p.id);
  if (doneIds.length) {
    await pool.query(
      `UPDATE app.web_pages SET needs_retag = false WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [companyId, doneIds]
    );
  }
  await repropagate(pool, companyId, ids);
  return { pages: pages.length, values: valuesFound, remaining };
}

// ── queue plumbing ────────────────────────────────────────────
// A job is "stale" only if its updated_date hasn't advanced for this long. A live
// worker heartbeats (mergeProgress) every crawled batch and every tagged page, so
// the gap between heartbeats is bounded by a single crawl/LLM call - comfortably
// under this window even on the SDK's worst-case retry timeout (~30 min). That
// guarantees a job is reset ONLY when its worker actually died, so the concurrent
// claim below can never re-run a job that's still in flight (no double-run).
const STALE_JOB_MINUTES = Math.max(35, Number(process.env.ATTR_STALE_JOB_MINUTES) || 45);
async function resetStaleJobs(pool) {
  try {
    const { rowCount } = await pool.query(
      `UPDATE app.attribute_jobs SET status = 'queued', updated_date = NOW()
       WHERE status = 'running' AND updated_date < NOW() - ($1::int * INTERVAL '1 minute')`,
      [STALE_JOB_MINUTES]
    );
    if (rowCount > 0) console.log(`[attr-queue] Reset ${rowCount} stale job(s) → queued`);
  } catch (e) {
    console.error("[attr-queue] resetStaleJobs:", e.message);
  }
}

// Bounded-concurrency queue: up to ATTR_JOB_CONCURRENCY jobs run at once, but
// NEVER two for the same company (the claim query below excludes any company
// that already has a running job). This keeps one tenant's large "reconstruct
// all" from blocking other tenants - their jobs run on the other worker slots -
// while still serialising a single tenant's work so its DELETE+re-INSERT
// propagation can never race itself. Set ATTR_JOB_CONCURRENCY=1 to fall back to
// the old strict single-flight behaviour.
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.ATTR_JOB_CONCURRENCY) || 3);
let _activeWorkers = 0;

// Top up the worker pool to the concurrency cap. Each worker drains until no
// job is currently claimable, then exits; a fresh enqueue (createJob) or the
// periodic tick tops the pool back up. Synchronous loop, so no race on the count.
async function processNextAttributeJob(pool) {
  while (_activeWorkers < MAX_CONCURRENT_JOBS) {
    _activeWorkers++;
    drainAttributeJobs(pool)
      .catch((e) => console.error("[attr-queue] worker crashed:", e.message))
      .finally(() => { _activeWorkers--; });
  }
}

async function drainAttributeJobs(pool) {
  for (;;) {
    let job;
    try {
      // Claim the oldest queued job whose company has no job already running.
      // FOR UPDATE OF j SKIP LOCKED locks only the chosen row and lets parallel
      // workers grab different rows concurrently.
      // Stamp a fresh lease on every claim. A stale-reset + re-claim of the same job
      // gets a NEW lease, so the original (still-running) worker's lease-guarded
      // heartbeat starts failing and it aborts - no two workers advance one job.
      const lease = randomUUID();
      const { rows } = await pool.query(`
        UPDATE app.attribute_jobs
        SET status = 'running', started_at = NOW(), updated_date = NOW(),
            progress = COALESCE(progress, '{}'::jsonb) || jsonb_build_object('lease', $1::text)
        WHERE id = (
          SELECT j.id FROM app.attribute_jobs j
          WHERE j.status = 'queued'
            AND NOT EXISTS (
              SELECT 1 FROM app.attribute_jobs r
              WHERE r.company_id = j.company_id AND r.status = 'running'
            )
          ORDER BY j.created_date ASC
          FOR UPDATE OF j SKIP LOCKED
          LIMIT 1
        )
        RETURNING *`, [lease]);
      job = rows[0];
    } catch (e) {
      console.error("[attr-queue] job claim error:", e.message);
      return;
    }
    // Nothing claimable right now: queue empty, or every queued job belongs to a
    // company that already has one running. A finishing worker re-tops the pool.
    if (!job) return;

    try {
      const OPTS = {
        behavioral:      { scrape: true,  tag: true,  scopedRetag: false },
        refresh:         { scrape: true,  tag: false, scopedRetag: false },
        tag:             { scrape: false, tag: true,  scopedRetag: false },
        retag_attribute: { scrape: false, tag: true,  scopedRetag: true  },
      };
      const opts = OPTS[job.job_type];
      if (opts) {
        await runContentJob(pool, job, opts);
      } else {
        await setJob(pool, job.id, {
          status: "failed", error_message: `Unsupported job_type "${job.job_type}"`,
          completed_at: new Date().toISOString(),
        });
      }
      console.log(`[attr-queue] Completed job ${job.id}`);
    } catch (e) {
      console.error(`[attr-queue] Job ${job.id} failed:`, e.message);
      await setJob(pool, job.id, {
        status: "failed", error_message: String(e.message || e), completed_at: new Date().toISOString(),
      }).catch(() => {});
      await pool.query(
        `UPDATE app.attributes SET last_run_status = 'failed' WHERE id = $1`,
        [job.attribute_id]
      ).catch(() => {});
    }
    // loop: pick up the next claimable job (incl. anything enqueued during this run)
  }
}

export function startAttributeQueueWorker(pool) {
  console.log("  Queue: Attribute reconstruct worker starting");
  setTimeout(async () => {
    await resetStaleJobs(pool);
    await processNextAttributeJob(pool);
  }, 3_000);
  setInterval(async () => {
    await resetStaleJobs(pool);
    await processNextAttributeJob(pool);
  }, 30_000);
}

export { processNextAttributeJob };
