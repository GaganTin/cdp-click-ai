import { Router } from "express";
import { authenticate, resolveCompanyId } from "../middleware/auth.js";

// ── Secure, company-scoped UTM analytics routes ───────────────────────────────
// Every query is parameterized and filtered by company_id (resolved from the
// x-company-id header). Dimension / metric / column names are validated against
// fixed whitelists so they can never be injected. Aggregation runs in Postgres
// (using the (company_id, date) indexes) so payloads stay small for large data.

const FULL = "ga_landing.utm_daily_full_param_performance";
const COUNTRY = "ga_landing.country_performance";
const UTM_ID = "ga_landing.utm_daily_utm_id_performance";

// GA auto-assigned values we exclude from "real UTM" breakdowns.
const AUTO_VALUES = ["(not set)", "(none)", "(organic)", "(direct)", "(referral)", "(cross-network)"];

// Whitelisted filterable / groupable dimension columns on the full-param table.
const DIM_COLS = new Set([
  "session_source", "session_medium", "session_campaign_name",
  "session_content", "session_term", "session_utm_id", "device", "country",
]);

// Whitelisted metrics with their aggregation semantics.
const METRICS = {
  sessions:        { col: "sessions",        agg: "SUM", rate: false },
  active_users:    { col: "active_users",    agg: "SUM", rate: false },
  new_users:       { col: "new_users",       agg: "SUM", rate: false },
  bounce_rate:     { col: "bounce_rate",     agg: "AVG", rate: true },
  engagement_rate: { col: "engagement_rate", agg: "AVG", rate: true },
};

const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}${String(x.getDate()).padStart(2, "0")}`;
};
const isYmd = (s) => /^\d{8}$/.test(String(s || ""));

// Resolve start/end (YYYYMMDD) with a 30-day default window.
function dateRange(q) {
  const end = isYmd(q.end) ? q.end : ymd(new Date());
  const start = isYmd(q.start) ? q.start : ymd(new Date(Date.now() - 30 * 86400000));
  return { start, end };
}

// Build `AND col = $n` predicates for any whitelisted dimension passed in the query.
function paramFilters(q, startIdx) {
  const parts = [];
  const params = [];
  let idx = startIdx;
  for (const col of DIM_COLS) {
    const v = q[col];
    if (v != null && v !== "") {
      parts.push(`AND ${col} = $${idx++}`);
      params.push(String(v));
    }
  }
  return { clause: parts.join(" "), params, nextIdx: idx };
}

export function createUtmRouter(pool) {
  const router = Router();
  router.use(authenticate);

  // Verify active membership of the x-company-id workspace; viewers read-only.
  const companyId = (req, res) => resolveCompanyId(pool, req, res);

  // GET /api/utm/kpis - headline totals for the date window
  router.get("/kpis", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const { start, end } = dateRange(req.query);
    const f = paramFilters(req.query, 4);
    try {
      const { rows } = await pool.query(
        `SELECT SUM(sessions) AS total_sessions,
                SUM(active_users) AS total_users,
                SUM(new_users) AS total_new_users,
                ROUND(AVG(bounce_rate)::numeric, 3) AS avg_bounce_rate,
                ROUND(AVG(engagement_rate)::numeric, 3) AS avg_engagement_rate
         FROM ${FULL}
         WHERE company_id = $1 AND date >= $2 AND date <= $3 ${f.clause}`,
        [cid, start, end, ...f.params]
      );
      res.json(rows[0] || {});
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/utm/breakdown?dim=&metric=&limit=&excludeAuto=&minSessions=
  router.get("/breakdown", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const dim = String(req.query.dim || "");
    if (!DIM_COLS.has(dim)) return res.status(400).json({ error: "invalid dim" });
    const metricMeta = METRICS[String(req.query.metric || "sessions")];
    if (!metricMeta) return res.status(400).json({ error: "invalid metric" });

    const { start, end } = dateRange(req.query);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const minSessions = Math.max(parseInt(req.query.minSessions, 10) || 0, 0);
    const f = paramFilters(req.query, 4);

    // Optional exclusion of GA auto-assigned values.
    let autoClause = "";
    const params = [cid, start, end, ...f.params];
    if (req.query.excludeAuto === "true" || req.query.excludeAuto === "1") {
      params.push(AUTO_VALUES);
      autoClause = `AND ${dim} <> ALL($${f.nextIdx}::text[])`;
      if (dim === "session_campaign_name") autoClause += ` AND ${dim} NOT LIKE '{%'`;
    }

    const value = metricMeta.rate
      ? `ROUND((AVG(${metricMeta.col}) * 100)::numeric, 1)`
      : `SUM(${metricMeta.col})`;
    const having = metricMeta.rate && minSessions ? `HAVING SUM(sessions) >= ${minSessions}` : "";
    const order = metricMeta.rate ? "SUM(sessions) DESC" : "value DESC";

    try {
      const { rows } = await pool.query(
        `SELECT ${dim} AS name, ${value} AS value
         FROM ${FULL}
         WHERE company_id = $1 AND date >= $2 AND date <= $3 ${f.clause} ${autoClause}
         GROUP BY ${dim} ${having}
         ORDER BY ${order}
         LIMIT ${limit}`,
        params
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/utm/timeseries - daily sessions over the window
  router.get("/timeseries", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const { start, end } = dateRange(req.query);
    const f = paramFilters(req.query, 4);
    try {
      const { rows } = await pool.query(
        `SELECT TO_CHAR(TO_DATE(date, 'YYYYMMDD'), 'YYYY-MM-DD') AS name, SUM(sessions) AS value
         FROM ${FULL}
         WHERE company_id = $1 AND date >= $2 AND date <= $3 ${f.clause}
         GROUP BY date
         ORDER BY date ASC`,
        [cid, start, end, ...f.params]
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/utm/countries - top countries by sessions (country_performance)
  router.get("/countries", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const { start, end } = dateRange(req.query);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    try {
      const { rows } = await pool.query(
        `SELECT country AS name, SUM(sessions) AS value
         FROM ${COUNTRY}
         WHERE company_id = $1 AND date >= $2 AND date <= $3
           AND country NOT IN ('(not set)', '')
         GROUP BY country
         ORDER BY value DESC
         LIMIT ${limit}`,
        [cid, start, end]
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/utm/utm-ids - sessions by UTM ID (utm_daily_utm_id_performance)
  router.get("/utm-ids", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const { start, end } = dateRange(req.query);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 100);
    try {
      const { rows } = await pool.query(
        `SELECT session_utm_id AS name, SUM(sessions) AS value
         FROM ${UTM_ID}
         WHERE company_id = $1 AND date >= $2 AND date <= $3
           AND session_utm_id NOT IN ('(not set)', '')
         GROUP BY session_utm_id
         ORDER BY value DESC
         LIMIT ${limit}`,
        [cid, start, end]
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/utm/param-values?col= - distinct filter values for a dimension
  router.get("/param-values", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const col = String(req.query.col || "");
    if (!DIM_COLS.has(col)) return res.status(400).json({ error: "invalid col" });
    const { start, end } = dateRange(req.query);
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT ${col} AS val
         FROM ${FULL}
         WHERE company_id = $1 AND date >= $2 AND date <= $3
           AND ${col} NOT IN ('(not set)', '(none)', '')
         ORDER BY val
         LIMIT 200`,
        [cid, start, end]
      );
      res.json(rows.map((r) => r.val).filter(Boolean));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/utm/links?days=30 - distinct UTM-param combinations seen in GA
  router.get("/links", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const start = ymd(new Date(Date.now() - days * 86400000));
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT session_source, session_medium, session_campaign_name,
                session_content, session_term, session_utm_id
         FROM ${FULL}
         WHERE company_id = $1 AND date >= $2
           AND session_campaign_name <> ALL($3::text[])
         ORDER BY session_source, session_medium, session_campaign_name
         LIMIT 500`,
        [cid, start, AUTO_VALUES]
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/utm/campaign-performance { names: [...] } - GA metrics per campaign
  router.post("/campaign-performance", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const names = Array.isArray(req.body?.names) ? req.body.names.filter(Boolean).map(String) : [];
    if (!names.length) return res.json([]);
    const days = Math.min(Math.max(parseInt(req.body.days, 10) || 30, 1), 365);
    const start = ymd(new Date(Date.now() - days * 86400000));
    try {
      const { rows } = await pool.query(
        `SELECT session_source, session_medium, session_campaign_name,
                SUM(sessions) AS total_sessions,
                SUM(active_users) AS total_users,
                SUM(new_users) AS total_new_users,
                ROUND(AVG(bounce_rate)::numeric, 3) AS avg_bounce_rate,
                ROUND(AVG(engagement_rate)::numeric, 3) AS avg_engagement_rate
         FROM ${FULL}
         WHERE company_id = $1 AND date >= $2 AND session_campaign_name = ANY($3::text[])
         GROUP BY session_source, session_medium, session_campaign_name`,
        [cid, start, names]
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/utm/exists?source=&medium=&campaign= - dedup check against GA
  router.get("/exists", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const { source, medium, campaign } = req.query;
    if (!source || !medium || !campaign) return res.json({ exists: false });
    const start = ymd(new Date(Date.now() - 90 * 86400000));
    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM ${FULL}
         WHERE company_id = $1 AND session_source = $2 AND session_medium = $3
           AND session_campaign_name = $4 AND date >= $5
         LIMIT 1`,
        [cid, String(source), String(medium), String(campaign), start]
      );
      res.json({ exists: rows.length > 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
