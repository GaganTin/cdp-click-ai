import { Router } from "express";
import { authenticate, resolveCompanyId } from "../middleware/auth.js";

// ── Secure, company-scoped UTM analytics routes ───────────────────────────────
// Every query is parameterized and filtered by company_id (resolved from the
// x-company-id header). Dimension / metric / column names are validated against
// fixed whitelists so they can never be injected. Aggregation runs in Postgres
// (using the (company_id, date) indexes) so payloads stay small for large data.
//
// GA cube redesign: the old high-cardinality full-param UTM table was retired
// (cardinality budget - see lib/cube_catalog). This route now reads the conformed
// daily cubes:
//   - acquisition_session_daily : last-touch source/medium + campaign + metrics
//                                 (session_source_medium is "source / medium";
//                                  we split it in SQL for the separate columns).
//   - geo_daily                 : country / region (replaces country_performance).
//   - tech_daily                : device / OS / browser.
//   - utm_daily_utm_id_performance : per-UTM-id (survives, moved to acquisition).
// session_content / session_term are no longer fetched by any cube, so they are
// gone from the breakdowns, links grid and filters. bounce_rate is not stored
// (GA4 identity: bounce = 1 - engagement_rate) so we derive it here.

const ACQ = "ga_landing.acquisition_session_daily";
const GEO = "ga_landing.geo_daily";
const TECH = "ga_landing.tech_daily";
const UTM_ID = "ga_landing.utm_daily_utm_id_performance";

// GA4 sessionSourceMedium arrives as "source / medium"; split on that separator.
const SRC_EXPR = "split_part(session_source_medium, ' / ', 1)";
const MED_EXPR = "split_part(session_source_medium, ' / ', 2)";

// GA auto-assigned values we exclude from "real UTM" breakdowns.
const AUTO_VALUES = ["(not set)", "(none)", "(organic)", "(direct)", "(referral)", "(cross-network)"];

// Whitelisted filterable / groupable dimensions -> their SQL expression on ACQ.
const DIM_EXPR = {
  session_source: SRC_EXPR,
  session_medium: MED_EXPR,
  session_campaign_name: "session_campaign_name",
};
const DIM_COLS = new Set(Object.keys(DIM_EXPR));

// Whitelisted metrics with their aggregation semantics. Rate metrics aggregate as
// AVG of the stored 0..1 rate; bounce is derived from engagement_rate.
const METRICS = {
  sessions:        { sum: "SUM(sessions)",     rate: false },
  active_users:    { sum: "SUM(active_users)", rate: false },
  new_users:       { sum: "SUM(new_users)",    rate: false },
  bounce_rate:     { rateExpr: "(1 - AVG(engagement_rate))", rate: true },
  engagement_rate: { rateExpr: "AVG(engagement_rate)",       rate: true },
};

// Distinct-value sources for the filter dropdowns (col -> {table, expr}).
const PARAM_SOURCES = {
  session_source:        { table: ACQ,  expr: SRC_EXPR },
  session_medium:        { table: ACQ,  expr: MED_EXPR },
  session_campaign_name: { table: ACQ,  expr: "session_campaign_name" },
  device:                { table: TECH, expr: "device" },
  country:               { table: GEO,  expr: "country" },
};

const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}${String(x.getDate()).padStart(2, "0")}`;
};
const isYmd = (s) => /^\d{8}$/.test(String(s || ""));
// Parse "YYYYMMDD" back into a local Date (midnight), for span/previous-window math.
const fromYmd = (s) => {
  const str = String(s);
  return new Date(Number(str.slice(0, 4)), Number(str.slice(4, 6)) - 1, Number(str.slice(6, 8)));
};

// Resolve start/end (YYYYMMDD) with a 30-day default window.
function dateRange(q) {
  const end = isYmd(q.end) ? q.end : ymd(new Date());
  const start = isYmd(q.start) ? q.start : ymd(new Date(Date.now() - 30 * 86400000));
  return { start, end };
}

// Build `AND <expr> = $n` predicates for any whitelisted dimension passed in the query.
function paramFilters(q, startIdx) {
  const parts = [];
  const params = [];
  let idx = startIdx;
  for (const col of DIM_COLS) {
    const v = q[col];
    if (v != null && v !== "") {
      parts.push(`AND ${DIM_EXPR[col]} = $${idx++}`);
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
                ROUND((1 - AVG(engagement_rate))::numeric, 3) AS avg_bounce_rate,
                ROUND(AVG(engagement_rate)::numeric, 3) AS avg_engagement_rate
         FROM ${ACQ}
         WHERE company_id = $1 AND date >= $2 AND date <= $3 ${f.clause}`,
        [cid, start, end, ...f.params]
      );
      res.json(rows[0] || {});
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/utm/breakdown?dim=&metric=&limit=&excludeAuto=&minSessions=
  // dim is one of session_source / session_medium / session_campaign_name (device
  // and country have their own endpoints since they live in separate cubes).
  router.get("/breakdown", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const dim = String(req.query.dim || "");
    if (!DIM_COLS.has(dim)) return res.status(400).json({ error: "invalid dim" });
    const dimExpr = DIM_EXPR[dim];
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
      autoClause = `AND ${dimExpr} <> ALL($${f.nextIdx}::text[])`;
      if (dim === "session_campaign_name") autoClause += ` AND ${dimExpr} NOT LIKE '{%'`;
    }

    const value = metricMeta.rate
      ? `ROUND((${metricMeta.rateExpr} * 100)::numeric, 1)`
      : metricMeta.sum;
    const having = metricMeta.rate && minSessions ? `HAVING SUM(sessions) >= ${minSessions}` : "";
    const order = metricMeta.rate ? "SUM(sessions) DESC" : "value DESC";

    try {
      const { rows } = await pool.query(
        `SELECT ${dimExpr} AS name, ${value} AS value
         FROM ${ACQ}
         WHERE company_id = $1 AND date >= $2 AND date <= $3 ${f.clause} ${autoClause}
         GROUP BY ${dimExpr} ${having}
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
         FROM ${ACQ}
         WHERE company_id = $1 AND date >= $2 AND date <= $3 ${f.clause}
         GROUP BY date
         ORDER BY date ASC`,
        [cid, start, end, ...f.params]
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/utm/countries - top countries by sessions (geo_daily)
  router.get("/countries", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const { start, end } = dateRange(req.query);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    try {
      const { rows } = await pool.query(
        `SELECT country AS name, SUM(sessions) AS value
         FROM ${GEO}
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

  // GET /api/utm/devices - top devices by sessions (tech_daily)
  router.get("/devices", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const { start, end } = dateRange(req.query);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    try {
      const { rows } = await pool.query(
        `SELECT device AS name, SUM(sessions) AS value
         FROM ${TECH}
         WHERE company_id = $1 AND date >= $2 AND date <= $3
           AND device NOT IN ('(not set)', '')
         GROUP BY device
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
    const src = PARAM_SOURCES[col];
    if (!src) return res.status(400).json({ error: "invalid col" });
    const { start, end } = dateRange(req.query);
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT ${src.expr} AS val
         FROM ${src.table}
         WHERE company_id = $1 AND date >= $2 AND date <= $3
           AND ${src.expr} NOT IN ('(not set)', '(none)', '')
         ORDER BY val
         LIMIT 200`,
        [cid, start, end]
      );
      res.json(rows.map((r) => r.val).filter(Boolean));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/utm/links?days=30 - source/medium/campaign combinations seen in GA,
  // each with its aggregated performance metrics. Includes auto-attributed
  // traffic (direct / organic / referral) - nothing is excluded.
  // days=all (or 0) returns the full history with no date filter.
  // Alternatively pass explicit start & end (YYYYMMDD) for a fixed window (e.g. a
  // calendar month/year). prev=1 returns the immediately-preceding window of EQUAL
  // length in both modes (for period comparison); not available for all-time.
  router.get("/links", async (req, res) => {
    const cid = await companyId(req, res); if (!cid) return;
    const hasRange = isYmd(req.query.start) && isYmd(req.query.end);
    const allTime = !hasRange && (req.query.days === "all" || parseInt(req.query.days, 10) === 0);
    const days = allTime ? null : Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const usePrev = (req.query.prev === "1" || req.query.prev === "true") && !allTime;

    let dateClause = "";
    let params = [cid];
    if (hasRange) {
      let start = req.query.start;
      let end = req.query.end;
      if (usePrev) {
        // Preceding window of equal length: same number of (inclusive) days, ending
        // the day before the selected window starts.
        const spanDays = Math.round((fromYmd(end) - fromYmd(start)) / 86400000) + 1;
        end = ymd(new Date(fromYmd(start).getTime() - 86400000));
        start = ymd(new Date(fromYmd(start).getTime() - spanDays * 86400000));
      }
      dateClause = " AND date >= $2 AND date <= $3";
      params = [cid, start, end];
    } else if (usePrev) {
      const end   = ymd(new Date(Date.now() - days * 86400000));      // = current window's start
      const start = ymd(new Date(Date.now() - days * 2 * 86400000));  // one window earlier
      dateClause = " AND date >= $2 AND date < $3";
      params = [cid, start, end];
    } else if (!allTime) {
      dateClause = " AND date >= $2";
      params = [cid, ymd(new Date(Date.now() - days * 86400000))];
    }

    try {
      const { rows } = await pool.query(
        `SELECT ${SRC_EXPR} AS session_source,
                ${MED_EXPR} AS session_medium,
                session_campaign_name,
                SUM(sessions) AS sessions,
                SUM(active_users) AS active_users,
                SUM(new_users) AS new_users,
                ROUND((1 - AVG(engagement_rate))::numeric, 3) AS bounce_rate,
                ROUND(AVG(engagement_rate)::numeric, 3) AS engagement_rate
         FROM ${ACQ}
         WHERE company_id = $1${dateClause}
         GROUP BY session_source_medium, session_campaign_name
         ORDER BY sessions DESC NULLS LAST
         LIMIT 500`,
        params
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
        `SELECT ${SRC_EXPR} AS session_source,
                ${MED_EXPR} AS session_medium,
                session_campaign_name,
                SUM(sessions) AS total_sessions,
                SUM(active_users) AS total_users,
                SUM(new_users) AS total_new_users,
                ROUND((1 - AVG(engagement_rate))::numeric, 3) AS avg_bounce_rate,
                ROUND(AVG(engagement_rate)::numeric, 3) AS avg_engagement_rate
         FROM ${ACQ}
         WHERE company_id = $1 AND date >= $2 AND session_campaign_name = ANY($3::text[])
         GROUP BY session_source_medium, session_campaign_name`,
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
        `SELECT 1 FROM ${ACQ}
         WHERE company_id = $1 AND session_source_medium = $2
           AND session_campaign_name = $3 AND date >= $4
         LIMIT 1`,
        [cid, `${String(source)} / ${String(medium)}`, String(campaign), start]
      );
      res.json({ exists: rows.length > 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
