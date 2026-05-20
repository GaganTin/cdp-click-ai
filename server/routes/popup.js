import { Router } from "express";
import { authenticate } from "../middleware/auth.js";

const INTERACTION_SERVICE_URL = process.env.INTERACTION_SERVICE_URL || "http://localhost:8080";

async function getOrCreateInteractionServiceCompanyId(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT name, settings FROM app.companies WHERE id = $1`,
    [companyId]
  );
  if (!rows.length) throw new Error("Company not found");
  const { name, settings } = rows[0];
  if (settings?.interaction_service_company_id) {
    return settings.interaction_service_company_id;
  }
  const res = await fetch(`${INTERACTION_SERVICE_URL}/company/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || companyId }),
  });
  if (!res.ok) throw new Error(`Interaction service returned ${res.status} when creating company`);
  const data = await res.json();
  const interactionServiceCompanyId = data.id;
  await pool.query(
    `UPDATE app.companies SET settings = settings || $1::jsonb WHERE id = $2`,
    [JSON.stringify({ interaction_service_company_id: interactionServiceCompanyId }), companyId]
  );
  return interactionServiceCompanyId;
}

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
      if (filterCriteria[key]) {
        parts.push(`${col} = $${idx++}`);
        params.push(filterCriteria[key]);
      }
    }
    if (filterCriteria.is_opt_in_email === "true" || filterCriteria.is_opt_in_email === true) {
      parts.push("m.is_opt_in_email = TRUE");
    }
    if (filterCriteria.opt_in_sms === "true" || filterCriteria.opt_in_sms === true) {
      parts.push("m.is_opt_in_sms = TRUE");
    }
    if (filterCriteria.has_ga_activity === "true" || filterCriteria.has_ga_activity === true) {
      parts.push("EXISTS (SELECT 1 FROM public.membership_ap_mapping apm2 WHERE apm2.membership_id = m.member_id)");
    }
    if (filterCriteria.has_seminars === "true" || filterCriteria.has_seminars === true) {
      parts.push("EXISTS (SELECT 1 FROM public.membership_custom_activity mc WHERE mc.membership_id = m.member_id)");
    }
    if (filterCriteria.min_ga_sessions) {
      parts.push(`(SELECT COUNT(*) FROM public.membership_ap_mapping apm3 WHERE apm3.membership_id = m.member_id) >= $${idx++}`);
      params.push(Number(filterCriteria.min_ga_sessions));
    }
  } else {
    // anonymous_profile
    if (filterCriteria.source_medium) {
      parts.push(`pe.session_source_medium = $${idx++}`);
      params.push(filterCriteria.source_medium);
    }
    if (filterCriteria.has_form_complete === "true" || filterCriteria.has_form_complete === true) {
      parts.push(
        `EXISTS (SELECT 1 FROM ga_landing.path_exploration pe2
         WHERE pe2.capsuite_apid = pe.capsuite_apid
           AND pe2.event_name IN ('Event_Form_Complete','form_submit'))`
      );
    }
  }

  return { where: parts.length ? parts.join(" AND ") : "1=1", params };
}

// Given a segment ID, return the array of capsuite_apid values for targeting
async function resolveSegmentToCapsuiteApids(pool, segmentId) {
  if (!segmentId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT segment_type, metadata FROM app.segments WHERE id = $1`,
      [segmentId]
    );
    if (!rows.length) return [];
    const { segment_type, metadata } = rows[0];
    const filterCriteria = metadata?.filter_criteria || null;
    const { where, params } = buildSegmentWhere(filterCriteria, segment_type);

    let sql;
    if (segment_type === "customer") {
      sql = `
        SELECT DISTINCT apm.capsuite_apid
        FROM public.membership_ap_mapping apm
        JOIN public.membership m ON apm.membership_id = m.member_id
        WHERE apm.capsuite_apid IS NOT NULL
          AND apm.capsuite_apid != ''
          AND ${where}
        LIMIT 5000
      `;
    } else {
      sql = `
        SELECT DISTINCT pe.capsuite_apid
        FROM ga_landing.path_exploration pe
        WHERE pe.capsuite_apid IS NOT NULL
          AND pe.capsuite_apid != ''
          AND NOT EXISTS (
            SELECT 1 FROM public.membership_ap_mapping apm
            WHERE apm.capsuite_apid = pe.capsuite_apid
          )
          AND ${where}
        LIMIT 5000
      `;
    }

    const result = await pool.query(sql, params);
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

async function buildInteractionPayload(pool, popup, interactionServiceCompanyId) {
  const now = new Date().toISOString();
  const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const rules = popup.rules || {};

  // Resolve segment targets → capsuite_apid lists
  const anonApids = await resolveSegmentToCapsuiteApids(pool, rules.anonymous_segment_id);
  const custApids = await resolveSegmentToCapsuiteApids(pool, rules.customer_segment_id);
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

  function companyId(req, res) {
    const id = req.headers["x-company-id"];
    if (!id) { res.status(400).json({ error: "x-company-id header required" }); return null; }
    return id;
  }

  // GET /api/popups
  router.get("/", async (req, res) => {
    const cid = companyId(req, res);
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
    const cid = companyId(req, res);
    if (!cid) return;
    const {
      name, interaction_type = "banner", cdp_reference_id,
      rules = {}, content = "", default_recommendation = {},
      is_active = false, is_default = false, start_time, end_time,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    if (!cdp_reference_id?.trim()) return res.status(400).json({ error: "cdp_reference_id is required" });

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
        const isCompanyId = await getOrCreateInteractionServiceCompanyId(pool, cid);
        const payload = await buildInteractionPayload(pool, popup, isCompanyId);
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
    const cid = companyId(req, res);
    if (!cid) return;
    const { id } = req.params;
    const {
      name, interaction_type, cdp_reference_id,
      rules, content, default_recommendation,
      is_active, is_default, start_time, end_time,
    } = req.body;

    try {
      const setParts = [];
      const vals = [];
      let i = 1;

      if (name !== undefined)                  { setParts.push(`name = $${i++}`);                          vals.push(name); }
      if (interaction_type !== undefined)       { setParts.push(`interaction_type = $${i++}`);              vals.push(interaction_type); }
      if (cdp_reference_id !== undefined)       { setParts.push(`cdp_reference_id = $${i++}`);             vals.push(cdp_reference_id); }
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
        const isCompanyId = await getOrCreateInteractionServiceCompanyId(pool, cid);
        const payload = await buildInteractionPayload(pool, popup, isCompanyId);
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
    const cid = companyId(req, res);
    if (!cid) return;
    const { id } = req.params;
    try {
      await pool.query(`DELETE FROM app.popups WHERE id = $1 AND company_id = $2`, [id, cid]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Popup Templates ──────────────────────────────────────────────────────────

  // GET /api/popups/templates
  router.get("/templates", async (req, res) => {
    const cid = companyId(req, res);
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
    const cid = companyId(req, res);
    if (!cid) return;
    const { name, category = "Custom", description = "", content = "" } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.popup_templates (company_id, created_by, name, category, description, content)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [cid, req.user.id, name.trim(), category, description, content]
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/popups/templates/:id
  router.patch("/templates/:id", async (req, res) => {
    const cid = companyId(req, res);
    if (!cid) return;
    const { id } = req.params;
    const { name, category, description, content } = req.body;
    const setParts = [];
    const vals = [];
    let i = 1;
    if (name !== undefined)        { setParts.push(`name = $${i++}`);        vals.push(name); }
    if (category !== undefined)    { setParts.push(`category = $${i++}`);    vals.push(category); }
    if (description !== undefined) { setParts.push(`description = $${i++}`); vals.push(description); }
    if (content !== undefined)     { setParts.push(`content = $${i++}`);     vals.push(content); }
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
    const cid = companyId(req, res);
    if (!cid) return;
    const { id } = req.params;
    try {
      await pool.query(`DELETE FROM app.popup_templates WHERE id = $1 AND company_id = $2`, [id, cid]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/popups/:id/emails - collected emails from interaction service
  router.get("/:id/emails", async (req, res) => {
    const cid = companyId(req, res);
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
        const isCompanyId = await getOrCreateInteractionServiceCompanyId(pool, cid);
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
