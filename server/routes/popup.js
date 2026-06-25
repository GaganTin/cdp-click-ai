import { Router } from "express";
import crypto from "crypto";
import { authenticate, resolveCompanyId } from "../middleware/auth.js";
import { getInteractionServiceCompanyId } from "../lib/interactionService.js";

const INTERACTION_SERVICE_URL = process.env.INTERACTION_SERVICE_URL || "http://localhost:8080";

// Resolve a segment's filter_criteria into SQL WHERE parts (parameterized)
function buildSegmentWhere(filterCriteria, segmentType) {
  const parts = [];
  const params = [];
  let idx = 1;

  if (!filterCriteria) return { where: "1=1", params: [] };

  if (segmentType === "customer") {
    const textFields = {
      reg_channel:        "m.member_reg_channel",
      education_level:    "m.education_level",
      age_group:          "m.age_group",
      gender:             "m.gender",
      nationality:        "m.nationality",
      preferred_language: "m.preferred_language",
      employment_status:  "m.employment_status",
      income_level:       "m.income_level",
      member_type:        "m.member_type",
      preferred_channel:  "m.preferred_channel",
    };
    for (const [key, col] of Object.entries(textFields)) {
      const v = filterCriteria[key];
      if (Array.isArray(v)) {
        if (v.length) { parts.push(`${col} = ANY($${idx++}::text[])`); params.push(v); }
      } else if (v) {
        parts.push(`${col} = $${idx++}`);
        params.push(v);
      }
    }
    if (filterCriteria.is_opt_in_email === "true" || filterCriteria.is_opt_in_email === true) {
      parts.push("m.is_opt_in_email = TRUE");
    }
    if (filterCriteria.opt_in_sms === "true" || filterCriteria.opt_in_sms === true) {
      parts.push("m.is_opt_in_sms = TRUE");
    }
    // GA activity / commerce are pre-aggregated on app.customer_profiles (alias m),
    // so these become simple column predicates (source-agnostic, company-scoped).
    if (filterCriteria.has_ga_activity === "true" || filterCriteria.has_ga_activity === true) {
      parts.push("m.ga_sessions > 0");
    }
    if (filterCriteria.has_seminars === "true" || filterCriteria.has_seminars === true) {
      parts.push("m.seminar_count > 0");
    }
    if (filterCriteria.min_ga_sessions) {
      parts.push(`m.ga_sessions >= $${idx++}`);
      params.push(Number(filterCriteria.min_ga_sessions));
    }
    // Transaction criteria - from the pre-aggregated commerce columns.
    if (filterCriteria.has_transactions === "true" || filterCriteria.has_transactions === true) {
      parts.push("COALESCE(m.order_count, 0) > 0");
    }
    if (filterCriteria.min_orders) {
      parts.push(`COALESCE(m.order_count, 0) >= $${idx++}`);
      params.push(Number(filterCriteria.min_orders));
    }
    if (filterCriteria.max_orders) {
      parts.push(`COALESCE(m.order_count, 0) <= $${idx++}`);
      params.push(Number(filterCriteria.max_orders));
    }
    if (filterCriteria.min_spend) {
      parts.push(`COALESCE(m.total_spend, 0) >= $${idx++}`);
      params.push(Number(filterCriteria.min_spend));
    }
    if (filterCriteria.max_spend) {
      parts.push(`COALESCE(m.total_spend, 0) <= $${idx++}`);
      params.push(Number(filterCriteria.max_spend));
    }
    if (filterCriteria.ordered_within) {
      parts.push(`m.last_order_date >= NOW() - make_interval(days => $${idx++})`);
      params.push(Number(filterCriteria.ordered_within));
    }
    if (Array.isArray(filterCriteria.attribute_value_ids) && filterCriteria.attribute_value_ids.length) {
      parts.push(`EXISTS (SELECT 1 FROM app.profile_attribute_values pav
        JOIN app.attributes pa ON pa.id = pav.attribute_id AND pa.status = 'active'
        WHERE pav.entity_type = 'customer' AND pav.entity_id = m.member_id
          AND pav.attribute_value_id = ANY($${idx++}::uuid[]))`);
      params.push(filterCriteria.attribute_value_ids);
    }
  } else {
    // anonymous_profile
    if (Array.isArray(filterCriteria.source_medium)) {
      if (filterCriteria.source_medium.length) {
        parts.push(`pe.session_source_medium = ANY($${idx++}::text[])`);
        params.push(filterCriteria.source_medium);
      }
    } else if (filterCriteria.source_medium) {
      parts.push(`pe.session_source_medium = $${idx++}`);
      params.push(filterCriteria.source_medium);
    }
    if (Array.isArray(filterCriteria.campaign)) {
      if (filterCriteria.campaign.length) { parts.push(`pe.session_campaign_name = ANY($${idx++}::text[])`); params.push(filterCriteria.campaign); }
    } else if (filterCriteria.campaign) {
      parts.push(`pe.session_campaign_name = $${idx++}`);
      params.push(filterCriteria.campaign);
    }
    if (filterCriteria.has_form_complete === "true" || filterCriteria.has_form_complete === true) {
      parts.push(
        `EXISTS (SELECT 1 FROM ga_landing.path_exploration pe2
         WHERE pe2.capsuite_apid = pe.capsuite_apid
           AND pe2.event_name IN ('Event_Form_Complete','form_submit'))`
      );
    }
    if (Array.isArray(filterCriteria.attribute_value_ids) && filterCriteria.attribute_value_ids.length) {
      parts.push(`EXISTS (SELECT 1 FROM app.profile_attribute_values pav
        JOIN app.attributes pa ON pa.id = pav.attribute_id AND pa.status = 'active'
        WHERE pav.entity_type = 'anonymous' AND pav.entity_id = pe.capsuite_apid
          AND pav.attribute_value_id = ANY($${idx++}::uuid[]))`);
      params.push(filterCriteria.attribute_value_ids);
    }
  }

  return { where: parts.length ? parts.join(" AND ") : "1=1", params };
}

// Given a segment ID, return the array of capsuite_apid values for targeting
async function resolveSegmentToCapsuiteApids(pool, companyId, segmentId) {
  if (!segmentId || !companyId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT segment_type, metadata FROM app.segments WHERE id = $1 AND company_id = $2`,
      [segmentId, companyId]
    );
    if (!rows.length) return [];
    const { segment_type, metadata } = rows[0];
    const filterCriteria = metadata?.filter_criteria || null;
    const { where, params } = buildSegmentWhere(filterCriteria, segment_type);
    // Scope the audience to the CALLER's company (never the segment row's), so a
    // foreign segment id can't resolve another tenant's apids into this popup.
    const cIdx = params.length + 1;
    const allParams = [...params, companyId];

    let sql;
    if (segment_type === "customer") {
      // Known customers' anonymous web ids are pre-stored on the unified profile.
      sql = `
        SELECT DISTINCT vid AS capsuite_apid
        FROM app.customer_profiles m
        CROSS JOIN LATERAL unnest(COALESCE(m.ga_visitor_ids, '{}')) AS vid
        WHERE m.company_id = $${cIdx}
          AND vid IS NOT NULL AND vid != ''
          AND ${where}
        LIMIT 5000
      `;
    } else {
      // Unresolved visitors: GA apids in this company not linked to any customer.
      sql = `
        SELECT DISTINCT pe.capsuite_apid
        FROM ga_landing.path_exploration pe
        WHERE pe.company_id = $${cIdx}
          AND pe.capsuite_apid IS NOT NULL
          AND pe.capsuite_apid != ''
          AND NOT EXISTS (
            SELECT 1 FROM app.profile_identities pi
            WHERE pi.company_id = $${cIdx}
              AND pi.identity_type = 'anonymous_id'
              AND pi.identity_value = pe.capsuite_apid
          )
          AND ${where}
        LIMIT 5000
      `;
    }

    const result = await pool.query(sql, allParams);
    return result.rows.map(r => r.capsuite_apid).filter(Boolean);
  } catch (err) {
    console.warn("Segment resolution failed (non-fatal):", err.message);
    return [];
  }
}

function buildInteractionRules(rules, resolvedApids) {
  const irRules = {
    visit: rules?.visit ?? 3,
    exit_threshold: rules?.exit_threshold ?? 50,
  };
  if (resolvedApids.length) {
    irRules.list_capsuite_apid = resolvedApids;
  }
  return irRules;
}

async function buildInteractionPayload(pool, companyId, popup, interactionServiceCompanyId) {
  const now = new Date().toISOString();
  const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const rules = popup.rules || {};

  // Resolve segment targets → capsuite_apid lists (scoped to the caller's company)
  const anonApids = await resolveSegmentToCapsuiteApids(pool, companyId, rules.anonymous_segment_id);
  const custApids = await resolveSegmentToCapsuiteApids(pool, companyId, rules.customer_segment_id);
  const resolvedApids = [...new Set([...anonApids, ...custApids])];

  return {
    name: popup.name,
    companyId: interactionServiceCompanyId,
    interactionType: popup.interaction_type,
    cdpReferenceId: popup.cdp_reference_id,
    rules: buildInteractionRules(rules, resolvedApids),
    content: popup.content || "",
    defaultRecommendation: popup.default_recommendation || {},
    isActive: popup.is_active,
    isDefault: popup.is_default,
    startTime: popup.start_time ? new Date(popup.start_time).toISOString() : now,
    endTime: popup.end_time ? new Date(popup.end_time).toISOString() : oneYear,
    customer: {},
  };
}

export function createPopupRouter(pool) {
  const router = Router();
  router.use(authenticate);

  // Verify active membership of the x-company-id workspace; viewers read-only.
  const companyId = (req, res) => resolveCompanyId(pool, req, res);

  // GET /api/popups
  router.get("/", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.popups WHERE company_id = $1 ORDER BY created_date DESC`,
        [cid]
      );
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/popups
  router.post("/", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const {
      name, interaction_type = "banner",
      rules = {}, content = "", default_recommendation = {},
      is_active = false, is_default = false, start_time, end_time,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: "name is required" });

    const slug = (name || "popup").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24);
    const rand = Math.random().toString(36).slice(2, 7);
    const cdp_reference_id = `${slug || "popup"}-${rand}`;

    try {
      const { rows } = await pool.query(
        `INSERT INTO app.popups
           (company_id, created_by, name, interaction_type, cdp_reference_id, rules, content,
            default_recommendation, is_active, is_default, start_time, end_time, status)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          cid, req.user.id, name.trim(), interaction_type, cdp_reference_id.trim(),
          JSON.stringify(rules), content, JSON.stringify(default_recommendation),
          is_active, is_default, start_time || null, end_time || null,
          is_active ? "active" : "draft",
        ]
      );
      const popup = rows[0];

      // Sync to interaction service (best-effort)
      try {
        const isCompanyId = await getInteractionServiceCompanyId(pool, cid);
        const payload = await buildInteractionPayload(pool, cid, popup, isCompanyId);
        const irRes = await fetch(`${INTERACTION_SERVICE_URL}/interaction/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (irRes.ok) {
          const irData = await irRes.json();
          await pool.query(
            `UPDATE app.popups SET interaction_service_id = $1 WHERE id = $2`,
            [irData.id, popup.id]
          );
          popup.interaction_service_id = irData.id;
        }
      } catch (syncErr) {
        console.warn("Popup sync to interaction service failed (non-fatal):", syncErr.message);
      }

      res.status(201).json(popup);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/popups/:id
  router.patch("/:id", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const { id } = req.params;
    const {
      name, interaction_type,
      rules, content, default_recommendation,
      is_active, is_default, start_time, end_time,
    } = req.body;

    try {
      const setParts = [];
      const vals = [];
      let i = 1;

      if (name !== undefined)                  { setParts.push(`name = $${i++}`);                          vals.push(name); }
      if (interaction_type !== undefined)       { setParts.push(`interaction_type = $${i++}`);              vals.push(interaction_type); }
      if (rules !== undefined)                  { setParts.push(`rules = $${i++}::jsonb`);                  vals.push(JSON.stringify(rules)); }
      if (content !== undefined)                { setParts.push(`content = $${i++}`);                       vals.push(content); }
      if (default_recommendation !== undefined) { setParts.push(`default_recommendation = $${i++}::jsonb`); vals.push(JSON.stringify(default_recommendation)); }
      if (is_active !== undefined)              {
        setParts.push(`is_active = $${i++}`, `status = $${i++}`);
        vals.push(is_active, is_active ? "active" : "draft");
      }
      if (is_default !== undefined)             { setParts.push(`is_default = $${i++}`);                    vals.push(is_default); }
      if (start_time !== undefined)             { setParts.push(`start_time = $${i++}`);                    vals.push(start_time); }
      if (end_time !== undefined)               { setParts.push(`end_time = $${i++}`);                      vals.push(end_time); }

      if (!setParts.length) return res.status(400).json({ error: "No fields to update" });

      vals.push(id, cid);
      const { rows } = await pool.query(
        `UPDATE app.popups SET ${setParts.join(", ")} WHERE id = $${i++} AND company_id = $${i++} RETURNING *`,
        vals
      );
      if (!rows.length) return res.status(404).json({ error: "Popup not found" });
      const popup = rows[0];

      // Sync update to interaction service (best-effort)
      try {
        const isCompanyId = await getInteractionServiceCompanyId(pool, cid);
        const payload = await buildInteractionPayload(pool, cid, popup, isCompanyId);
        await fetch(`${INTERACTION_SERVICE_URL}/interaction/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (syncErr) {
        console.warn("Popup update sync to interaction service failed (non-fatal):", syncErr.message);
      }

      res.json(popup);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/popups/:id
  router.delete("/:id", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const { id } = req.params;
    try {
      await pool.query(`DELETE FROM app.popups WHERE id = $1 AND company_id = $2`, [id, cid]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Analytics ────────────────────────────────────────────────────────────────

  // GET /api/popups/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Counts (impressions/clicks/emails/dismissals/engagement) are aggregated ONLY
  // over activity that occurred within [from, to] when those params are supplied,
  // so the date period and compare deltas are range-accurate. Without them the
  // numbers are lifetime. Popups with no in-range activity still return (zeros),
  // because the date predicate lives in the activity JOIN, not the WHERE clause.
  router.get("/analytics", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const { from, to } = req.query;
    const params = [cid];
    let actFilter = "", engFilter = "";
    if (from) {
      params.push(from);
      actFilter += ` AND a.created_at >= $${params.length}::date`;
      engFilter += ` AND ri.created_at >= $${params.length}::date`;
    }
    if (to) {
      params.push(to);
      actFilter += ` AND a.created_at < ($${params.length}::date + 1)`;
      engFilter += ` AND ri.created_at < ($${params.length}::date + 1)`;
    }
    try {
      const { rows } = await pool.query(`
        WITH eng AS (
          SELECT
            ri.correlated_interaction_id,
            ROUND(AVG(EXTRACT(EPOCH FROM (na.created_at - ri.created_at))), 1) AS avg_secs
          FROM interaction.activities ri
          CROSS JOIN LATERAL (
            SELECT created_at FROM interaction.activities na2
            WHERE na2.capsuite_sid = ri.capsuite_sid
              AND na2.correlated_interaction_id = ri.correlated_interaction_id
              AND na2.action IN ('click_interaction','close_interaction','email_collection')
              AND na2.created_at > ri.created_at
            ORDER BY na2.created_at
            LIMIT 1
          ) na
          WHERE ri.action = 'retrieve_interaction'${engFilter}
          GROUP BY ri.correlated_interaction_id
        )
        SELECT
          p.id, p.name, p.interaction_type, p.status, p.rules, p.start_time, p.end_time, p.created_date,
          s.name AS segment_name,
          COALESCE(SUM(CASE WHEN a.action='retrieve_interaction' THEN 1 ELSE 0 END),0)::int AS impressions,
          COUNT(DISTINCT CASE WHEN a.action='retrieve_interaction' THEN a.capsuite_sid END)::int AS unique_views,
          COALESCE(SUM(CASE WHEN a.action='click_interaction' THEN 1 ELSE 0 END),0)::int AS clicks,
          COALESCE(SUM(CASE WHEN a.action='email_collection' THEN 1 ELSE 0 END),0)::int AS emails,
          COALESCE(SUM(CASE WHEN a.action='close_interaction' THEN 1 ELSE 0 END),0)::int AS dismissals,
          ROUND(COALESCE(SUM(CASE WHEN a.action='click_interaction' THEN 1 ELSE 0 END),0)::numeric /
            NULLIF(SUM(CASE WHEN a.action='retrieve_interaction' THEN 1 ELSE 0 END),0)*100,1) AS ctr,
          ROUND(COALESCE(SUM(CASE WHEN a.action='email_collection' THEN 1 ELSE 0 END),0)::numeric /
            NULLIF(SUM(CASE WHEN a.action='retrieve_interaction' THEN 1 ELSE 0 END),0)*100,1) AS email_rate,
          ROUND(COALESCE(SUM(CASE WHEN a.action='close_interaction' THEN 1 ELSE 0 END),0)::numeric /
            NULLIF(SUM(CASE WHEN a.action='retrieve_interaction' THEN 1 ELSE 0 END),0)*100,1) AS dismissal_rate,
          ROUND(COALESCE(SUM(CASE WHEN a.action='email_collection' THEN 1 ELSE 0 END),0)::numeric /
            NULLIF(SUM(CASE WHEN a.action='click_interaction' THEN 1 ELSE 0 END),0)*100,1) AS conversion_rate,
          eng.avg_secs AS avg_engagement_secs
        FROM app.popups p
        LEFT JOIN interaction.interactions i ON i.cdp_reference_id = p.cdp_reference_id
        LEFT JOIN interaction.activities a ON a.correlated_interaction_id = i.id${actFilter}
        LEFT JOIN eng ON eng.correlated_interaction_id = i.id
        LEFT JOIN app.segments s ON s.id = COALESCE(
          NULLIF(p.rules->>'anonymous_segment_id',''),
          NULLIF(p.rules->>'customer_segment_id','')
        )::uuid
        WHERE p.company_id = $1
        GROUP BY p.id, p.name, p.interaction_type, p.status, p.rules, p.start_time, p.end_time, p.created_date, s.name, eng.avg_secs
        ORDER BY impressions DESC NULLS LAST, p.created_date DESC
      `, params);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/popups/analytics/daily
  router.get("/analytics/daily", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    try {
      const { rows } = await pool.query(`
        SELECT
          DATE(a.created_at) AS date,
          COUNT(*) FILTER (WHERE a.action='retrieve_interaction') AS impressions,
          COUNT(*) FILTER (WHERE a.action='click_interaction') AS clicks,
          COUNT(*) FILTER (WHERE a.action='email_collection') AS emails
        FROM interaction.activities a
        JOIN interaction.interactions i ON a.correlated_interaction_id = i.id
        JOIN interaction.companies ic ON ic.id = i.company_id
        WHERE ic.cdp_company_id = $1
          AND a.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(a.created_at)
        ORDER BY date ASC
      `, [cid]);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Popup Templates ──────────────────────────────────────────────────────────

  // GET /api/popups/templates
  router.get("/templates", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.popup_templates WHERE company_id = $1 ORDER BY created_date DESC`,
        [cid]
      );
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/popups/templates
  router.post("/templates", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const { name, category = "Custom", description = "", content = "", builder_state } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.popup_templates (company_id, created_by, name, category, description, content, builder_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [cid, req.user.id, name.trim(), category, description, content,
         builder_state ? JSON.stringify(builder_state) : null]
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/popups/templates/:id
  router.patch("/templates/:id", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const { id } = req.params;
    const { name, category, description, content, builder_state } = req.body;
    const setParts = [];
    const vals = [];
    let i = 1;
    if (name !== undefined)          { setParts.push(`name = $${i++}`);                          vals.push(name); }
    if (category !== undefined)      { setParts.push(`category = $${i++}`);                      vals.push(category); }
    if (description !== undefined)   { setParts.push(`description = $${i++}`);                   vals.push(description); }
    if (content !== undefined)       { setParts.push(`content = $${i++}`);                       vals.push(content); }
    if (builder_state !== undefined) { setParts.push(`builder_state = $${i++}::jsonb`);          vals.push(builder_state ? JSON.stringify(builder_state) : null); }
    if (!setParts.length) return res.status(400).json({ error: "No fields to update" });
    vals.push(id, cid);
    try {
      const { rows } = await pool.query(
        `UPDATE app.popup_templates SET ${setParts.join(", ")} WHERE id = $${i++} AND company_id = $${i++} RETURNING *`,
        vals
      );
      if (!rows.length) return res.status(404).json({ error: "Template not found" });
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/popups/templates/:id
  router.delete("/templates/:id", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const { id } = req.params;
    try {
      await pool.query(`DELETE FROM app.popup_templates WHERE id = $1 AND company_id = $2`, [id, cid]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/popups/email-collected - emails collected via popup forms (CDP table)
  router.get("/email-collected", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const {
      popup_id, search,
      status, device_type, browser, country,
      utm_source, utm_campaign,
      popup_name,
      page = "1", limit = "25",
      all = "false",
    } = req.query;
    try {
      const whereParts = ["company_id = $1"];
      const params = [cid];
      let idx = 2;

      if (popup_id)     { whereParts.push(`popup_id = $${idx++}`);          params.push(popup_id); }
      if (popup_name)   { whereParts.push(`popup_name ILIKE $${idx++}`);     params.push(`%${popup_name}%`); }
      if (status)       { whereParts.push(`status = $${idx++}`);             params.push(status); }
      if (device_type)  { whereParts.push(`device_type = $${idx++}`);        params.push(device_type); }
      if (browser)      { whereParts.push(`browser ILIKE $${idx++}`);        params.push(`%${browser}%`); }
      if (country)      { whereParts.push(`country = $${idx++}`);            params.push(country); }
      if (utm_source)   { whereParts.push(`utm_source = $${idx++}`);         params.push(utm_source); }
      if (utm_campaign) { whereParts.push(`utm_campaign ILIKE $${idx++}`);   params.push(`%${utm_campaign}%`); }
      if (search) {
        whereParts.push(
          `(email ILIKE $${idx} OR first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR phone ILIKE $${idx} OR source_url ILIKE $${idx})`
        );
        params.push(`%${search}%`);
        idx++;
      }

      const where = whereParts.join(" AND ");

      if (all === "true") {
        // Full export - no pagination
        const { rows } = await pool.query(
          `SELECT * FROM app.popup_email_collected WHERE ${where} ORDER BY collected_at DESC LIMIT 10000`,
          params
        );
        return res.json({ data: rows, total: rows.length, page: 1, limit: rows.length });
      }

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const offset = (pageNum - 1) * limitNum;

      const [dataRes, countRes] = await Promise.all([
        pool.query(
          `SELECT * FROM app.popup_email_collected WHERE ${where} ORDER BY collected_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
          [...params, limitNum, offset]
        ),
        pool.query(`SELECT COUNT(*) FROM app.popup_email_collected WHERE ${where}`, params),
      ]);

      res.json({
        data: dataRes.rows,
        total: Number(countRes.rows[0].count),
        page: pageNum,
        limit: limitNum,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/popups/email-collected/bulk-status  - bulk update status on selected email records
  router.patch("/email-collected/bulk-status", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const { ids, status } = req.body;
    const VALID = ["new", "contacted", "converted", "unsubscribed"];
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "ids array is required" });
    if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
    try {
      await pool.query(
        `UPDATE app.popup_email_collected SET status=$1 WHERE id = ANY($2::uuid[]) AND company_id=$3`,
        [status, ids, cid]
      );
      res.json({ success: true, updated: ids.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/popups/email-collected/:id/create-profile
  // Creates or links a CDP profile from a collected email entry with full lineage tagging.
  router.post("/email-collected/:id/create-profile", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const { id } = req.params;

    try {
      // Fetch the collected email record
      const { rows: emailRows } = await pool.query(
        `SELECT * FROM app.popup_email_collected WHERE id = $1 AND company_id = $2`,
        [id, cid]
      );
      if (!emailRows.length) return res.status(404).json({ error: "Email record not found" });
      const emailRecord = emailRows[0];

      if (emailRecord.profile_created) {
        return res.status(400).json({ error: "A profile has already been created for this email" });
      }

      const email = emailRecord.email?.toLowerCase().trim();
      if (!email) return res.status(400).json({ error: "No email address on record" });

      // Check if a customer profile already exists with this email (this workspace only)
      const { rows: existingRows } = await pool.query(
        `SELECT member_id, eng_full_name, primary_email FROM app.customer_profiles
         WHERE company_id = $2 AND (LOWER(primary_email) = $1 OR LOWER(secondary_email) = $1)
         LIMIT 1`,
        [email, cid]
      );

      const now = new Date().toISOString();
      const lineage = {
        source:           "popup_email_collection",
        popup_id:         emailRecord.popup_id,
        popup_name:       emailRecord.popup_name,
        cdp_reference_id: emailRecord.popup_ref,
        collected_at:     emailRecord.collected_at,
        created_at:       now,
      };

      if (existingRows.length) {
        // Existing profile - just tag the lineage, don't duplicate
        const existing = existingRows[0];
        lineage.matched_existing = true;
        lineage.matched_member_id = existing.member_id;

        await pool.query(
          `UPDATE app.popup_email_collected
           SET profile_created = true, profile_created_at = NOW(),
               profile_id = $1, profile_lineage = $2::jsonb
           WHERE id = $3`,
          [existing.member_id, JSON.stringify(lineage), id]
        );

        return res.json({
          action:     "linked",
          profile_id: existing.member_id,
          name:       existing.eng_full_name || email,
          lineage,
        });
      }

      // No existing profile - create a new web-collected lead in the unified record.
      lineage.matched_existing = false;

      const { rows: coRows } = await pool.query("SELECT capsuite_ref FROM app.companies WHERE id = $1", [cid]);
      const capsuiteRef = coRows[0]?.capsuite_ref || null;
      const newMemberId = `${capsuiteRef ? capsuiteRef + "_" : ""}pop_${crypto.randomBytes(6).toString("hex")}`;

      await pool.query(
        `INSERT INTO app.customer_profiles
           (company_id, member_id, member_source, capsuite_ref, primary_email, has_email,
            member_reg_channel, last_refreshed)
         VALUES ($1, $2, 'ga', $3, $4, true, 'popup_email_collection', NOW())
         ON CONFLICT (company_id, member_id) DO NOTHING`,
        [cid, newMemberId, capsuiteRef, email]
      );

      // Identity links (email + member_id) so the lead is reachable / stitchable.
      await pool.query(
        `INSERT INTO app.profile_identities
           (company_id, member_id, source, source_id, identity_type, identity_value, is_primary)
         VALUES ($1,$2,'popup',$3,'member_id',$2,true), ($1,$2,'popup',$3,'email',$4,false)
         ON CONFLICT (company_id, identity_type, LOWER(identity_value)) DO NOTHING`,
        [cid, newMemberId, emailRecord.popup_ref || null, email]
      );

      await pool.query(
        `UPDATE app.popup_email_collected
         SET profile_created = true, profile_created_at = NOW(),
             profile_id = $1, profile_lineage = $2::jsonb
         WHERE id = $3`,
        [newMemberId || null, JSON.stringify(lineage), id]
      );

      return res.json({
        action:     "created",
        profile_id: newMemberId || null,
        lineage,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/popups/last-activity - last interaction service activity for this company (for Integrations indicator)
  router.get("/last-activity", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    try {
      const isCompanyId = await getInteractionServiceCompanyId(pool, cid);
      const irRes = await fetch(
        `${INTERACTION_SERVICE_URL}/interaction/last-activity?company_id=${encodeURIComponent(isCompanyId)}`,
        { signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined }
      );
      if (!irRes.ok) return res.json({ has_activity: false, last_activity: null });
      const data = await irRes.json();
      res.json(data);
    } catch {
      res.json({ has_activity: false, last_activity: null });
    }
  });

  // GET /api/popups/:id/emails - collected emails from interaction service
  router.get("/:id/emails", async (req, res) => {
    const cid = await companyId(req, res);
    if (!cid) return;
    const { id } = req.params;
    try {
      const { rows } = await pool.query(
        `SELECT cdp_reference_id FROM app.popups WHERE id = $1 AND company_id = $2`,
        [id, cid]
      );
      if (!rows.length) return res.status(404).json({ error: "Popup not found" });
      const { cdp_reference_id } = rows[0];

      try {
        const isCompanyId = await getInteractionServiceCompanyId(pool, cid);
        const irRes = await fetch(
          `${INTERACTION_SERVICE_URL}/interaction/get-email-list?company_id=${isCompanyId}&cdp_reference_id=${encodeURIComponent(cdp_reference_id)}`
        );
        const data = irRes.ok ? await irRes.json() : { emailList: [] };
        return res.json(data);
      } catch {
        return res.json({ emailList: [] });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
