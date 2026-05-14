import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import multer from "multer";
import { Pool } from "pg";
import { fileURLToPath } from "url";
import OpenAI from "openai";

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
For every question, work through these steps before writing your response:
1. What business decision is this user trying to make?
2. What data do I need to query to give a real, accurate answer?
3. What are 2-3 angles I should look at this from (not just the obvious one)?
4. What is the single most important insight in the data?
5. What related insight would surprise or delight the user?
6. Can I suggest a UTM link or audience segment based on what I found?

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
    Columns: id, title, content, tags, schedule, created_date
  app.pinned_charts — charts pinned to dashboard
    Columns: id, title, chart_type, description, query, created_date

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

When you spot a campaign opportunity, suggest a ready-to-use UTM link:
\`\`\`utm_link
{
  "name": "Descriptive campaign name",
  "base_url": "https://example.com/landing-page",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "campaign_slug",
  "utm_term": "",
  "utm_content": "",
  "status": "draft"
}
\`\`\`

When you identify a targetable audience, suggest a segment. Use segment_type "customer" for known members (public.membership), or "anonymous_profile" for anonymous GA visitors. Always query the DB to estimate the size:
\`\`\`segment
{
  "name": "Segment Name",
  "description": "Who this is and why they matter. Criteria: reg_channel=Seminar, education_level=HK - Form 5, has web activity.",
  "segment_type": "customer",
  "estimated_size": 342,
  "status": "draft"
}
\`\`\`
For customer segments, try to COUNT from public.membership with the relevant WHERE filters before suggesting.
For anonymous segments, COUNT from ga_landing.path_exploration grouped by capsuite_apid with relevant conditions.
The description should explicitly state the criteria (e.g. reg_channel, education_level, source_medium, event types) so users can reproduce the filter on the Profiles page.

When presenting raw data the user may want to export:
\`\`\`csv
col1,col2,col3
val1,val2,val3
\`\`\`

═══ MEMBER ↔ GA ACTIVITY JOIN (VERIFIED WORKING) ═══
Members can be linked to their real GA4 sessions using the Capsuite tracking pixel custom dimensions.

JOIN PATH (always use this exact pattern):
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
1. ALWAYS query the database first — never state a specific number without data to back it
2. ALWAYS include a chart when presenting quantitative data — do not skip this
3. Run multiple queries if needed — look at the problem from different angles
4. After data, always add "What this means:" — connect to business outcomes
5. Surface one related insight proactively — the thing they didn't ask for but need to know
6. For UTM questions: analyse performance across sources/mediums/campaigns, identify the top performers AND the underperformers, suggest specific improvements with a utm_link block
7. For segmentation: cross-reference GA behaviour with membership data when possible using the member-GA join, give a concrete segment definition with estimated size
8. For member analysis: use the JOIN PATH above, remember only ~51 members have GA data (logged-in sessions); use membership_custom_activity for offline events
9. For "what should I do?" questions: lead with the highest-impact action, back every recommendation with real data
10. Keep responses focused — one big insight beats five mediocre ones
11. If the user has existing campaigns or segments (shown in context), reference them when relevant`;
}

// ── AI tools ──────────────────────────────────────────────────────────────────
const ANALYST_TOOLS = [
  {
    type: "function",
    function: {
      name: "queryPostgres",
      description:
        "Execute a read-only SELECT query against the PostgreSQL database. Use this whenever you need actual data to answer the user's question.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description:
              "A valid SELECT SQL statement. Must start with SELECT. No semicolons. Always prefix table names with schema (e.g. ga_landing.website_metrics).",
          },
        },
        required: ["sql"],
      },
    },
  },
];

// ── AI agent loop ─────────────────────────────────────────────────────────────
async function runAnalystAgent(messages) {
  if (!aiClient) throw new Error("Azure OpenAI is not configured.");

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
      tools: ANALYST_TOOLS,
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
          if (tc.function.name === "queryPostgres") {
            const qr = await runReadOnlyQuery(args.sql);
            toolResult = JSON.stringify({ rows: qr.rows, rowCount: qr.rowCount });
          } else {
            toolResult = JSON.stringify({ error: `Unknown function: ${tc.function.name}` });
          }
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
    const { search = "", page = "1", limit = "20", reg_channel, education_level, age_group, gender, nationality, preferred_language, has_ga } = req.query;
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
    if (has_ga === "true") conditions.push("ga_sessions > 0");

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
    const [channels, educations, ages, genders, nationalities, languages] = await Promise.all([
      pool.query("SELECT DISTINCT member_reg_channel FROM app.customer_profiles WHERE member_reg_channel IS NOT NULL ORDER BY member_reg_channel"),
      pool.query("SELECT DISTINCT education_level FROM app.customer_profiles WHERE education_level IS NOT NULL ORDER BY education_level"),
      pool.query("SELECT DISTINCT age_group FROM app.customer_profiles WHERE age_group IS NOT NULL ORDER BY age_group"),
      pool.query("SELECT DISTINCT gender FROM app.customer_profiles WHERE gender IS NOT NULL ORDER BY gender"),
      pool.query("SELECT DISTINCT nationality FROM app.customer_profiles WHERE nationality IS NOT NULL ORDER BY nationality"),
      pool.query("SELECT DISTINCT preferred_language FROM app.customer_profiles WHERE preferred_language IS NOT NULL ORDER BY preferred_language"),
    ]);
    res.json({
      reg_channels: channels.rows.map(r => r.member_reg_channel),
      education_levels: educations.rows.map(r => r.education_level),
      age_groups: ages.rows.map(r => r.age_group),
      genders: genders.rows.map(r => r.gender),
      nationalities: nationalities.rows.map(r => r.nationality),
      languages: languages.rows.map(r => r.preferred_language),
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
  app.listen(port, () => {
    console.log(`cdp-click-ai server running on http://localhost:${port}`);
    console.log(`  AI: ${aiClient ? `Azure OpenAI (${azureDeployment})` : "NOT CONFIGURED"}`);
    console.log(`  DB: ${pool ? "Postgres connected" : "NOT CONFIGURED"}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});
