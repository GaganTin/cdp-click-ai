// Rule attributes: tag profiles whose fields match conditions, first-match bucketed.
// All field access is whitelisted and every value is parameterized - no raw SQL
// from the client ever reaches the database.
//
// Conditions come in two flavours:
//   • column / expr  - compare a profile column or a computed SQL expression
//                      (int / enum / bool / recency).
//   • relation       - membership-style checks against other tables: in a
//                      segment, saw/submitted a pop-up, received/opened an EDM,
//                      or carries another attribute's value (kind="segment"
//                      |"popup"|"edm"|"attribute").

import { customerWhere, anonWhere } from "./attributeManual.js";

const PROFILE_TABLE = {
  customer:  { table: "app.customer_profiles",  id: "member_id" },
  anonymous: { table: "app.anonymous_profiles", id: "visitor_id" },
};

// Completed/confirmed commerce orders (all synced platforms), correlated to the
// current profile alias `p` (commerce.customer_id = customer_profiles.member_id).
const ORDER_FILTER = "s.order_status IN ('completed', 'confirmed')";
const ORDER_COUNT  = `(SELECT COUNT(*) FROM commerce."order" s WHERE s.customer_id = p.member_id AND ${ORDER_FILTER})`;
const ORDER_SPEND  = `(SELECT COALESCE(SUM(s.net_amount), 0) FROM commerce."order" s WHERE s.customer_id = p.member_id AND ${ORDER_FILTER})`;
const ORDER_LAST   = `(SELECT MAX(s.order_date) FROM commerce."order" s WHERE s.customer_id = p.member_id AND ${ORDER_FILTER})`;

// field → { col|expr, type, label, group, kind?, optionsSource?, ops? }
// `group` drives the grouped picker in the UI (mirrors the segment criteria groups).
const RULE_FIELDS = {
  customer: {
    // Demographics
    age_group:          { col: "age_group",          type: "enum", label: "Age group",     group: "Demographics", options: "age_groups" },
    gender:             { col: "gender",             type: "enum", label: "Gender",         group: "Demographics", options: "genders" },
    nationality:        { col: "nationality",        type: "enum", label: "Nationality",    group: "Demographics", options: "nationalities" },
    education_level:    { col: "education_level",    type: "enum", label: "Education",      group: "Demographics", options: "education_levels" },
    income_level:       { col: "income_level",       type: "enum", label: "Income",         group: "Demographics", options: "income_levels" },
    employment_status:  { col: "employment_status",  type: "enum", label: "Employment",     group: "Demographics", options: "employment_statuses" },
    member_type:        { col: "member_type",        type: "enum", label: "Member type",    group: "Demographics", options: "member_types" },
    member_reg_channel: { col: "member_reg_channel", type: "enum", label: "Reg. channel",   group: "Demographics", options: "reg_channels" },
    preferred_language: { col: "preferred_language", type: "enum", label: "Language",       group: "Demographics", options: "languages" },
    // Communication
    is_opt_in_email:    { col: "is_opt_in_email",    type: "bool", label: "Email opted-in",  group: "Communication" },
    is_subscriber_only: { col: "is_subscriber_only", type: "bool", label: "Subscriber only", group: "Communication" },
    // Web activity
    ga_sessions:        { col: "ga_sessions",        type: "int",  label: "GA sessions",     group: "Web activity" },
    ga_page_views:      { col: "ga_page_views",      type: "int",  label: "Page views",      group: "Web activity" },
    ga_form_completes:  { col: "ga_form_completes",  type: "int",  label: "Form completes",  group: "Web activity" },
    ga_whatsapp_clicks: { col: "ga_whatsapp_clicks", type: "int",  label: "WhatsApp clicks", group: "Web activity" },
    ga_last_seen:       { col: "ga_last_seen",       type: "recency", label: "Last seen",    group: "Web activity" },
    // Engagement
    seminar_count:      { col: "seminar_count",      type: "int",  label: "Seminars attended", group: "Engagement" },
    // Purchases (computed from Shopify sales)
    order_count:        { expr: ORDER_COUNT, type: "int",     label: "Order count",  group: "Purchases" },
    total_spend:        { expr: ORDER_SPEND, type: "int",     label: "Total spend",  group: "Purchases" },
    last_order:         { expr: ORDER_LAST,  type: "recency", label: "Last order",   group: "Purchases" },
    // Email engagement (EDM)
    edm:                { kind: "edm",     type: "ref",     label: "Email campaign", group: "Email", optionsSource: "edm",
                          ops: [["received", "received"], ["not_received", "did not receive"], ["opened", "opened"], ["clicked", "clicked"]] },
    // Pop-ups
    popup:              { kind: "popup",   type: "ref",     label: "Pop-up", group: "Pop-ups", optionsSource: "popup",
                          ops: [["submitted", "submitted form"], ["not_submitted", "did not submit"]] },
    // Segments
    segment:            { kind: "segment", type: "ref",     label: "Segment", group: "Segments", optionsSource: "segment",
                          ops: [["in", "is in"], ["not_in", "is not in"]] },
    // Other attributes
    attribute:          { kind: "attribute", type: "refmulti", label: "Attribute value", group: "Attributes", optionsSource: "attribute",
                          ops: [["has_any", "is any of"], ["has_none", "is none of"]] },
  },
  anonymous: {
    // Web activity
    sessions:           { col: "sessions",           type: "int",  label: "Sessions",        group: "Web activity" },
    page_views:         { col: "page_views",         type: "int",  label: "Page views",      group: "Web activity" },
    form_completes:     { col: "form_completes",     type: "int",  label: "Form completes",  group: "Web activity" },
    whatsapp_clicks:    { col: "whatsapp_clicks",    type: "int",  label: "WhatsApp clicks", group: "Web activity" },
    file_downloads:     { col: "file_downloads",     type: "int",  label: "Downloads",       group: "Web activity" },
    total_events:       { col: "total_events",       type: "int",  label: "Total events",    group: "Web activity" },
    last_seen:          { col: "last_seen",          type: "recency", label: "Last seen",    group: "Web activity" },
    // Source
    top_source_medium:  { col: "top_source_medium",  type: "enum", label: "Top source/medium", group: "Source", options: "source_mediums" },
    // Pop-ups
    popup:              { kind: "popup",   type: "ref",     label: "Pop-up", group: "Pop-ups", optionsSource: "popup",
                          ops: [["seen", "has seen"], ["not_seen", "has not seen"], ["clicked", "clicked"], ["submitted", "submitted form"]] },
    // Segments
    segment:            { kind: "segment", type: "ref",     label: "Segment", group: "Segments", optionsSource: "segment",
                          ops: [["in", "is in"], ["not_in", "is not in"]] },
    // Other attributes
    attribute:          { kind: "attribute", type: "refmulti", label: "Attribute value", group: "Attributes", optionsSource: "attribute",
                          ops: [["has_any", "is any of"], ["has_none", "is none of"]] },
  },
};

const OPERATORS = {
  int:     [["=", "="], [">", ">"], [">=", "≥"], ["<", "<"], ["<=", "≤"], ["between", "between"]],
  enum:    [["in", "is any of"], ["not_in", "is none of"]],
  bool:    [["is_true", "is yes"], ["is_false", "is no"]],
  recency: [["within_days", "in the last N days"], ["before_days", "more than N days ago"]],
};

// Count/sum fields that can be re-aggregated over a time window from event-level
// tables (instead of the lifetime cache columns). Keyed by scope → rule field.
// `metric` uses a dedicated aggregate; otherwise `event` counts a GA4 event_name.
const WINDOW_FIELDS = {
  customer: {
    ga_sessions:        { type: "web", metric: "sessions" },
    ga_page_views:      { type: "web", event: "page_view" },
    ga_form_completes:  { type: "web", event: "form_submit" },
    ga_whatsapp_clicks: { type: "web", event: "whatsapp_click" },
    order_count:        { type: "orders", metric: "count" },
    total_spend:        { type: "orders", metric: "spend" },
  },
  anonymous: {
    sessions:        { type: "web", metric: "sessions" },
    page_views:      { type: "web", event: "page_view" },
    form_completes:  { type: "web", event: "form_submit" },
    whatsapp_clicks: { type: "web", event: "whatsapp_click" },
    file_downloads:  { type: "web", event: "file_download" },
    total_events:    { type: "web", metric: "total_events" },
  },
};

// A scalar subquery recomputing one metric over the last `days` for the current
// profile (alias p). Web events come from ga_landing.path_exploration keyed by
// the profile's GA visitor id(s); orders from commerce."order" by customer_id.
// Only called after the operator is validated, so params it pushes are always used.
function windowExpr(scope, win, days, companyId, params) {
  if (win.type === "orders") {
    params.push(days); const d = params.length;
    const base = `FROM commerce."order" s WHERE s.customer_id = p.member_id AND ${ORDER_FILTER} AND s.order_date >= (CURRENT_DATE - $${d}::int)`;
    if (win.metric === "spend") return `(SELECT COALESCE(SUM(s.net_amount), 0) ${base})`;
    return `(SELECT COUNT(*) ${base})`;
  }
  params.push(companyId); const c = params.length;
  params.push(days); const d = params.length;
  const idMatch = scope === "customer" ? "pe.capsuite_apid = ANY(p.ga_visitor_ids)" : "pe.capsuite_apid = p.visitor_id";
  const base = `FROM ga_landing.path_exploration pe
    WHERE pe.company_id = $${c} AND ${idMatch}
      AND pe.date >= to_char((CURRENT_DATE - $${d}::int), 'YYYYMMDD')`;
  if (win.metric === "sessions")     return `(SELECT COUNT(DISTINCT pe.capsuite_sid) ${base})`;
  if (win.metric === "total_events") return `(SELECT COUNT(*) ${base})`;
  params.push(win.event); const e = params.length;
  return `(SELECT COUNT(*) ${base} AND pe.event_name = $${e})`;
}

export function ruleFieldRegistry() {
  const shape = (scope) =>
    Object.entries(RULE_FIELDS[scope]).map(([field, d]) => ({
      field, label: d.label, type: d.type, group: d.group || "Other",
      options: d.options || null, optionsSource: d.optionsSource || null,
      operators: d.ops || OPERATORS[d.type] || [],
    }));
  return { customer: shape("customer"), anonymous: shape("anonymous") };
}

const scopeOf = (s) => (s === "anonymous" ? "anonymous" : "customer");

// Embed a segment's stored filter_criteria as a correlated subquery. Reuses the
// exact same predicate builder the Segments page uses, renaming its `p.` alias to
// `sp.` and re-numbering its placeholders onto the shared params array.
function segmentWhere(scope, fc, params) {
  const built = scope === "customer" ? customerWhere(fc) : anonWhere(fc);
  const offset = params.length;
  let w = String(built.where || "TRUE")
    .replace(/\bp\./g, "sp.")
    .replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
  built.params.forEach((x) => params.push(x));
  return w;
}

// Build SQL for one condition, pushing values onto params. Returns null if invalid.
function condSql(scope, cond, params, ctx = {}) {
  const def = RULE_FIELDS[scope]?.[cond?.field];
  if (!def) return null;
  const t = PROFILE_TABLE[scope];
  const op = cond.operator;
  const v = cond.value;
  const first = Array.isArray(v) ? v[0] : v;

  // ── Relation conditions ──────────────────────────────────────────────────
  if (def.kind === "segment") {
    const fc = ctx.segments?.[first];
    if (!fc) return null;
    const where = segmentWhere(scope, fc, params);
    const inSql = `p.${t.id} IN (SELECT sp.${t.id} FROM ${t.table} sp WHERE ${where})`;
    return op === "not_in" ? `(NOT (${inSql}))` : inSql;
  }

  if (def.kind === "popup") {
    if (scope === "anonymous" && (op === "seen" || op === "not_seen" || op === "clicked")) {
      // Pop-up view/click data lives in the interaction microservice's schema.
      // If it isn't present/synced, "has seen"/"clicked" match nobody and
      // "has not seen" matches everybody - never touch the (absent) table.
      if (!ctx.hasActivities) return op === "not_seen" ? "TRUE" : "FALSE";
      const ref = ctx.popups?.[first];
      if (!ref) return null;
      params.push(ref);
      const actFilter = op === "clicked" ? "AND ia.action ILIKE '%click%'" : "";
      const ex = `EXISTS (SELECT 1 FROM interaction.activities ia
        JOIN interaction.interactions ii ON ii.id = ia.correlated_interaction_id
        WHERE ia.capsuite_apid = p.visitor_id AND ii.cdp_reference_id = $${params.length} ${actFilter})`;
      return op === "not_seen" ? `(NOT ${ex})` : ex;
    }
    if (op === "submitted" || op === "not_submitted") {
      if (!first) return null;
      params.push(first);
      const pid = params.length;
      params.push(ctx.companyId);
      const co = params.length;
      const match = scope === "customer"
        ? "(pec.profile_id = p.member_id OR lower(pec.email) = lower(p.primary_email))"
        : "pec.visitor_id = p.visitor_id";
      const ex = `EXISTS (SELECT 1 FROM app.popup_email_collected pec WHERE pec.popup_id = $${pid}::uuid AND pec.company_id = $${co} AND ${match})`;
      return op === "not_submitted" ? `(NOT ${ex})` : ex;
    }
    return null;
  }

  if (def.kind === "edm") {
    if (!first) return null;
    params.push(first);
    const cid = params.length;
    params.push(ctx.companyId);
    const co = params.length;
    if (op === "received" || op === "not_received") {
      const ex = `EXISTS (SELECT 1 FROM app.edm_sends es WHERE es.edm_campaign_id = $${cid}::uuid
        AND es.company_id = $${co}
        AND es.status IN ('sent', 'delivered')
        AND (es.member_id = p.member_id OR lower(es.email) = lower(p.primary_email)))`;
      return op === "not_received" ? `(NOT ${ex})` : ex;
    }
    if (op === "opened" || op === "clicked") {
      params.push(op === "opened" ? "open" : "click");
      return `EXISTS (SELECT 1 FROM app.edm_events ee WHERE ee.edm_campaign_id = $${cid}::uuid
        AND ee.company_id = $${co}
        AND ee.event_type = $${params.length} AND lower(ee.email) = lower(p.primary_email))`;
    }
    return null;
  }

  if (def.kind === "attribute") {
    const arr = (Array.isArray(v) ? v : [v]).map((x) => String(x)).filter(Boolean);
    if (!arr.length) return null;
    params.push(arr);
    const valIdx = params.length;
    params.push(ctx.companyId);
    const co = params.length;
    const ex = `EXISTS (SELECT 1 FROM app.profile_attribute_values pav
      JOIN app.attributes aa ON aa.id = pav.attribute_id AND aa.status = 'active' AND aa.company_id = $${co}
      WHERE pav.company_id = $${co} AND pav.entity_type = '${scope}' AND pav.entity_id = p.${t.id}
        AND pav.attribute_value_id = ANY($${valIdx}::uuid[]))`;
    return op === "has_none" ? `(NOT ${ex})` : ex;
  }

  // ── Column / expression conditions ───────────────────────────────────────
  const col = def.expr || `p.${def.col}`;
  if (def.type === "int") {
    const validBetween = op === "between" && Array.isArray(v) && v.length === 2;
    const validCmp = ["=", ">", ">=", "<", "<="].includes(op) && v !== "" && v != null;
    if (!validBetween && !validCmp) return null;
    // When a time period is set, re-aggregate this metric over the window from
    // event-level data instead of comparing the lifetime cache column.
    const win = ctx.timePeriod ? WINDOW_FIELDS[scope]?.[cond.field] : null;
    const expr = win ? windowExpr(scope, win, ctx.timePeriod, ctx.companyId, params) : col;
    if (validBetween) {
      params.push(Number(v[0]) || 0, Number(v[1]) || 0);
      return `${expr} BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    params.push(Number(v) || 0);
    return `${expr} ${op} $${params.length}`;
  }
  if (def.type === "enum") {
    const arr = (Array.isArray(v) ? v : [v]).map((x) => String(x)).filter(Boolean);
    if (!arr.length) return null;
    params.push(arr);
    return op === "not_in"
      ? `(${col} IS NULL OR ${col} <> ALL($${params.length}::text[]))`
      : `${col} = ANY($${params.length}::text[])`;
  }
  if (def.type === "bool") {
    return op === "is_false" ? `${col} = FALSE` : `${col} = TRUE`;
  }
  if (def.type === "recency") {
    params.push(Number(v) || 0);
    return op === "before_days"
      ? `${col} <= (CURRENT_DATE - ($${params.length} * INTERVAL '1 day'))`
      : `${col} >= (CURRENT_DATE - ($${params.length} * INTERVAL '1 day'))`;
  }
  return null;
}

// One condition group: conditions combined by the group's op (AND/OR).
function groupSql(scope, group, params, ctx) {
  const parts = (group?.conditions || []).map((c) => condSql(scope, c, params, ctx)).filter(Boolean);
  if (!parts.length) return null;
  return `(${parts.join(group.op === "OR" ? " OR " : " AND ")})`;
}

// A value-rule's predicate. New model: groups[] combined by rule.match (AND/OR),
// each group an AND/OR of conditions - so (A AND B) OR C is expressible. Falls
// back to the legacy flat { op, conditions } shape for rules saved before groups.
function ruleSql(scope, rule, params, ctx) {
  if (Array.isArray(rule?.groups) && rule.groups.length) {
    const parts = rule.groups.map((g) => groupSql(scope, g, params, ctx)).filter(Boolean);
    if (!parts.length) return null;
    return `(${parts.join(rule.match === "AND" ? " AND " : " OR ")})`;
  }
  const parts = (rule?.conditions || []).map((c) => condSql(scope, c, params, ctx)).filter(Boolean);
  if (!parts.length) return null;
  return `(${parts.join(rule.op === "OR" ? " OR " : " AND ")})`;
}

// Load the lookups relation conditions need (segments' criteria + pop-up refs).
export async function loadRuleContext(pool, companyId, scopeRaw) {
  const scope = scopeOf(scopeRaw);
  const segType = scope === "anonymous" ? "anonymous_profile" : "customer";
  const [segs, pops, act] = await Promise.all([
    pool.query(`SELECT id, metadata FROM app.segments WHERE company_id = $1 AND segment_type = $2`, [companyId, segType]),
    pool.query(`SELECT id, cdp_reference_id FROM app.popups WHERE company_id = $1`, [companyId]),
    pool.query(`SELECT to_regclass('interaction.activities') AS t`),
  ]);
  const segments = {};
  for (const r of segs.rows) segments[r.id] = r.metadata?.filter_criteria || {};
  const popups = {};
  for (const r of pops.rows) popups[r.id] = r.cdp_reference_id || "";
  const hasActivities = !!act.rows[0]?.t;
  return { companyId, segments, popups, hasActivities };
}

// A clean positive integer day-window, or null (lifetime, no windowing).
const cleanDays = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : null; };

// How many profiles match one rule (live preview during editing). The window
// (rule.time_period) re-aggregates activity/purchase metrics over that period.
export async function previewRule(pool, companyId, scopeRaw, rule) {
  const scope = scopeOf(scopeRaw);
  const t = PROFILE_TABLE[scope];
  const ctx = await loadRuleContext(pool, companyId, scope);
  ctx.timePeriod = cleanDays(rule?.time_period);
  const params = [];
  const sql = ruleSql(scope, rule, params, ctx);
  if (!sql) return 0;
  const { rows } = await pool.query(`SELECT COUNT(*) AS n FROM ${t.table} p WHERE ${sql}`, params);
  return Number(rows[0].n);
}

// Evaluate the whole ruleset and write profile tags (source='rule'), first-match wins.
export async function repropagateRule(pool, companyId, attributeId) {
  const { rows: arows } = await pool.query(
    `SELECT scope, rule FROM app.attributes WHERE id = $1 AND company_id = $2 AND source = 'rule'`,
    [attributeId, companyId]
  );
  if (!arows.length) return { tagged: 0, values: 0 };
  const scope = scopeOf(arows[0].scope);
  const t = PROFILE_TABLE[scope];
  const cfg = arows[0].rule || {};
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const ruleValues = [...new Set(rules.map((r) => String(r.value || "").trim()).filter(Boolean))];
  // A reapply (manual "Save & apply" or the daily-refresh cron) is a full
  // re-derivation: it adds newly-matching profiles and drops those that no
  // longer match. When daily refresh is off the tags simply aren't re-run, so
  // they stay frozen between manual reapplies.
  const ctx = await loadRuleContext(pool, companyId, scope);
  ctx.timePeriod = cleanDays(cfg.time_period); // window activity/purchase metrics

  // 1) Sync attribute_values to exactly the ruleset's value names.
  if (ruleValues.length) {
    await pool.query(
      `DELETE FROM app.attribute_values WHERE attribute_id = $1 AND lower(value) <> ALL($2::text[])`,
      [attributeId, ruleValues.map((v) => v.toLowerCase())]
    );
  } else {
    await pool.query(`DELETE FROM app.attribute_values WHERE attribute_id = $1`, [attributeId]);
  }
  const valueId = {};
  for (const val of ruleValues) {
    const { rows } = await pool.query(
      `INSERT INTO app.attribute_values (company_id, attribute_id, value, is_approved, is_exception)
       VALUES ($1,$2,$3,true,false)
       ON CONFLICT (attribute_id, lower(value))
       DO UPDATE SET is_approved = true, is_exception = false, merged_into = NULL, updated_date = NOW()
       RETURNING id`,
      [companyId, attributeId, val]
    );
    valueId[val] = rows[0].id;
  }

  // 2) Clear prior rule tags for this attribute (full re-derivation).
  await pool.query(
    `DELETE FROM app.profile_attribute_values WHERE company_id = $1 AND attribute_id = $2 AND source = 'rule'`,
    [companyId, attributeId]
  );

  // 3) Build a first-match CASE and insert one value per matching profile.
  const params = [companyId, attributeId];
  const whens = [];
  for (const r of rules) {
    const vId = valueId[String(r.value || "").trim()];
    if (!vId) continue;
    const sql = ruleSql(scope, r, params, ctx);
    if (!sql) continue;
    params.push(vId);
    whens.push(`WHEN ${sql} THEN $${params.length}::uuid`);
  }
  if (whens.length) {
    await pool.query(
      `INSERT INTO app.profile_attribute_values
         (company_id, entity_type, entity_id, attribute_id, attribute_value_id, source, score, first_seen, last_seen)
       SELECT $1, '${scope}', p.${t.id}, $2, p.vid, 'rule', 1, NOW(), NOW()
       FROM (
         SELECT ${t.id}, (CASE ${whens.join(" ")} ELSE NULL END) AS vid
         FROM ${t.table} p
       ) p
       WHERE p.vid IS NOT NULL AND p.${t.id} IS NOT NULL AND p.${t.id} <> ''
       ON CONFLICT (company_id, entity_type, entity_id, attribute_value_id) DO NOTHING`,
      params
    );
  }

  // 4) Recompute cached counts + mark run.
  await pool.query(
    `UPDATE app.attribute_values av
     SET profile_count = (SELECT COUNT(*) FROM app.profile_attribute_values pv WHERE pv.attribute_value_id = av.id AND pv.company_id = $2)
     WHERE av.attribute_id = $1 AND av.company_id = $2`,
    [attributeId, companyId]
  );
  const { rows: pc } = await pool.query(
    `SELECT COUNT(*) AS n FROM app.profile_attribute_values WHERE attribute_id = $1 AND company_id = $2`,
    [attributeId, companyId]
  );
  await pool.query(
    `UPDATE app.attributes SET last_run_date = NOW(), last_run_status = 'success' WHERE id = $1`,
    [attributeId]
  );
  return { tagged: Number(pc[0].n), values: ruleValues.length };
}

// Nightly job: re-derive every active rule attribute whose config has
// daily_refresh = true. Each reapply is a full add + drop. Attributes with
// daily refresh off are left frozen (only manual "Save & apply" re-runs them).
export async function runDailyRuleRefresh(pool) {
  const { rows } = await pool.query(
    `SELECT id, company_id FROM app.attributes
     WHERE source = 'rule' AND status = 'active' AND rule->>'daily_refresh' = 'true'`
  );
  let refreshed = 0;
  for (const r of rows) {
    try { await repropagateRule(pool, r.company_id, r.id); refreshed++; }
    catch (e) { console.error(`[rule-refresh] attribute ${r.id} failed:`, e.message); }
  }
  return { total: rows.length, refreshed };
}
