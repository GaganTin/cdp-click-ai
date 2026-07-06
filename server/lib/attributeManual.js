// Manual attributes: the user assigns values to specific people. Three low-effort
// paths - from an existing segment, by searching profiles, or a CSV/list import.
// Everything writes profile_attribute_values(source='manual'), which Segments and
// Profiles already read. Manual tags are never overwritten by any recompute.

// Assign one value to a set of entities. For single-value attributes the entity's
// other manual values for this attribute are cleared first (one value per person).
export async function assignEntities(pool, companyId, attributeId, valueId, entityType, entityIds, { single = false } = {}) {
  const ids = [...new Set((entityIds || []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!ids.length) return 0;
  if (single) {
    await pool.query(
      `DELETE FROM app.profile_attribute_values
       WHERE company_id = $1 AND attribute_id = $2 AND source = 'manual' AND entity_type = $3 AND entity_id = ANY($4::text[])`,
      [companyId, attributeId, entityType, ids]
    );
  }
  const { rowCount } = await pool.query(
    `INSERT INTO app.profile_attribute_values
       (company_id, entity_type, entity_id, attribute_id, attribute_value_id, source, score, first_seen, last_seen)
     SELECT $1, $2, x, $3, $4, 'manual', 1, NOW(), NOW() FROM unnest($5::text[]) x
     ON CONFLICT (company_id, entity_type, entity_id, attribute_value_id) DO NOTHING`,
    [companyId, entityType, attributeId, valueId, ids]
  );
  await recomputeManualCounts(pool, companyId, attributeId);
  return ids.length;
}

// For single value_type: among the target entities, which already carry a
// DIFFERENT value of this attribute (so assigning here would move them). Returns
// rows with the current value + a friendly name/email (customers) for the warning.
export async function findSingleConflicts(pool, companyId, attributeId, valueId, entityType, entityIds) {
  const ids = [...new Set((entityIds || []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `SELECT pv.entity_id,
            COALESCE(av.display_label, av.value) AS current_value,
            cp.eng_full_name AS name, cp.primary_email AS email
     FROM app.profile_attribute_values pv
     JOIN app.attribute_values av ON av.id = pv.attribute_value_id
     LEFT JOIN app.customer_profiles cp
       ON cp.company_id = pv.company_id AND cp.member_id = pv.entity_id AND pv.entity_type = 'customer'
     WHERE pv.company_id = $1 AND pv.attribute_id = $2 AND pv.entity_type = $3
       AND pv.entity_id = ANY($4::text[]) AND pv.attribute_value_id <> $5`,
    [companyId, attributeId, entityType, ids, valueId]
  );
  return rows;
}

// Entities carrying MORE THAN ONE value of this attribute (per entity type) -
// the blocker that must be cleared before value_type can become 'single'.
export async function findMultiAssigned(pool, companyId, attributeId) {
  const { rows } = await pool.query(
    `SELECT pv.entity_type, pv.entity_id,
            cp.eng_full_name AS name, cp.primary_email AS email,
            json_agg(json_build_object('value_id', pv.attribute_value_id,
                                       'value', COALESCE(av.display_label, av.value))
                     ORDER BY pv.created_date) AS values
     FROM app.profile_attribute_values pv
     JOIN app.attribute_values av ON av.id = pv.attribute_value_id
     LEFT JOIN app.customer_profiles cp
       ON cp.company_id = pv.company_id AND cp.member_id = pv.entity_id AND pv.entity_type = 'customer'
     WHERE pv.company_id = $1 AND pv.attribute_id = $2
     GROUP BY pv.entity_type, pv.entity_id, cp.eng_full_name, cp.primary_email
     HAVING COUNT(*) > 1
     ORDER BY pv.entity_type, COUNT(*) DESC`,
    [companyId, attributeId]
  );
  return rows;
}

export async function unassign(pool, companyId, attributeId, valueId, entityType, entityId) {
  await pool.query(
    `DELETE FROM app.profile_attribute_values
     WHERE company_id = $1 AND attribute_id = $2 AND attribute_value_id = $3 AND entity_type = $4 AND entity_id = $5 AND source = 'manual'`,
    [companyId, attributeId, valueId, entityType, entityId]
  );
  await recomputeManualCounts(pool, companyId, attributeId);
}

export async function recomputeManualCounts(pool, companyId, attributeId) {
  await pool.query(
    `UPDATE app.attribute_values av
     SET profile_count = (SELECT COUNT(*) FROM app.profile_attribute_values pv
                          WHERE pv.attribute_value_id = av.id AND pv.company_id = $2)
     WHERE av.attribute_id = $1 AND av.company_id = $2`,
    [attributeId, companyId]
  );
}

// Map a segment's filter_criteria to its member_ids / visitor_ids.
export function customerWhere(fc) {
  const parts = [];
  const params = [];
  const textCols = {
    reg_channel: "member_reg_channel", education_level: "education_level", age_group: "age_group",
    gender: "gender", nationality: "nationality", preferred_language: "preferred_language",
    employment_status: "employment_status", income_level: "income_level", member_type: "member_type",
    preferred_channel: "preferred_channel",
  };
  for (const [k, col] of Object.entries(textCols)) {
    const v = fc[k];
    if (Array.isArray(v)) {
      if (v.length) { params.push(v); parts.push(`p.${col} = ANY($${params.length}::text[])`); }
    } else if (v) { params.push(v); parts.push(`p.${col} = $${params.length}`); }
  }
  if (fc.is_opt_in_email === "true" || fc.is_opt_in_email === true) parts.push("p.is_opt_in_email = TRUE");
  if (fc.opt_in_sms === "true") parts.push("p.is_opt_in_sms = 'true'");
  if (fc.is_subscriber === "true") parts.push("p.is_subscriber_only = TRUE");
  if (fc.has_ga_activity === "true") parts.push("p.ga_sessions > 0");
  if (fc.min_ga_sessions) { params.push(Number(fc.min_ga_sessions)); parts.push(`p.ga_sessions >= $${params.length}`); }
  if (fc.max_ga_sessions) { params.push(Number(fc.max_ga_sessions)); parts.push(`p.ga_sessions <= $${params.length}`); }
  // Web activity (GA) criteria - top UTM, page views, engagement, recency.
  // Legacy combined source/medium (older segments); newer segments split these.
  if (Array.isArray(fc.source_medium)) {
    if (fc.source_medium.length) { params.push(fc.source_medium); parts.push(`p.ga_top_source_medium = ANY($${params.length}::text[])`); }
  } else if (fc.source_medium) { params.push(fc.source_medium); parts.push(`p.ga_top_source_medium = $${params.length}`); }
  const srcList = Array.isArray(fc.source) ? fc.source : (fc.source ? [fc.source] : []);
  if (srcList.length) { params.push(srcList); parts.push(`TRIM(SPLIT_PART(p.ga_top_source_medium, ' / ', 1)) = ANY($${params.length}::text[])`); }
  const medList = Array.isArray(fc.medium) ? fc.medium : (fc.medium ? [fc.medium] : []);
  if (medList.length) { params.push(medList); parts.push(`TRIM(SPLIT_PART(p.ga_top_source_medium, ' / ', 2)) = ANY($${params.length}::text[])`); }
  if (Array.isArray(fc.campaign)) {
    if (fc.campaign.length) { params.push(fc.campaign); parts.push(`p.ga_top_campaign = ANY($${params.length}::text[])`); }
  } else if (fc.campaign) { params.push(fc.campaign); parts.push(`p.ga_top_campaign = $${params.length}`); }
  if (fc.min_page_views) { params.push(Number(fc.min_page_views)); parts.push(`p.ga_page_views >= $${params.length}`); }
  if (fc.max_page_views) { params.push(Number(fc.max_page_views)); parts.push(`p.ga_page_views <= $${params.length}`); }
  if (fc.min_sessions) { params.push(Number(fc.min_sessions)); parts.push(`p.ga_sessions >= $${params.length}`); }
  if (fc.max_sessions) { params.push(Number(fc.max_sessions)); parts.push(`p.ga_sessions <= $${params.length}`); }
  if (fc.min_engagement) { params.push(Number(fc.min_engagement)); parts.push(`p.ga_total_events >= $${params.length}`); }
  if (fc.max_engagement) { params.push(Number(fc.max_engagement)); parts.push(`p.ga_total_events <= $${params.length}`); }
  if (fc.visited_within) { params.push(Number(fc.visited_within)); parts.push(`p.ga_last_seen >= CURRENT_DATE - $${params.length}::int`); }
  if (fc.has_form_complete === "true") parts.push("p.ga_form_completes > 0");
  if (fc.has_seminars === "true") parts.push("p.seminar_count > 0");
  if (fc.has_attributes === "true") parts.push("p.attribute_count > 0");
  // Transaction (synced commerce) criteria - counts only completed/confirmed
  // orders, matching the Profiles-page filters. customer_profiles has cached
  // purchase columns, but these correlated subqueries against commerce."order"
  // (keyed by customer_id = member_id) stay live across refreshes.
  const realOrder = "s.order_status IN ('completed', 'confirmed')";
  if (fc.has_transactions === "true") {
    parts.push(`EXISTS (SELECT 1 FROM commerce."order" s WHERE s.customer_id = p.member_id AND ${realOrder})`);
  }
  if (fc.min_orders) {
    params.push(Number(fc.min_orders));
    parts.push(`(SELECT COUNT(*) FROM commerce."order" s WHERE s.customer_id = p.member_id AND ${realOrder}) >= $${params.length}`);
  }
  if (fc.max_orders) {
    params.push(Number(fc.max_orders));
    parts.push(`(SELECT COUNT(*) FROM commerce."order" s WHERE s.customer_id = p.member_id AND ${realOrder}) <= $${params.length}`);
  }
  if (fc.min_spend) {
    params.push(Number(fc.min_spend));
    parts.push(`(SELECT COALESCE(SUM(s.net_amount), 0) FROM commerce."order" s WHERE s.customer_id = p.member_id AND ${realOrder}) >= $${params.length}`);
  }
  if (fc.max_spend) {
    params.push(Number(fc.max_spend));
    parts.push(`(SELECT COALESCE(SUM(s.net_amount), 0) FROM commerce."order" s WHERE s.customer_id = p.member_id AND ${realOrder}) <= $${params.length}`);
  }
  if (fc.ordered_within) {
    params.push(Number(fc.ordered_within));
    parts.push(`EXISTS (SELECT 1 FROM commerce."order" s WHERE s.customer_id = p.member_id AND ${realOrder} AND s.order_date >= NOW() - make_interval(days => $${params.length}))`);
  }
  // Replenishment prediction criteria - read the per-customer rollup cache on
  // customer_profiles (owned by the build_product_predictions DAG). status is the
  // most-urgent bucket; days_to_replenishment is the soonest reorder (may be <0).
  if (fc.has_due_replenishment === "true") parts.push("COALESCE(p.replenishment_due_count, 0) > 0");
  if (Array.isArray(fc.replenishment_status)) {
    if (fc.replenishment_status.length) { params.push(fc.replenishment_status); parts.push(`p.replenishment_status = ANY($${params.length}::text[])`); }
  } else if (fc.replenishment_status) { params.push(fc.replenishment_status); parts.push(`p.replenishment_status = $${params.length}`); }
  if (fc.replenishment_within) {
    params.push(Number(fc.replenishment_within));
    parts.push(`p.days_to_replenishment IS NOT NULL AND p.days_to_replenishment <= $${params.length}`);
  }
  // Recommendation (cross-sell) criteria - read the rollup cache, except the
  // "recommended a specific product" membership which hits the detail table
  // (keyed by customer_id = member_id), so "push product X" audiences stay live.
  if (fc.has_recommendations === "true") parts.push("COALESCE(p.reco_count, 0) > 0");
  if (Array.isArray(fc.top_recommended_category)) {
    if (fc.top_recommended_category.length) { params.push(fc.top_recommended_category); parts.push(`p.top_recommended_category = ANY($${params.length}::text[])`); }
  } else if (fc.top_recommended_category) { params.push(fc.top_recommended_category); parts.push(`p.top_recommended_category = $${params.length}`); }
  if (Array.isArray(fc.recommended_product_ids) && fc.recommended_product_ids.length) {
    params.push(fc.recommended_product_ids);
    parts.push(`EXISTS (SELECT 1 FROM commerce.customer_product_reco r WHERE r.customer_id = p.member_id AND r.product_id = ANY($${params.length}::text[]))`);
  }
  if (Array.isArray(fc.attribute_value_ids) && fc.attribute_value_ids.length) {
    params.push(fc.attribute_value_ids);
    parts.push(`EXISTS (SELECT 1 FROM app.profile_attribute_values pav JOIN app.attributes aa ON aa.id = pav.attribute_id AND aa.status='active' WHERE pav.entity_type='customer' AND pav.entity_id = p.member_id AND pav.attribute_value_id = ANY($${params.length}::uuid[]))`);
  }
  return { where: parts.length ? parts.join(" AND ") : "TRUE", params };
}

export function anonWhere(fc) {
  const parts = [];
  const params = [];
  // Legacy combined source/medium (older segments); newer segments split these.
  if (Array.isArray(fc.source_medium)) {
    if (fc.source_medium.length) { params.push(fc.source_medium); parts.push(`p.top_source_medium = ANY($${params.length}::text[])`); }
  } else if (fc.source_medium) { params.push(fc.source_medium); parts.push(`p.top_source_medium = $${params.length}`); }
  const srcList = Array.isArray(fc.source) ? fc.source : (fc.source ? [fc.source] : []);
  if (srcList.length) { params.push(srcList); parts.push(`TRIM(SPLIT_PART(p.top_source_medium, ' / ', 1)) = ANY($${params.length}::text[])`); }
  const medList = Array.isArray(fc.medium) ? fc.medium : (fc.medium ? [fc.medium] : []);
  if (medList.length) { params.push(medList); parts.push(`TRIM(SPLIT_PART(p.top_source_medium, ' / ', 2)) = ANY($${params.length}::text[])`); }
  if (Array.isArray(fc.campaign)) {
    if (fc.campaign.length) { params.push(fc.campaign); parts.push(`p.top_campaign = ANY($${params.length}::text[])`); }
  } else if (fc.campaign) { params.push(fc.campaign); parts.push(`p.top_campaign = $${params.length}`); }
  if (fc.min_page_views) { params.push(Number(fc.min_page_views)); parts.push(`p.page_views >= $${params.length}`); }
  if (fc.max_page_views) { params.push(Number(fc.max_page_views)); parts.push(`p.page_views <= $${params.length}`); }
  if (fc.min_sessions) { params.push(Number(fc.min_sessions)); parts.push(`p.sessions >= $${params.length}`); }
  if (fc.max_sessions) { params.push(Number(fc.max_sessions)); parts.push(`p.sessions <= $${params.length}`); }
  if (fc.min_engagement) { params.push(Number(fc.min_engagement)); parts.push(`p.user_engagement >= $${params.length}`); }
  if (fc.max_engagement) { params.push(Number(fc.max_engagement)); parts.push(`p.user_engagement <= $${params.length}`); }
  if (fc.visited_within) { params.push(Number(fc.visited_within)); parts.push(`p.last_seen >= CURRENT_DATE - $${params.length}::int`); }
  if (fc.has_form_complete === "true") parts.push("p.form_completes > 0");
  if (Array.isArray(fc.attribute_value_ids) && fc.attribute_value_ids.length) {
    params.push(fc.attribute_value_ids);
    parts.push(`EXISTS (SELECT 1 FROM app.profile_attribute_values pav JOIN app.attributes aa ON aa.id = pav.attribute_id AND aa.status='active' WHERE pav.entity_type='anonymous' AND pav.entity_id = p.visitor_id AND pav.attribute_value_id = ANY($${params.length}::uuid[]))`);
  }
  return { where: parts.length ? parts.join(" AND ") : "TRUE", params };
}

// Live count of profiles matching a segment's filter_criteria (no row fetch).
export async function countSegmentEntities(pool, companyId, segmentId) {
  const { rows } = await pool.query(
    `SELECT segment_type, metadata FROM app.segments WHERE id = $1 AND company_id = $2`,
    [segmentId, companyId]
  );
  if (!rows.length) return 0;
  const fc = rows[0].metadata?.filter_criteria || {};
  if (rows[0].segment_type === "customer") {
    const { where, params } = customerWhere(fc);
    params.push(companyId);
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM app.customer_profiles p WHERE (${where}) AND p.company_id = $${params.length}`, params);
    return r.rows[0].n;
  }
  const { where, params } = anonWhere(fc);
  params.push(companyId);
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM app.anonymous_profiles p WHERE (${where}) AND p.company_id = $${params.length}`, params);
  return r.rows[0].n;
}

export async function resolveSegmentEntities(pool, companyId, segmentId) {
  const { rows } = await pool.query(
    `SELECT segment_type, metadata FROM app.segments WHERE id = $1 AND company_id = $2`,
    [segmentId, companyId]
  );
  if (!rows.length) return { entityType: null, ids: [] };
  const fc = rows[0].metadata?.filter_criteria || {};
  if (rows[0].segment_type === "customer") {
    const { where, params } = customerWhere(fc);
    params.push(companyId);
    const r = await pool.query(`SELECT member_id FROM app.customer_profiles p WHERE (${where}) AND p.company_id = $${params.length} LIMIT 100000`, params);
    return { entityType: "customer", ids: r.rows.map((x) => x.member_id).filter(Boolean) };
  }
  const { where, params } = anonWhere(fc);
  params.push(companyId);
  const r = await pool.query(`SELECT visitor_id FROM app.anonymous_profiles p WHERE (${where}) AND p.company_id = $${params.length} LIMIT 100000`, params);
  return { entityType: "anonymous", ids: r.rows.map((x) => x.visitor_id).filter(Boolean) };
}

// Resolve a list of identifiers (email / member_id / visitor_id) to entity_ids,
// scoped to this company so an import never matches another tenant's profiles.
export async function resolveIdentifiers(pool, companyId, entityType, identifiers) {
  const list = [...new Set((identifiers || []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!list.length) return [];
  if (entityType === "customer") {
    const r = await pool.query(
      `SELECT member_id FROM app.customer_profiles
       WHERE company_id = $3 AND (member_id = ANY($1::text[]) OR lower(primary_email) = ANY($2::text[]))`,
      [list, list.map((x) => x.toLowerCase()), companyId]
    );
    return r.rows.map((x) => x.member_id);
  }
  const r = await pool.query(
    `SELECT visitor_id FROM app.anonymous_profiles WHERE company_id = $2 AND visitor_id = ANY($1::text[])`,
    [list, companyId]
  );
  return r.rows.map((x) => x.visitor_id);
}
