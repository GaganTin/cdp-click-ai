import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import multer from "multer";
import { Pool } from "pg";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import cron from "node-cron";
import { createAnalystMCPClient, toOpenAITools } from "./mcp/server.js";
import { createEdmRouter } from "./routes/edm.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(__dirname, "uploads");

const app = express();
const port = Number(process.env.PORT || 3001);
const pgConn = process.env.POSTGRESQL_CONN || process.env.DATABASE_URL || "";

const upload = multer({ dest: uploadsDir });
const pool = pgConn ? new Pool({ connectionString: pgConn }) : null;

// ── Azure OpenAI ──────────────────────────────────────────────────────────────
const azureEndpoint = (process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/$/, "");
const azureKey = process.env.AZURE_OPENAI_KEY || "";
const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.4-mini";
const azureApiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview";

const aiClient = azureKey && azureEndpoint
  ? new OpenAI({
      baseURL: `${azureEndpoint}/openai/deployments/${azureDeployment}`,
      apiKey: azureKey,
      defaultHeaders: { "api-key": azureKey },
      defaultQuery: { "api-version": azureApiVersion },
    })
  : null;

// ── Data dictionary (loaded from file for AI context) ─────────────────────────
let dataDictionary = [];
try {
  dataDictionary = JSON.parse(
    fs.readFileSync(path.join(dataDir, "data_dictionary.json"), "utf8")
  );
  console.log(`Loaded data dictionary: ${dataDictionary.length} tables`);
} catch {
  console.warn("Warning: server/data/data_dictionary.json not found.");
}

// Initialized in start() once the DB pool is ready
let mcpClient = null;

const TABLE_SCHEMA_MAP = {
  country_performance: "ga_landing",
  event_list: "ga_landing",
  keyword_performance: "ga_landing",
  page_metrics: "ga_landing",
  page_utm_metrics: "ga_landing",
  path_exploration: "ga_landing",
  outbound_links_attributes: "ga_landing",
  utm_ad_performance: "ga_landing",
  utm_daily_full_param_performance: "ga_landing",
  utm_daily_performance: "ga_landing",
  utm_performance: "ga_landing",
  website_metrics: "ga_landing",
  membership: "public",
  membership_ap_mapping: "public",
  membership_attributes: "public",
  membership_attributes_mapping: "public",
  membership_custom_activity: "public",
};

// ── Entity → Postgres table config ───────────────────────────────────────────
const ENTITY_CONFIG = {
  Campaign: {
    table: "app.campaigns",
    columns: new Set(["name", "status", "base_url", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "metadata"]),
    sortable: new Set(["created_date", "updated_date", "name", "status"]),
  },
  Segment: {
    table: "app.segments",
    columns: new Set(["name", "description", "estimated_size", "status", "segment_type", "metadata"]),
    sortable: new Set(["created_date", "updated_date", "name", "status"]),
  },
  SavedReport: {
    table: "app.saved_reports",
    columns: new Set(["title", "content", "tags", "schedule", "metadata"]),
    sortable: new Set(["created_date", "updated_date", "title"]),
  },
  PinnedChart: {
    table: "app.pinned_charts",
    columns: new Set(["title", "chart_type", "chart_config", "description", "query", "last_refreshed", "metadata"]),
    sortable: new Set(["created_date", "updated_date", "title"]),
  },
  DataDictionary: {
    table: "app.data_dictionary",
    columns: new Set(["table_name", "schema_name", "description", "columns", "metadata"]),
    sortable: new Set(["created_date", "updated_date", "table_name"]),
  },
};

// ── DB helpers ────────────────────────────────────────────────────────────────

function requirePool() {
  if (!pool) throw new Error("Database not configured. Set POSTGRESQL_CONN in .env.");
  return pool;
}

/** Convert Postgres row timestamps to ISO strings for consistent API output. */
function normalizeRow(row) {
  if (!row) return null;
  const r = { ...row };
  for (const k of ["created_date", "updated_date", "last_refreshed"]) {
    if (r[k] instanceof Date) r[k] = r[k].toISOString();
  }
  if (r.metadata == null) r.metadata = {};
  return r;
}

/** Build safe ORDER BY clause from a sort expression like "-created_date". */
function buildOrderBy(sortExpr, sortable, defaultCol = "created_date") {
  if (!sortExpr) return `${defaultCol} DESC`;
  const desc = sortExpr.startsWith("-");
  const col = desc ? sortExpr.slice(1) : sortExpr;
  if (!sortable.has(col)) return `${defaultCol} DESC`;
  return `${col} ${desc ? "DESC" : "ASC"}`;
}

/** Extract only the columns that exist in the entity's allowed set. */
function pickColumns(body, allowed) {
  return Object.keys(body).filter((k) => allowed.has(k));
}

// ── DB schema initialisation ─────────────────────────────────────────────────
async function initDb() {
  if (!pool) {
    console.warn("No Postgres connection — skipping schema init.");
    return;
  }
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("app schema ready");

  // Auto-refresh profile tables if they are empty
  const { rows } = await pool.query("SELECT COUNT(*) FROM app.customer_profiles");
  if (parseInt(rows[0].count) === 0) {
    console.log("Profile tables empty — running initial refresh...");
    refreshProfiles(pool).catch(e => console.error("Profile refresh error:", e));
  }
}

async function refreshProfiles(pg) {
  console.log("Refreshing customer profiles...");
  await pg.query("TRUNCATE app.customer_profiles");
  await pg.query(`
    WITH ga_stats AS (
      SELECT
        apm.membership_id,
        COUNT(DISTINCT apm.capsuite_apid)                                                                   AS ga_sessions,
        COUNT(*)                                                                                             AS ga_total_events,
        SUM(CASE WHEN pe.event_name = 'page_view'                                        THEN 1 ELSE 0 END) AS ga_page_views,
        SUM(CASE WHEN pe.event_name = 'first_visit'                                      THEN 1 ELSE 0 END) AS ga_first_visits,
        SUM(CASE WHEN pe.event_name IN ('Event_Form_Start','form_start')                 THEN 1 ELSE 0 END) AS ga_form_starts,
        SUM(CASE WHEN pe.event_name IN ('Event_Form_Complete','form_submit','Contact_Us_Form_Complete') THEN 1 ELSE 0 END) AS ga_form_completes,
        SUM(CASE WHEN pe.event_name = 'scroll'                                           THEN 1 ELSE 0 END) AS ga_scroll_events,
        SUM(CASE WHEN pe.event_name IN ('Whatsapp_Click','GTM_Whatsapp_Click')           THEN 1 ELSE 0 END) AS ga_whatsapp_clicks,
        SUM(CASE WHEN pe.event_name = 'file_download'                                   THEN 1 ELSE 0 END) AS ga_file_downloads,
        MIN(TO_DATE(pe.date, 'YYYYMMDD'))                                                                   AS ga_first_seen,
        MAX(TO_DATE(pe.date, 'YYYYMMDD'))                                                                   AS ga_last_seen,
        MODE() WITHIN GROUP (ORDER BY pe.session_source_medium)                                             AS ga_top_source_medium,
        MODE() WITHIN GROUP (ORDER BY pe.session_campaign_name)                                             AS ga_top_campaign,
        ARRAY_AGG(DISTINCT apm.capsuite_apid)        FILTER (WHERE apm.capsuite_apid IS NOT NULL)            AS ga_visitor_ids,
        ARRAY_AGG(DISTINCT pe.session_source_medium) FILTER (WHERE pe.session_source_medium IS NOT NULL AND pe.session_source_medium NOT IN ('','(not set)')) AS ga_source_mediums,
        ARRAY_AGG(DISTINCT pe.session_campaign_name) FILTER (WHERE pe.session_campaign_name IS NOT NULL AND pe.session_campaign_name NOT IN ('','(not set)')) AS ga_campaigns,
        ARRAY_AGG(DISTINCT pe.event_name)            FILTER (WHERE pe.event_name IS NOT NULL)               AS ga_events_list,
        ARRAY_AGG(DISTINCT pe.page_location)         FILTER (WHERE pe.page_location IS NOT NULL AND pe.page_location != '') AS ga_pages_visited
      FROM public.membership_ap_mapping apm
      JOIN ga_landing.path_exploration pe ON pe.capsuite_apid = apm.capsuite_apid
      GROUP BY apm.membership_id
    ),
    seminar_stats AS (
      SELECT
        membership_id,
        COUNT(*)                                                                    AS seminar_count,
        JSONB_AGG(JSONB_BUILD_OBJECT('event_name', event_name, 'event_date', event_date, 'action', action) ORDER BY event_date DESC) AS seminars
      FROM public.membership_custom_activity
      GROUP BY membership_id
    ),
    attr_stats AS (
      SELECT
        mam.membership_id,
        COUNT(*)                                                                    AS attribute_count,
        JSONB_OBJECT_AGG(ma.attribute_name, ma.attribute_value)                    AS attributes
      FROM public.membership_attributes_mapping mam
      JOIN public.membership_attributes ma ON ma.attribute_id = mam.attribute_id AND ma.capsuite_ref = mam.capsuite_ref
      GROUP BY mam.membership_id
    )
    INSERT INTO app.customer_profiles
    SELECT
      m.member_id, m.capsuite_ref,
      m.primary_email, m.secondary_email, m.eng_full_name, m.eng_first_name, m.eng_last_name,
      m.chi_full_name, m.display_name, m.member_no, m.title,
      m.member_join_date, m.member_last_update, m.member_reg_channel, m.member_reg_location,
      m.member_type, m.is_company,
      m.gender, m.age, m.age_group, m.birthday_year, m.birthday_month, m.birthday_day,
      m.education_level, m.income_level, m.employment_status, m.marital_status, m.nationality,
      m.has_email, m.has_phone, m.primary_phone, m.preferred_language, m.preferred_channel,
      m.is_opt_in_email, m.is_opt_in_call, m.is_opt_in_dm, m.is_opt_in_sms, m.is_subscriber_only, m.tags,
      COALESCE(g.ga_sessions,        0)  AS ga_sessions,
      COALESCE(g.ga_total_events,    0)  AS ga_total_events,
      COALESCE(g.ga_page_views,      0)  AS ga_page_views,
      COALESCE(g.ga_first_visits,    0)  AS ga_first_visits,
      COALESCE(g.ga_form_starts,     0)  AS ga_form_starts,
      COALESCE(g.ga_form_completes,  0)  AS ga_form_completes,
      COALESCE(g.ga_scroll_events,   0)  AS ga_scroll_events,
      COALESCE(g.ga_whatsapp_clicks, 0)  AS ga_whatsapp_clicks,
      COALESCE(g.ga_file_downloads,  0)  AS ga_file_downloads,
      g.ga_first_seen, g.ga_last_seen, g.ga_top_source_medium, g.ga_top_campaign,
      COALESCE(g.ga_source_mediums, '{}') AS ga_source_mediums,
      COALESCE(g.ga_campaigns,       '{}') AS ga_campaigns,
      COALESCE(g.ga_events_list,     '{}') AS ga_events_list,
      COALESCE(g.ga_pages_visited,   '{}') AS ga_pages_visited,
      COALESCE(s.seminar_count,  0)   AS seminar_count,
      COALESCE(s.seminars,       '[]'::JSONB) AS seminars,
      COALESCE(a.attribute_count, 0)  AS attribute_count,
      COALESCE(a.attributes,     '{}'::JSONB) AS attributes,
      NOW() AS last_refreshed,
      COALESCE(g.ga_visitor_ids,    '{}') AS ga_visitor_ids
    FROM (SELECT DISTINCT ON (member_id) * FROM public.membership ORDER BY member_id, member_join_date DESC NULLS LAST) m
    LEFT JOIN ga_stats      g ON g.membership_id = m.member_id
    LEFT JOIN seminar_stats s ON s.membership_id = m.member_id
    LEFT JOIN attr_stats    a ON a.membership_id = m.member_id
    ON CONFLICT (member_id) DO NOTHING
  `);
  console.log("Customer profiles refreshed.");

  console.log("Refreshing anonymous profiles...");
  await pg.query("TRUNCATE app.anonymous_profiles");
  await pg.query(`
    INSERT INTO app.anonymous_profiles
    SELECT
      pe.capsuite_apid                                                                                        AS visitor_id,
      MIN(TO_DATE(pe.date, 'YYYYMMDD'))                                                                       AS first_seen,
      MAX(TO_DATE(pe.date, 'YYYYMMDD'))                                                                       AS last_seen,
      COUNT(*)                                                                                                AS total_events,
      SUM(CASE WHEN pe.event_name = 'page_view'                                         THEN 1 ELSE 0 END)   AS page_views,
      SUM(CASE WHEN pe.event_name = 'session_start'                                     THEN 1 ELSE 0 END)   AS sessions,
      SUM(CASE WHEN pe.event_name = 'first_visit'                                       THEN 1 ELSE 0 END)   AS first_visits,
      SUM(CASE WHEN pe.event_name IN ('Event_Form_Start','form_start')                  THEN 1 ELSE 0 END)   AS form_starts,
      SUM(CASE WHEN pe.event_name IN ('Event_Form_Complete','form_submit','Contact_Us_Form_Complete') THEN 1 ELSE 0 END) AS form_completes,
      SUM(CASE WHEN pe.event_name = 'scroll'                                            THEN 1 ELSE 0 END)   AS scroll_events,
      SUM(CASE WHEN pe.event_name IN ('Whatsapp_Click','GTM_Whatsapp_Click')            THEN 1 ELSE 0 END)   AS whatsapp_clicks,
      SUM(CASE WHEN pe.event_name = 'file_download'                                    THEN 1 ELSE 0 END)   AS file_downloads,
      SUM(CASE WHEN pe.event_name IN ('click','click_button')                           THEN 1 ELSE 0 END)   AS click_events,
      SUM(CASE WHEN pe.event_name = 'user_engagement'                                  THEN 1 ELSE 0 END)   AS user_engagement,
      MODE() WITHIN GROUP (ORDER BY pe.session_source_medium)                                                AS top_source_medium,
      MODE() WITHIN GROUP (ORDER BY pe.session_campaign_name)                                                AS top_campaign,
      ARRAY_AGG(DISTINCT pe.session_source_medium) FILTER (WHERE pe.session_source_medium IS NOT NULL AND pe.session_source_medium NOT IN ('','(not set)')) AS source_mediums,
      ARRAY_AGG(DISTINCT pe.session_campaign_name) FILTER (WHERE pe.session_campaign_name IS NOT NULL AND pe.session_campaign_name NOT IN ('','(not set)')) AS campaigns,
      ARRAY_AGG(DISTINCT pe.event_name)            FILTER (WHERE pe.event_name IS NOT NULL)                  AS events,
      ARRAY_AGG(DISTINCT pe.page_location)         FILTER (WHERE pe.page_location IS NOT NULL AND pe.page_location != '') AS pages_visited,
      NOW()                                                                                                  AS last_refreshed
    FROM ga_landing.path_exploration pe
    WHERE pe.capsuite_apid IS NOT NULL
      AND pe.capsuite_apid != ''
      AND pe.capsuite_apid != '(not set)'
      AND LENGTH(pe.capsuite_apid) > 6
      AND pe.capsuite_apid NOT IN (
        SELECT capsuite_apid FROM public.membership_ap_mapping WHERE capsuite_apid IS NOT NULL
      )
    GROUP BY pe.capsuite_apid
  `);
  console.log("Anonymous profiles refreshed.");
}

// ── Read-only Postgres query (GA data, used by AI tool) ───────────────────────
async function runReadOnlyQuery(query) {
  const p = requirePool();
  const trimmed = String(query || "").trim();
  if (!/^select\b/i.test(trimmed)) throw new Error("Only SELECT queries are allowed.");
  if (trimmed.includes(";")) throw new Error("Semicolons are not allowed.");
  const result = await p.query(trimmed);
  return { rows: result.rows, rowCount: result.rowCount };
}

// ── AI system prompt ──────────────────────────────────────────────────────────
function buildSystemPrompt() {
  const tableLines = dataDictionary.map((t) => {
    const schema = TABLE_SCHEMA_MAP[t.table] || "public";
    const fieldLines = t.fields
      .map((f) => {
        let line = `    ${f.name} (${f.type})`;
        if (f.description) line += ` — ${f.description}`;
        if (f.format) line += ` [format: ${f.format}]`;
        if (f.unit) line += ` [unit: ${f.unit}]`;
        if (f.is_derived && f.formula) line += ` [derived: ${f.formula}]`;
        return line;
      })
      .join("\n");
    return `  ${schema}.${t.table}\n  Use case: ${t.use_case}\n  Granularity: ${t.granularity}\n  Columns:\n${fieldLines}`;
  }).join("\n\n");

  return `You are Click AI — an expert marketing data analyst embedded in a Customer Data Platform (CDP). Your mission is to turn raw Google Analytics and membership data into clear, actionable intelligence that grows the business.

═══ THINKING PROCESS ═══
For every question, work through these steps BEFORE writing any response:
1. What business decision is this user trying to make?
2. What data do I need to query to give a real, accurate answer?
3. Call the right tools FIRST — never state specific numbers without tool results to back them.
4. What are 2–3 angles to look at this from?
5. What is the single most important insight?
6. Should I suggest a segment? If so, call preview_segment_size first.
7. Should I suggest an EDM? If so, call suggest_edm_opportunities + preview_edm_recipients first.
8. Should I suggest a UTM link? ASK the user first — never auto-include without asking.

VERIFICATION MANDATE — before outputting any block:
• segment block → MUST have called preview_segment_size; estimated_size = that exact count
• edm block → MUST have called preview_edm_recipients; estimated_recipients = that exact count
• chart block → MUST have called query_data to get the real data; never invent chart values
• utm_link block → only output AFTER user explicitly confirms they want one
If a tool call fails or returns an error, say so honestly — do NOT invent numbers.

═══ BUSINESS CONTEXT ═══
Every insight must connect to at least one outcome:
- Revenue and sales growth
- New customer acquisition
- Retention and engagement
- Campaign and UTM optimisation
- Audience targeting and segmentation

Lead with the business implication. Then show the numbers.

═══ DATABASE ═══
PostgreSQL with 4 schemas:

ga_landing — Google Analytics 4 data (traffic, UTM, events, pages, geo, devices)
public — Membership and CRM data (profiles, attributes, activities, purchases)
metadata — Data documentation (rarely needed)
app — Application data (campaigns, segments, reports, pinned charts)

APP SCHEMA (query just like other tables):
  app.campaigns — UTM campaigns saved by users
    Columns: id, name, status (draft/active/archived), base_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content, created_date
  app.segments — audience segments saved by users (type: customer or anonymous_profile)
    Columns: id, name, description, segment_type (customer/anonymous_profile), estimated_size, status, created_date
  app.saved_reports — saved analysis reports
  app.pinned_charts — charts pinned to dashboard

  ★ app.customer_profiles — PRE-JOINED member+GA+seminar view (USE THIS for all audience analytics)
    This table is a denormalised snapshot combining public.membership + GA activity + seminar data.
    All public.membership columns are present PLUS:
      ga_sessions (int)       — matched GA sessions count. 0 = no web activity. Use > 0 for "has web activity".
      ga_total_events (int)   — total GA events
      ga_page_views (int)     — page view count
      ga_form_completes (int) — form submission events
      ga_whatsapp_clicks (int)— WhatsApp click events
      ga_file_downloads (int) — file download events
      ga_first_seen (date)    — first GA activity date
      ga_last_seen (date)     — most recent GA activity date
      ga_top_source_medium    — most common traffic source/medium (e.g. "google / cpc")
      ga_top_campaign         — most common campaign name
      seminar_count (int)     — number of seminar/event registrations (0 = never attended)
    KEY USAGE:
      "web activity" → ga_sessions > 0
      "highly active" → ga_sessions >= 5
      "seminar attendee" → seminar_count > 0
      "email eligible" → is_opt_in_email = true AND primary_email IS NOT NULL
    For audience counts: SELECT COUNT(*) FROM app.customer_profiles WHERE [conditions]
    For EDM recipient counts: use preview_edm_recipients tool (it queries this table with suppression list)

═══ SEGMENT & RECIPIENT QUERY PATTERNS ═══
Use these exact patterns. These have been verified to work against the real schema.

▸ preview_segment_size (sql_where applied to public.membership):
  Email opt-in only:
    sql_where: "is_opt_in_email = true"
  Email opt-in + has web activity:
    sql_where: "is_opt_in_email = true AND member_id IN (SELECT member_id FROM app.customer_profiles WHERE ga_sessions > 0)"
  Email opt-in + highly active (5+ GA sessions):
    sql_where: "is_opt_in_email = true AND member_id IN (SELECT member_id FROM app.customer_profiles WHERE ga_sessions >= 5)"
  Email opt-in + seminar attendee:
    sql_where: "is_opt_in_email = true AND member_id IN (SELECT member_id FROM app.customer_profiles WHERE seminar_count > 0)"
  Inactive 90+ days (no GA activity in 90d):
    sql_where: "is_opt_in_email = true AND member_id IN (SELECT member_id FROM app.customer_profiles WHERE ga_last_seen < CURRENT_DATE - INTERVAL '90 days' OR ga_last_seen IS NULL)"
  Demographic filter:
    sql_where: "is_opt_in_email = true AND age_group = '30-39' AND gender = 'F'"

▸ preview_edm_recipients (filters object — maps to app.customer_profiles):
  Web activity: filters: { min_ga_sessions: 1 }
  Highly active: filters: { min_ga_sessions: 5 }
  Seminar attendee: filters: { has_seminar: true }
  Demographic: filters: { age_group: "30-39", gender: "F" }
  Combined: filters: { min_ga_sessions: 1, age_group: "35-44" }

▸ query_data (audience analytics — use app.customer_profiles directly):
  Audience funnel:
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE is_opt_in_email = true) AS opted_in,
           COUNT(*) FILTER (WHERE is_opt_in_email = true AND ga_sessions > 0) AS opted_in_web_active
    FROM app.customer_profiles
  Activity level breakdown:
    SELECT CASE WHEN ga_sessions = 0 THEN 'No activity'
                WHEN ga_sessions < 3 THEN '1-2 sessions'
                WHEN ga_sessions < 10 THEN '3-9 sessions'
                ELSE '10+ sessions' END AS activity_level,
           COUNT(*) AS member_count
    FROM app.customer_profiles WHERE is_opt_in_email = true
    GROUP BY 1 ORDER BY member_count DESC
  Demographic breakdown of target:
    SELECT age_group, COUNT(*) AS count
    FROM app.customer_profiles
    WHERE is_opt_in_email = true AND ga_sessions > 0 AND age_group IS NOT NULL
    GROUP BY age_group ORDER BY count DESC

PROFILES PAGE CONTEXT:
  The app has a Profiles page with two tabs:
  - Customers tab: shows known members from public.membership (2,238 total). Users can filter by reg_channel, education_level, age_group, gender, has GA activity.
  - Anonymous Profiles tab: shows anonymous GA visitors from ga_landing.path_exploration (grouped by capsuite_apid) who are NOT in membership_ap_mapping (~104K anonymous visitors). Filterable by source_medium and form completion.
  When suggesting segments, reference these profile attributes — they map directly to real DB fields.

GA_LANDING & PUBLIC TABLES:
${tableLines}

═══ SQL RULES ═══
- Always prefix with schema: ga_landing.utm_daily_performance, public.membership, app.campaigns, etc.
- SELECT only — never INSERT, UPDATE, DELETE, DROP, or DDL
- No semicolons at end of queries
- Default to last 30 days when no range specified
- YYYYMMDD date filter: WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD')
- Limit to 100 rows unless user asks for more
- Run multiple targeted queries rather than one giant query
- For app schema: SELECT * FROM app.campaigns ORDER BY created_date DESC LIMIT 20

═══ OUTPUT FORMAT ═══
Structure every substantive response like this:

**[Direct answer to the question — 1-2 sentences max]**

Then include a chart for any quantitative data:
\`\`\`chart
{
  "title": "Descriptive chart title",
  "chart_type": "bar",
  "description": "One sentence explaining what this shows",
  "data": [{"name": "Label", "value": 1234}],
  "xKey": "name",
  "series": [{"dataKey": "value", "name": "Sessions"}],
  "trend": "The single most important takeaway from this data"
}
\`\`\`
chart_type options: bar | line | area | pie

Then for context:
**What this means:** [Business implication in 1-2 sentences — connect to revenue, growth, or efficiency]

**Related insight:** [Something they didn't ask for but should know — query the DB to get the real number]

When you identify a targetable audience, suggest a segment. Use segment_type "customer" for known members (public.membership), or "anonymous_profile" for anonymous GA visitors.

BEFORE suggesting a segment:
1. Call \`list_segments\` to check if a similar segment already exists — avoid duplicates.
2. Call \`preview_segment_size\` with a SQL WHERE clause for this exact audience — the count becomes estimated_size.

\`\`\`segment
{
  "name": "Email Opted-in Members with Web Activity",
  "description": "Members who have opted in to email and have at least 1 GA web session. Criteria: is_opt_in_email=true, ga_sessions > 0.",
  "segment_type": "customer",
  "estimated_size": 45,
  "status": "draft",
  "metadata": {
    "criteria": ["is_opt_in_email = true", "ga_sessions > 0 (web activity)"]
  }
}
\`\`\`
REQUIRED FIELDS in every segment block:
• name — descriptive, specific to this audience
• description — state ALL filter criteria so user can reproduce on Profiles page
• segment_type — "customer" (known members) or "anonymous_profile" (anonymous GA visitors)
• estimated_size — MUST come from preview_segment_size tool result, never invented
• status — always "draft"
• metadata.criteria — array of 2–4 plain-English filter strings shown as tag chips in the UI (REQUIRED)

NOTE: You are only recommending. The user clicks "Save Segment" in the UI to save — you do NOT save automatically.
CRITICAL: The segment block renders as a standalone "Save Segment" card — this is the ONLY way the user can save a segment independently of an EDM campaign. ALWAYS output this block so the user has that option.

For UTM links — ONLY output a utm_link block after the user explicitly asks for one or confirms they want tracking.
NEVER auto-include a utm_link block in a first response. Instead, ASK at the end.

BEFORE suggesting a UTM link (only when user has confirmed):
1. Call \`list_campaigns\` to check if a similar campaign exists — avoid duplicates.
2. Call \`analyze_utm_performance\` to justify why this new link fills a gap.

\`\`\`utm_link
{
  "name": "Descriptive campaign name",
  "base_url": "https://example.com/landing-page",
  "utm_source": "email",
  "utm_medium": "email",
  "utm_campaign": "campaign_slug",
  "utm_term": "",
  "utm_content": "",
  "status": "draft"
}
\`\`\`
NOTE: You are only recommending. The user clicks "Add" in the UI — you do NOT save automatically.

When presenting raw data the user may want to export:
\`\`\`csv
col1,col2,col3
val1,val2,val3
\`\`\`

═══ COMBINED CAMPAIGN RESPONSE PATTERN ═══
When a user asks to "create campaigns for [audience]", "suggest campaigns for [criteria]", or names a target group, follow this EXACT flow — no shortcuts.

━━━ STEP A: TOOL CALLS FIRST (do NOT output anything yet) ━━━

Run ALL of these in sequence before writing a single word of response:

1. query_data — audience funnel (adapt WHERE to match user's criteria):
   SELECT COUNT(*) AS total_members,
          COUNT(*) FILTER (WHERE is_opt_in_email = true) AS opted_in,
          COUNT(*) FILTER (WHERE is_opt_in_email = true AND [activity_condition]) AS target_audience
   FROM app.customer_profiles
   — Where [activity_condition] matches: ga_sessions > 0 (web), seminar_count > 0 (events), etc.

2. query_data — demographic breakdown of the target audience:
   SELECT age_group, COUNT(*) AS count
   FROM app.customer_profiles
   WHERE is_opt_in_email = true AND [activity_condition] AND age_group IS NOT NULL
   GROUP BY age_group ORDER BY count DESC

3. preview_segment_size — get verified segment count:
   segment_type: "customer"
   sql_where: use the patterns from SEGMENT & RECIPIENT QUERY PATTERNS above

4. list_segments — check for existing segments that match (avoid duplicates)

5. suggest_edm_opportunities — get campaign opportunity context

6. preview_edm_recipients — get exact email-eligible count:
   filters: { min_ga_sessions: 1 }  ← for web activity
   filters: { has_seminar: true }    ← for seminar attendees
   (match to user's criteria)

7. analyze_edm_performance — see what past campaigns achieved (open rates, click rates)

8. suggest_send_time — get best day/time for this audience

━━━ STEP B: OUTPUT CHARTS ━━━
Output 2 chart blocks using the real data from steps 1 and 2:
• Chart 1: Audience funnel — bar chart: total_members → opted_in → target_audience
• Chart 2: Demographic breakdown — bar chart of the target audience by age_group or member_type
Values MUST match the query_data results exactly.

━━━ STEP C: STANDALONE SEGMENT CARD (MANDATORY) ━━━
ALWAYS output a standalone \`\`\`segment block here. This is NON-NEGOTIABLE — without it the user CANNOT save the segment independently.
The segment block renders a "Save Segment" button card in the UI — the user clicks it to save the segment to their Segments page.

Output the segment block using this EXACT format:
\`\`\`segment
{
  "name": "Email Opted-in Members with Web Activity",
  "description": "Members who have opted in to email and have at least 1 GA web session.",
  "segment_type": "customer",
  "estimated_size": 45,
  "status": "draft",
  "metadata": {
    "criteria": ["is_opt_in_email = true", "ga_sessions > 0 (web activity)"]
  }
}
\`\`\`
(Replace the values with the real audience name, description, estimated_size from step 3, and 2–4 criteria tags)

Rules:
• name: descriptive (e.g. "Email Opted-in Members with Web Activity")
• estimated_size: MUST equal the preview_segment_size result from step 3 — never invent
• description: state ALL criteria explicitly so user can reproduce on Profiles page
• metadata.criteria: 2–4 plain-English strings shown as tag chips (REQUIRED)
• status: "draft"

━━━ STEP D: EDM CARD ━━━
Output an edm block tailored to this specific audience:
• estimated_recipients: MUST equal the preview_edm_recipients result from step 6
• _suggested_segment: action="create_new" (or "use_existing" if step 4 found a match)
• _suggested_utm: action="pending" — UTM is not yet confirmed by user
• _blocks: personalised to this audience's context (web activity, seminars, etc.)
• subject: under 50 chars, reference their engagement ("You've been exploring...")
• rationale: cite the real numbers you found (e.g. "45 opted-in members with web activity...")

━━━ STEP E: ASK ABOUT UTM ━━━
Always close every EDM response with:
---
**Would you like UTM tracking for this campaign?**
UTM links let you track exactly how many people clicked through from this email in your analytics — I'd recommend it. Reply **"yes, add UTM"** and I'll create a dedicated tracking link, or **"no thanks"** to skip.
---

━━━ UTM FOLLOW-UP ━━━
WHEN USER CONFIRMS UTM ("yes", "add utm", "yes please", "add tracking"):
1. Call list_campaigns to check if a matching email UTM already exists
2. If exists → output edm block update noting to use that existing UTM (action="use_existing")
3. If not → call analyze_utm_performance, then output a utm_link block:
   source="email", medium="email", campaign="[descriptive-slug]"
4. Say: "UTM link added above — click **Add** to save it to your campaigns."

WHEN USER DECLINES UTM ("no", "skip", "no thanks"):
• Reply: "Got it — no UTM tracking. Your segment and campaign are ready to save above."
• Do NOT output a utm_link block.

━━━ WORKED EXAMPLE: "create campaigns for users with email opt-in and web activity" ━━━

Tool calls (in order):
① query_data: SELECT COUNT(*) AS total_members, COUNT(*) FILTER (WHERE is_opt_in_email=true) AS opted_in, COUNT(*) FILTER (WHERE is_opt_in_email=true AND ga_sessions>0) AS opted_in_web_active FROM app.customer_profiles
② query_data: SELECT age_group, COUNT(*) AS count FROM app.customer_profiles WHERE is_opt_in_email=true AND ga_sessions>0 AND age_group IS NOT NULL GROUP BY age_group ORDER BY count DESC
③ preview_segment_size: { segment_type:"customer", sql_where:"is_opt_in_email = true AND member_id IN (SELECT member_id FROM app.customer_profiles WHERE ga_sessions > 0)" }
④ list_segments
⑤ suggest_edm_opportunities
⑥ preview_edm_recipients: { segment_description:"email opted-in members with web activity", filters:{ min_ga_sessions:1 } }
⑦ analyze_edm_performance
⑧ suggest_send_time: { segment_description:"email opted-in members with web activity" }

Expected output structure:
**[Direct answer: "I found X opted-in members who've also visited your website. Here's what I recommend."]**
[chart: audience funnel using ① results]
[chart: age group breakdown using ② results]
[segment block: estimated_size from ③]
[edm block: estimated_recipients from ⑥, _suggested_utm action="pending"]
[UTM question text]

═══ MEMBER ↔ GA ACTIVITY JOIN (VERIFIED WORKING) ═══
★ PREFERRED: For audience analytics and segmentation, use app.customer_profiles directly — it has ga_sessions, ga_page_views, seminar_count pre-joined. Only use the raw JOIN below when you need session-level detail (e.g. "which pages did member X visit?").

Members can be linked to their real GA4 sessions using the Capsuite tracking pixel custom dimensions.

JOIN PATH (for session-level queries):
  ga_landing.path_exploration pe
    INNER JOIN public.membership_ap_mapping apm ON pe.capsuite_apid = apm.capsuite_apid
    INNER JOIN public.membership m ON apm.membership_id = m.member_id

KEY COLUMNS:
  path_exploration.capsuite_apid  — Capsuite application/session ID captured in GA4 as custom dimension
  path_exploration.capsuite_sid   — Capsuite session ID (secondary identifier, use if apid is empty)
  membership_ap_mapping.capsuite_apid — same ID, links to membership_id
  membership_ap_mapping.membership_id — foreign key to membership.member_id

COVERAGE (as of latest data):
  - Total members: ~2,238 | Members with ≥1 GA event: 51 (only logged-in sessions are tracked)
  - Matched GA events: 986 out of 105,387 total (most traffic is anonymous)
  - Members with ap_mapping entries: ~2,989 (a member can have multiple capsuite_apids)
  - When you JOIN, you get: member profile + their exact GA journey (pages, events, campaigns, source/medium)

MEMBER FIELDS USEFUL FOR SEGMENTATION (public.membership):
  primary_email, eng_full_name, member_id, member_no
  member_reg_channel (Seminar, Direct, Consultant Referral, etc.)
  member_join_date (timestamptz)
  gender, age_group, education_level, income_level, employment_status
  nationality, preferred_language, preferred_channel
  is_opt_in_email, is_subscriber_only

OFFLINE EVENTS (public.membership_custom_activity):
  capsuite_ref, membership_id, event_date, event_ref_id, event_name (seminar/webinar names), action (submit)
  — 3,361 events tracking seminar registrations and form submissions by members
  — JOIN to membership: WHERE mc.membership_id = m.member_id
  — Combine with GA path_exploration to get: who registered → did they also visit the website?

EXAMPLE QUERIES:
  -- Members who completed a GA form event + their profile:
  SELECT m.eng_full_name, m.member_reg_channel, m.education_level, pe.session_campaign_name, pe.session_source_medium
  FROM ga_landing.path_exploration pe
  INNER JOIN public.membership_ap_mapping apm ON pe.capsuite_apid = apm.capsuite_apid
  INNER JOIN public.membership m ON apm.membership_id = m.member_id
  WHERE pe.event_name IN ('Event_Form_Complete','form_submit')

  -- Top campaigns reaching known members:
  SELECT pe.session_campaign_name, pe.session_source_medium, COUNT(DISTINCT apm.membership_id) as members
  FROM ga_landing.path_exploration pe
  INNER JOIN public.membership_ap_mapping apm ON pe.capsuite_apid = apm.capsuite_apid
  GROUP BY pe.session_campaign_name, pe.session_source_medium ORDER BY members DESC

  -- Members with seminar activity + their GA web visits:
  SELECT m.eng_full_name, mc.event_name as seminar, mc.event_date,
    COUNT(pe.capsuite_apid) as web_events
  FROM public.membership m
  INNER JOIN public.membership_custom_activity mc ON mc.membership_id = m.member_id
  LEFT JOIN public.membership_ap_mapping apm ON apm.membership_id = m.member_id
  LEFT JOIN ga_landing.path_exploration pe ON pe.capsuite_apid = apm.capsuite_apid
  GROUP BY m.eng_full_name, mc.event_name, mc.event_date ORDER BY web_events DESC

═══ BEHAVIOUR RULES ═══
1. ALWAYS call tools and query the database FIRST — never state any specific number without a tool result to back it. If you don't have a tool result for a number, say "I couldn't get a live count" instead of inventing one.
2. ALWAYS include a chart when presenting quantitative data — always use real SQL query results for chart data points, never invent values.
3. Run multiple targeted queries — look at the problem from 2–3 angles before concluding.
4. After data, always add "What this means:" — connect to business outcomes (revenue, retention, growth).
5. Surface one related insight proactively — the thing they didn't ask for but should know.
6. For UTM questions/optimisation: call \`analyze_utm_performance\` first to identify top AND bottom performers, then suggest specific improvements. Only output a utm_link block when the user asks for one.
7. For segmentation: cross-reference GA behaviour with membership data using the JOIN PATH. Call \`preview_segment_size\` with the exact SQL WHERE before outputting the segment block — estimated_size must equal that result.
8. For member analysis: use the JOIN PATH; remember only ~51 members have GA data (logged-in sessions); use membership_custom_activity for offline events.
9. For "create campaigns / suggest campaigns for [audience]": follow the COMBINED CAMPAIGN RESPONSE PATTERN above — verify audience with tools first, then chart → segment → edm → ask about UTM.
10. Keep responses focused — one big insight beats five mediocre ones.
11. If the user has existing campaigns or segments (shown in context), reference them when relevant rather than creating duplicates.
12. Use \`list_tables\` / \`describe_table\` when unsure about a table's structure — never guess column names.
13. For segment suggestions: estimated_size MUST come from a \`preview_segment_size\` tool call with a concrete SQL WHERE clause for this exact audience.
14. For EDM suggestions: estimated_recipients MUST come from a \`preview_edm_recipients\` tool call — never invent this number.
15. NEVER save segments, UTM links, or campaigns autonomously — only recommend via markdown blocks; the user approves via the UI.
16. UTM links: NEVER auto-include a utm_link block in a first response — always ask the user first; only output the block after explicit confirmation.

═══ EDM EMAIL CAMPAIGNS ═══
You are a full email campaign strategist. When asked about email, campaigns, or "what should I send?":

STEP 1 — UNDERSTAND THE OPPORTUNITY
• Call \`suggest_edm_opportunities\` to surface the highest-impact campaign types with real counts.
• Call \`preview_edm_recipients\` for any segment you want to target to get the exact opted-in count.
• Call \`list_edm_campaigns\` to see what's already been sent — avoid duplicates.

STEP 2 — UNDERSTAND THE AUDIENCE
• Call \`get_member_profile_breakdown\` to understand demographics (e.g. breakdown_by: "age_group") before writing.
• Call \`analyze_edm_performance\` to see what's worked — use past open rates to justify your angle.
• Call \`suggest_send_time\` to recommend the best day and time.

STEP 3 — MATCH SEGMENT (UTM comes AFTER asking the user)
• Call \`list_segments\` to check for an existing segment matching the target audience.
  - If a good match exists → set _suggested_segment.action = "use_existing" with its id and name.
  - If no match → set _suggested_segment.action = "create_new" with name, description, segment_type, estimated_size from preview_segment_size.
• For _suggested_utm: ALWAYS set action = "pending" in the first/initial EDM response.
  - Populate utm_source="email", utm_medium="email", utm_campaign slug so it's ready.
  - But action="pending" means the UI shows the option without pre-selecting it — the user must click.
  - ALWAYS ask the user about UTM at the end of your response (see STEP E in COMBINED CAMPAIGN RESPONSE PATTERN).
• Include both _suggested_segment and _suggested_utm in the edm block — never omit them.

STEP 4 — DRAFT THE CAMPAIGN
Output one or more edm blocks. Each must include:
- A subject line under 50 chars (sentence case, no spam words)
- Full email content in _blocks array (visual editor format — see below)
- html_body as HTML fallback
- rationale explaining WHY this campaign, backed by data
- _suggested_segment and _suggested_utm (required — see format below)
- trigger_type and trigger_event if event-triggered
- suggested_send_time from suggest_send_time results

EDM APP SCHEMA:
  app.edm_campaigns — email campaigns (subject, body, segment, UTM link, status, stats)
  app.edm_templates — reusable HTML email templates
  app.edm_sends     — per-recipient send records
  app.edm_events    — engagement events (open, click, bounce, unsubscribe)
  app.edm_suppression — do-not-email list

PERSONALIZATION TOKENS: {{first_name}}, {{last_name}}, {{full_name}}, {{email}}, {{member_type}}, {{member_no}}

━━━ VISUAL BLOCKS FORMAT (_blocks array) ━━━
Always include _blocks so the user can open the campaign in the visual editor.
Use these exact schemas — the visual editor will render them:

header:  {"id":"h1","type":"header","config":{"title":"Hi {{first_name}},","subtitle":"","bgColor":"#ffffff","color":"#111111","subtitleColor":"#6b7280","align":"left","fontSize":26,"padding":24}}
text:    {"id":"t1","type":"text","config":{"content":"Your message.","color":"#374151","fontSize":15,"lineHeight":1.6,"padding":16}}
button:  {"id":"b1","type":"button","config":{"text":"Click here","url":"https://","bgColor":"#2563eb","color":"#ffffff","align":"center","fontSize":14,"paddingV":12,"paddingH":28,"radius":6,"padding":16}}
divider: {"id":"d1","type":"divider","config":{"color":"#e5e7eb","thickness":1,"margin":16}}
spacer:  {"id":"s1","type":"spacer","config":{"height":24}}

Tailor bgColor/color to match the campaign tone:
  Welcome → bgColor:#eff6ff color:#1d4ed8  |  Win-back → bgColor:#f0fdf4 color:#065f46
  Promo   → bgColor:#fef2f2 color:#991b1b  |  Neutral  → bgColor:#ffffff color:#111111

━━━ FULL EDM BLOCK FORMAT ━━━
\`\`\`edm
{
  "name": "Campaign name — specific and descriptive",
  "subject": "Subject under 50 chars with {{first_name}}",
  "preview_text": "One sentence shown before email opens in inbox",
  "from_name": "Click AI",
  "from_email": "onboarding@resend.dev",
  "estimated_recipients": 342,
  "segment_description": "Who this targets and why — describe the criteria",
  "segment_id": "uuid-if-you-found-one-from-list_segments-or-omit",
  "trigger_type": "manual",
  "trigger_event": "new_member",
  "suggested_send_time": "Tuesday at 9am",
  "utm_campaign_name": "slug-for-utm-tracking",
  "rationale": "2–3 sentences explaining why this campaign, backed by the data you pulled.",
  "_suggested_segment": {
    "action": "create_new",
    "name": "Members Inactive 90 Days",
    "description": "Opted-in members with no web sessions in the last 90 days",
    "segment_type": "customer",
    "estimated_size": 127,
    "rationale": "No existing segment matches — creating this lets you reuse it for future win-back campaigns.",
    "metadata": {
      "criteria": ["No web sessions in 90+ days", "is_opt_in_email = true", "member_type = customer"]
    },
    "existing_segment_id": null,
    "existing_segment_name": null
  },
  "_suggested_utm": {
    "action": "pending",
    "name": "Win-back May 2025",
    "utm_source": "email",
    "utm_medium": "email",
    "utm_campaign": "winback-inactive-90d-may25",
    "rationale": "UTM tracking would let you measure email click-through rates in your analytics dashboard.",
    "existing_utm_id": null,
    "existing_utm_name": null
  },
  "_trigger_type": "event",
  "_blocks": [
    {"id":"h1","type":"header","config":{"title":"Hi {{first_name}},","subtitle":"Subtitle here","bgColor":"#eff6ff","color":"#1d4ed8","subtitleColor":"#6b7280","align":"left","fontSize":26,"padding":24}},
    {"id":"t1","type":"text","config":{"content":"Your personalised message here.","color":"#374151","fontSize":15,"lineHeight":1.6,"padding":16}},
    {"id":"b1","type":"button","config":{"text":"Primary CTA","url":"https://","bgColor":"#2563eb","color":"#ffffff","align":"center","fontSize":14,"paddingV":12,"paddingH":28,"radius":6,"padding":16}},
    {"id":"d1","type":"divider","config":{"color":"#e5e7eb","thickness":1,"margin":16}},
    {"id":"t2","type":"text","config":{"content":"You received this because you opted in to our communications.","color":"#9ca3af","fontSize":12,"lineHeight":1.5,"padding":16}}
  ],
  "html_body": "<div style='font-family:sans-serif;max-width:600px;margin:0 auto'><div style='padding:24px;background:#eff6ff'><h1 style='font-size:26px;color:#1d4ed8;margin:0'>Hi {{first_name}},</h1></div><div style='padding:16px'><p style='font-size:15px;color:#374151;line-height:1.6;margin:0'>Your message here.</p></div><div style='padding:16px;text-align:center'><a href='https://' style='display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600'>Click here</a></div></div>"
}
\`\`\`

CAMPAIGN TYPES & TRIGGERS:
  Welcome:       trigger_type=event  trigger_event=new_member
  Member Expiry: trigger_type=event  trigger_event=member_expired
  90-day lapse:  trigger_type=event  trigger_event=inactivity_90d
  Seminar f/up:  trigger_type=event  trigger_event=seminar_attended
  Birthday:      trigger_type=event  trigger_event=birthday
  Broadcast:     trigger_type=manual (no trigger_event)
  Scheduled:     trigger_type=scheduled (include a send date in rationale)

IMPORTANT EDM RULES:
- ALWAYS call suggest_edm_opportunities first when the user asks for email ideas
- ALWAYS call list_segments before outputting an edm block — check for existing segments first
- ALWAYS call preview_edm_recipients BEFORE outputting an edm block — estimated_recipients must equal the tool result; NEVER invent this number
- ALWAYS include _blocks with real, personalized content tailored to this specific audience (no generic placeholders)
- ALWAYS include _suggested_segment (required) and _suggested_utm (required, action="pending" on first suggestion)
- _suggested_segment: action="use_existing" if matching segment found; otherwise action="create_new" with count from preview_segment_size
- _suggested_segment MUST include metadata.criteria: array of 2–4 plain-English filter strings visible as tag chips in the UI
- estimated_size in _suggested_segment MUST come from a preview_segment_size tool call result
- _suggested_utm: ALWAYS set action="pending" on the first/initial suggestion — NEVER "create_new" without user confirmation
- ALWAYS end your EDM response asking the user about UTM tracking (see COMBINED CAMPAIGN RESPONSE PATTERN, STEP E)
- Subject lines: under 50 chars, sentence case, no ALL CAPS, no excessive punctuation
- Every email must include {{first_name}} somewhere to increase open rates
- html_body: inline CSS only (no <style> tags), max-width 600px
- Never suggest sending to users without is_opt_in_email=true — the platform enforces this
- You are only recommending. The user approves via "Save as Draft" or "Open in Editor" in the UI.`;

}

// ── AI agent loop (MCP-based) ─────────────────────────────────────────────────
// Tools are served by the MCP server (server/mcp/server.js).
// Tool groups: DB Connector, Segments, UTM — all read-only; no writes without user approval.
async function runAnalystAgent(messages) {
  if (!aiClient) throw new Error("Azure OpenAI is not configured.");
  if (!mcpClient) throw new Error("MCP analyst server is not initialized.");

  // Discover tools from MCP server and convert to OpenAI function format
  const { tools: mcpTools } = await mcpClient.listTools();
  const aiTools = toOpenAITools(mcpTools);

  const aiMessages = [
    { role: "system", content: buildSystemPrompt() },
    ...messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content || "" })),
  ];

  for (let i = 0; i < 12; i++) {
    const response = await aiClient.chat.completions.create({
      model: azureDeployment,
      messages: aiMessages,
      tools: aiTools,
      tool_choice: "auto",
      max_completion_tokens: 8192,
      temperature: 0.3,
    });

    const choice = response.choices[0];
    const msg = choice.message;

    if (msg.tool_calls?.length > 0) {
      aiMessages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });

      for (const tc of msg.tool_calls) {
        let toolResult;
        try {
          const args = JSON.parse(tc.function.arguments);
          const result = await mcpClient.callTool({ name: tc.function.name, arguments: args });
          toolResult = result.content?.[0]?.text ?? JSON.stringify(result);
        } catch (err) {
          toolResult = JSON.stringify({ error: String(err.message || err) });
        }
        aiMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
      }
      continue;
    }

    return msg.content || "";
  }

  return "I reached the analysis limit for this request. Please try a more specific question.";
}

// ── Simple LLM call (chart editor, explainers) ────────────────────────────────
async function runSimpleLLM(prompt, jsonMode = false) {
  if (!aiClient) throw new Error("Azure OpenAI is not configured.");
  const response = await aiClient.chat.completions.create({
    model: azureDeployment,
    messages: [{ role: "user", content: prompt }],
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    max_completion_tokens: 2000,
    temperature: 0.2,
  });
  return response.choices[0].message.content || "";
}

// ── Express setup ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(uploadsDir));

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "cdp-click-ai-server", ai: !!aiClient, db: !!pool });
});

// ── Auth ──────────────────────────────────────────────────────────────────────
app.get("/api/auth/me", (_req, res) => {
  res.json({ id: "local-user", email: "local@cdp-click-ai", role: "admin", name: "Local User" });
});

// ── Entity CRUD — backed by Postgres app schema ───────────────────────────────

app.get("/api/entities/:entity", async (req, res) => {
  const config = ENTITY_CONFIG[req.params.entity];
  if (!config) return res.status(400).json({ error: `Unknown entity: ${req.params.entity}` });
  try {
    const p = requirePool();
    const order = buildOrderBy(req.query.sort, config.sortable);
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 1000) : 500;
    const { rows } = await p.query(
      `SELECT * FROM ${config.table} ORDER BY ${order} LIMIT $1`,
      [limit]
    );
    res.json(rows.map(normalizeRow));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/entities/:entity", async (req, res) => {
  const config = ENTITY_CONFIG[req.params.entity];
  if (!config) return res.status(400).json({ error: `Unknown entity: ${req.params.entity}` });
  try {
    const p = requirePool();
    const cols = pickColumns(req.body, config.columns);

    if (cols.length === 0) {
      const { rows } = await p.query(`INSERT INTO ${config.table} DEFAULT VALUES RETURNING *`);
      return res.status(201).json(normalizeRow(rows[0]));
    }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const values = cols.map((c) => req.body[c]);
    const { rows } = await p.query(
      `INSERT INTO ${config.table} (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.patch("/api/entities/:entity/:id", async (req, res) => {
  const config = ENTITY_CONFIG[req.params.entity];
  if (!config) return res.status(400).json({ error: `Unknown entity: ${req.params.entity}` });
  try {
    const p = requirePool();
    const cols = pickColumns(req.body, config.columns);
    if (cols.length === 0) return res.status(400).json({ error: "No valid fields to update." });

    const setClauses = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
    const values = [...cols.map((c) => req.body[c]), req.params.id];
    const { rows } = await p.query(
      `UPDATE ${config.table} SET ${setClauses} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete("/api/entities/:entity/:id", async (req, res) => {
  const config = ENTITY_CONFIG[req.params.entity];
  if (!config) return res.status(400).json({ error: `Unknown entity: ${req.params.entity}` });
  try {
    const p = requirePool();
    await p.query(`DELETE FROM ${config.table} WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Conversations — backed by app.conversations ───────────────────────────────

app.get("/api/agents/conversations", async (req, res) => {
  try {
    const p = requirePool();
    let q = "SELECT * FROM app.conversations";
    const params = [];
    if (req.query.agent_name) {
      q += " WHERE agent_name = $1";
      params.push(req.query.agent_name);
    }
    q += " ORDER BY updated_date DESC LIMIT 200";
    const { rows } = await p.query(q, params);
    res.json(rows.map(normalizeRow));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/agents/conversations", async (req, res) => {
  try {
    const p = requirePool();
    const { rows } = await p.query(
      `INSERT INTO app.conversations (agent_name, metadata)
       VALUES ($1, $2) RETURNING *`,
      [req.body.agent_name || "cdp_analyst", req.body.metadata || {}]
    );
    res.status(201).json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/agents/conversations/:id", async (req, res) => {
  try {
    const p = requirePool();
    const { rows } = await p.query(
      "SELECT * FROM app.conversations WHERE id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Conversation not found" });
    res.json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.patch("/api/agents/conversations/:id", async (req, res) => {
  try {
    const p = requirePool();
    const allowed = new Set(["title", "metadata", "status"]);
    const cols = pickColumns(req.body, allowed);
    if (cols.length === 0) return res.status(400).json({ error: "No valid fields to update." });

    // Merge metadata instead of replacing
    const setClauses = cols.map((c, i) =>
      c === "metadata"
        ? `metadata = metadata || $${i + 1}`
        : `${c} = $${i + 1}`
    ).join(", ");
    const values = [...cols.map((c) => req.body[c]), req.params.id];

    const { rows } = await p.query(
      `UPDATE app.conversations SET ${setClauses} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Conversation not found" });
    res.json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete("/api/agents/conversations/:id", async (req, res) => {
  try {
    const p = requirePool();
    await p.query("DELETE FROM app.conversations WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Messages — returns immediately, runs AI in background
app.post("/api/agents/conversations/:id/messages", async (req, res) => {
  try {
    const p = requirePool();

    // Fetch current conversation
    const { rows: convRows } = await p.query(
      "SELECT * FROM app.conversations WHERE id = $1",
      [req.params.id]
    );
    if (convRows.length === 0) return res.status(404).json({ error: "Conversation not found" });

    const conv = normalizeRow(convRows[0]);
    const userMsg = {
      role: req.body.role || "user",
      content: req.body.content || "",
      file_urls: req.body.file_urls || [],
      created_date: new Date().toISOString(),
    };

    const updatedMessages = [...(conv.messages || []), userMsg];

    // Save user message and set status to processing
    const { rows: updated } = await p.query(
      `UPDATE app.conversations
       SET messages = $1::jsonb, status = 'processing', updated_date = NOW()
       WHERE id = $2 RETURNING *`,
      [JSON.stringify(updatedMessages), req.params.id]
    );

    // Return immediately so frontend can show loading state
    res.json(normalizeRow(updated[0]));

    // Run AI in background
    const convId = req.params.id;
    const agentName = conv.agent_name;

    (async () => {
      let replyContent;
      try {
        replyContent = await runAnalystAgent(updatedMessages);
      } catch (err) {
        console.error("AI agent error:", err.message);
        replyContent = `I encountered an error while processing your request: ${err.message}`;
      }

      const assistantMsg = {
        role: "assistant",
        content: replyContent,
        created_date: new Date().toISOString(),
      };

      const { rows: finalConv } = await p.query(
        "SELECT messages FROM app.conversations WHERE id = $1",
        [convId]
      );
      if (finalConv.length === 0) return;

      const finalMessages = [...(finalConv[0].messages || []), assistantMsg];
      await p.query(
        `UPDATE app.conversations
         SET messages = $1::jsonb, status = 'idle', updated_date = NOW()
         WHERE id = $2`,
        [JSON.stringify(finalMessages), convId]
      );
    })().catch(console.error);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Functions ─────────────────────────────────────────────────────────────────

app.post("/api/functions/queryPostgres", async (req, res) => {
  try {
    const result = await runReadOnlyQuery(req.body.query);
    res.json({ data: result });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/api/functions/deleteConversation", async (req, res) => {
  try {
    const p = requirePool();
    await p.query("DELETE FROM app.conversations WHERE id = $1", [req.body.conversation_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── LLM integration (chart editor, explainers) ────────────────────────────────
app.post("/api/integrations/llm", async (req, res) => {
  if (!aiClient) {
    return res.status(503).json({ error: "Azure OpenAI is not configured." });
  }
  try {
    const content = await runSimpleLLM(
      String(req.body.prompt || ""),
      !!req.body.response_json_schema
    );
    if (req.body.response_json_schema) return res.json(JSON.parse(content));
    return res.json(content);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Chart Summaries (DB-cached AI explanations) ───────────────────────────────
app.post("/api/chart-summaries/explain", async (req, res) => {
  if (!aiClient) return res.status(503).json({ error: "Azure OpenAI is not configured." });
  const { chart_key, chart_title, chart_type, data } = req.body;
  if (!chart_key) return res.status(400).json({ error: "chart_key is required" });
  const p = requirePool();
  try {
    const existing = await p.query(
      "SELECT summary FROM app.chart_summaries WHERE chart_key = $1",
      [chart_key]
    );
    if (existing.rows.length > 0) return res.json({ summary: existing.rows[0].summary });

    const dataPreview = JSON.stringify((data || []).slice(0, 15), null, 2).slice(0, 1500);
    const prompt = `You are a digital marketing analyst. Explain the following chart clearly and concisely to a business user.

Chart title: "${chart_title}"
Chart type: ${chart_type}
Data:
${dataPreview}

Explain:
1. What this chart shows (1-2 sentences)
2. The key insight or standout figure (1-2 sentences)
3. One actionable recommendation (1 sentence)

Be plain, specific, and business-focused. Reference actual numbers from the data.`;

    const summary = await runSimpleLLM(prompt, false);
    await p.query(
      `INSERT INTO app.chart_summaries (chart_key, summary) VALUES ($1, $2)
       ON CONFLICT (chart_key) DO UPDATE SET summary = EXCLUDED.summary, updated_date = NOW()`,
      [chart_key, summary]
    );
    return res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: refresh trigger ─────────────────────────────────────────────────
app.post("/api/profiles/refresh", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  try {
    await refreshProfiles(pool);
    const [c, a] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM app.customer_profiles"),
      pool.query("SELECT COUNT(*) FROM app.anonymous_profiles"),
    ]);
    res.json({ ok: true, customers: parseInt(c.rows[0].count), anonymous: parseInt(a.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: Customers (reads from app.customer_profiles) ────────────────────
app.get("/api/profiles/customers", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  try {
    const {
      search = "", page = "1", limit = "20",
      reg_channel, education_level, age_group, gender, nationality, preferred_language,
      employment_status, income_level, member_type, preferred_channel,
      has_ga, min_ga_sessions,
      opt_in_email, opt_in_sms, is_subscriber,
      has_seminars, has_attributes,
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(LOWER(eng_full_name) LIKE $${params.length} OR LOWER(primary_email) LIKE $${params.length} OR member_no LIKE $${params.length})`);
    }
    if (reg_channel)        { params.push(reg_channel);        conditions.push(`member_reg_channel = $${params.length}`); }
    if (education_level)    { params.push(education_level);    conditions.push(`education_level = $${params.length}`); }
    if (age_group)          { params.push(age_group);          conditions.push(`age_group = $${params.length}`); }
    if (gender)             { params.push(gender);             conditions.push(`gender = $${params.length}`); }
    if (nationality)        { params.push(nationality);        conditions.push(`nationality = $${params.length}`); }
    if (preferred_language) { params.push(preferred_language); conditions.push(`preferred_language = $${params.length}`); }
    if (employment_status)  { params.push(employment_status);  conditions.push(`employment_status = $${params.length}`); }
    if (income_level)       { params.push(income_level);       conditions.push(`income_level = $${params.length}`); }
    if (member_type)        { params.push(member_type);        conditions.push(`member_type = $${params.length}`); }
    if (preferred_channel)  { params.push(preferred_channel);  conditions.push(`preferred_channel = $${params.length}`); }
    if (has_ga === "true")        conditions.push("ga_sessions > 0");
    if (min_ga_sessions)          { params.push(parseInt(min_ga_sessions)); conditions.push(`ga_sessions >= $${params.length}`); }
    if (opt_in_email === "true")  conditions.push("is_opt_in_email = true");
    if (opt_in_email === "false") conditions.push("(is_opt_in_email = false OR is_opt_in_email IS NULL)");
    if (opt_in_sms === "true")    conditions.push("is_opt_in_sms = true");
    if (is_subscriber === "true") conditions.push("is_subscriber_only = true");
    if (has_seminars === "true")  conditions.push("seminar_count > 0");
    if (has_attributes === "true") conditions.push("attribute_count > 0");

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(parseInt(limit), offset);

    const [result, countResult] = await Promise.all([
      pool.query(`SELECT * FROM app.customer_profiles ${where} ORDER BY member_join_date DESC NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM app.customer_profiles ${where}`, params.slice(0, params.length - 2)),
    ]);
    res.json({ profiles: result.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/profiles/customer-filters", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  try {
    const [channels, educations, ages, genders, nationalities, languages, employments, incomes, memberTypes, prefChannels] = await Promise.all([
      pool.query("SELECT DISTINCT member_reg_channel FROM app.customer_profiles WHERE member_reg_channel IS NOT NULL ORDER BY member_reg_channel"),
      pool.query("SELECT DISTINCT education_level FROM app.customer_profiles WHERE education_level IS NOT NULL ORDER BY education_level"),
      pool.query("SELECT DISTINCT age_group FROM app.customer_profiles WHERE age_group IS NOT NULL ORDER BY age_group"),
      pool.query("SELECT DISTINCT gender FROM app.customer_profiles WHERE gender IS NOT NULL ORDER BY gender"),
      pool.query("SELECT DISTINCT nationality FROM app.customer_profiles WHERE nationality IS NOT NULL ORDER BY nationality"),
      pool.query("SELECT DISTINCT preferred_language FROM app.customer_profiles WHERE preferred_language IS NOT NULL ORDER BY preferred_language"),
      pool.query("SELECT DISTINCT employment_status FROM app.customer_profiles WHERE employment_status IS NOT NULL ORDER BY employment_status"),
      pool.query("SELECT DISTINCT income_level FROM app.customer_profiles WHERE income_level IS NOT NULL ORDER BY income_level"),
      pool.query("SELECT DISTINCT member_type FROM app.customer_profiles WHERE member_type IS NOT NULL ORDER BY member_type"),
      pool.query("SELECT DISTINCT preferred_channel FROM app.customer_profiles WHERE preferred_channel IS NOT NULL ORDER BY preferred_channel"),
    ]);
    res.json({
      reg_channels: channels.rows.map(r => r.member_reg_channel),
      education_levels: educations.rows.map(r => r.education_level),
      age_groups: ages.rows.map(r => r.age_group),
      genders: genders.rows.map(r => r.gender),
      nationalities: nationalities.rows.map(r => r.nationality),
      languages: languages.rows.map(r => r.preferred_language),
      employment_statuses: employments.rows.map(r => r.employment_status),
      income_levels: incomes.rows.map(r => r.income_level),
      member_types: memberTypes.rows.map(r => r.member_type),
      preferred_channels: prefChannels.rows.map(r => r.preferred_channel),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: Anonymous (reads from app.anonymous_profiles) ───────────────────
app.get("/api/profiles/anonymous", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  try {
    const { search = "", page = "1", limit = "20", source_medium, has_form_complete } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];

    if (search)       { params.push(`%${search.toLowerCase()}%`); conditions.push(`LOWER(visitor_id) LIKE $${params.length}`); }
    if (source_medium){ params.push(source_medium); conditions.push(`$${params.length} = ANY(source_mediums)`); }
    if (has_form_complete === "true") conditions.push("form_completes > 0");

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(parseInt(limit), offset);

    const [result, countResult] = await Promise.all([
      pool.query(`SELECT * FROM app.anonymous_profiles ${where} ORDER BY total_events DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM app.anonymous_profiles ${where}`, params.slice(0, params.length - 2)),
    ]);
    res.json({ profiles: result.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/profiles/anonymous-filters", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  try {
    const r = await pool.query(`
      SELECT DISTINCT UNNEST(source_mediums) AS sm FROM app.anonymous_profiles ORDER BY sm
    `);
    res.json({ source_mediums: r.rows.map(x => x.sm).filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── EDM routes ───────────────────────────────────────────────────────────────
if (pool) {
  app.use("/api/edm", createEdmRouter(pool));
}

// ── EDM tracking endpoints (open pixel + click redirect + unsubscribe) ────────
// These are intentionally outside /api so URLs are short and clean.

// Open pixel — 1x1 transparent GIF
app.get("/track/o/:sendId", async (req, res) => {
  const gif1x1 = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64"
  );
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.end(gif1x1);

  if (!pool) return;
  try {
    const { rows: [send] } = await pool.query(
      `SELECT id, edm_campaign_id, email FROM app.edm_sends WHERE id=$1`,
      [req.params.sendId]
    );
    if (send) {
      await pool.query(
        `INSERT INTO app.edm_events (edm_campaign_id, send_id, email, event_type)
         VALUES ($1,$2,$3,'open')`,
        [send.edm_campaign_id, send.id, send.email]
      );
    }
  } catch { /* silent — don't break pixel response */ }
});

// Click redirect
app.get("/track/c/:sendId/:url", async (req, res) => {
  let destination = "/";
  try {
    destination = decodeURIComponent(req.params.url);
  } catch { destination = "/"; }

  res.redirect(302, destination);

  if (!pool) return;
  try {
    const { rows: [send] } = await pool.query(
      `SELECT id, edm_campaign_id, email FROM app.edm_sends WHERE id=$1`,
      [req.params.sendId]
    );
    if (send) {
      await pool.query(
        `INSERT INTO app.edm_events (edm_campaign_id, send_id, email, event_type, link_url)
         VALUES ($1,$2,$3,'click',$4)`,
        [send.edm_campaign_id, send.id, send.email, destination]
      );
    }
  } catch { /* silent */ }
});

// One-click unsubscribe
app.get("/track/u/:sendId", async (req, res) => {
  res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>You have been unsubscribed.</h2>
    <p>You will no longer receive marketing emails from us.</p>
  </body></html>`);

  if (!pool) return;
  try {
    const { rows: [send] } = await pool.query(
      `SELECT id, edm_campaign_id, email FROM app.edm_sends WHERE id=$1`,
      [req.params.sendId]
    );
    if (send) {
      await Promise.all([
        pool.query(
          `INSERT INTO app.edm_events (edm_campaign_id, send_id, email, event_type)
           VALUES ($1,$2,$3,'unsubscribe')`,
          [send.edm_campaign_id, send.id, send.email]
        ),
        pool.query(
          `INSERT INTO app.edm_suppression (email, reason) VALUES ($1,'unsubscribed')
           ON CONFLICT (email) DO UPDATE SET reason='unsubscribed', added_at=NOW()`,
          [send.email]
        ),
      ]);
    }
  } catch { /* silent */ }
});

// ── File upload ───────────────────────────────────────────────────────────────
app.post("/api/integrations/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const safeName = `${Date.now()}-${req.file.originalname}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const finalPath = path.join(uploadsDir, safeName);
  fs.renameSync(req.file.path, finalPath);
  res.json({ file_url: `/uploads/${safeName}` });
});

// ── Production static serving ─────────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const distDir = path.join(rootDir, "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  await initDb();

  if (pool) {
    try {
      mcpClient = await createAnalystMCPClient(pool, dataDictionary);
      const { tools } = await mcpClient.listTools();
      console.log(`  MCP: Analyst server ready (${tools.length} tools: ${tools.map((t) => t.name).join(", ")})`);
    } catch (err) {
      console.error("  MCP: Failed to initialize —", err.message);
    }
  }

  app.listen(port, () => {
    console.log(`cdp-click-ai server running on http://localhost:${port}`);
    console.log(`  AI: ${aiClient ? `Azure OpenAI (${azureDeployment})` : "NOT CONFIGURED"}`);
    console.log(`  DB: ${pool ? "Postgres connected" : "NOT CONFIGURED"}`);
  });

  // ── EDM scheduled campaign cron (runs every minute) ──────────────────────
  if (pool) {
    cron.schedule("* * * * *", async () => {
      try {
        const { rows: due } = await pool.query(`
          SELECT id FROM app.edm_campaigns
          WHERE status = 'scheduled'
            AND scheduled_at <= NOW()
          LIMIT 5
        `);
        for (const { id } of due) {
          console.log(`[EDM cron] Firing scheduled campaign: ${id}`);
          fetch(`http://localhost:${port}/api/edm/campaigns/${id}/send`, { method: "POST" })
            .catch(e => console.error(`[EDM cron] Send failed for ${id}:`, e.message));
        }
      } catch (e) {
        console.error("[EDM cron]", e.message);
      }
    });
    console.log("  EDM: Scheduled campaign cron running");
  }
}

start().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});
