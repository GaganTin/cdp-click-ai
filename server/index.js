import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import multer from "multer";
import { Pool } from "pg";
import { fileURLToPath } from "url";
import { randomUUID, createHash } from "crypto";
import OpenAI from "openai";
import cron from "node-cron";
import { createAnalystMCPClient, toOpenAITools } from "./mcp/server.js";
import { createEdmRouter } from "./routes/edm.js";
import { createIntegrationsRouter } from "./routes/integrations.js";
import { createAttributesRouter } from "./routes/attributes.js";
import { startIntegrationQueueWorker } from "./lib/integrationQueue.js";
import { startNotificationScanWorker } from "./lib/notificationsScan.js";
import { startAttributeQueueWorker, processNextAttributeJob } from "./lib/attributeQueue.js";
import { runDailyRuleRefresh } from "./lib/attributeRules.js";
import { runDailyTestLinkRefresh } from "./lib/attributeTestLinks.js";
import { createAuthRouter } from "./routes/auth.js";
import { createCompanyRouter } from "./routes/company.js";
import { createAccountRouter } from "./routes/account.js";
import { createPlansRouter, FALLBACK_PLANS } from "./routes/plans.js";
import { createBillingRouter } from "./routes/billing.js";
import { createAdminRouter } from "./routes/admin.js";
import { createSupportRouter } from "./routes/support.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createAnnouncementsRouter } from "./routes/announcements.js";
import { createPopupRouter } from "./routes/popup.js";
import { createUtmRouter } from "./routes/utm.js";
import { authenticate, withCompany, resolveCompanyId, setAuthPool, planLimit } from "./middleware/auth.js";
import { resolveSegmentEntities, countSegmentEntities, customerWhere, anonWhere } from "./lib/attributeManual.js";
import { recordAiUsage, enforceAiQuota } from "./lib/aiUsage.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(__dirname, "uploads");

const app = express();
// Behind a reverse proxy in production (Render, etc.): trust X-Forwarded-* so
// req.ip is the real client IP (per-IP auth rate limiting buckets correctly
// instead of lumping every user under the proxy IP) and req.protocol reflects
// the original https scheme (secure-cookie detection).
app.set("trust proxy", 1);
const port = Number(process.env.PORT || 3001);
const pgConn = process.env.POSTGRESQL_CONN || process.env.DATABASE_URL || "";

const upload = multer({ dest: uploadsDir });
const pool = pgConn ? new Pool({ connectionString: pgConn }) : null;
// Let authenticate() invalidate tokens issued before a password change.
if (pool) setAuthPool(pool);

// Verify the caller is an active member of the x-company-id workspace before any
// company-scoped query. Returns the company_id, or null after sending the error.
// blockViewerOnPost:false → viewers may still use read-style POSTs (e.g. the
// analyst) but PATCH/PUT/DELETE are blocked for them.
async function companyGuard(req, res) {
  return resolveCompanyId(pool, req, res, { blockViewerOnPost: false });
}

// Some write endpoints are POSTs, which companyGuard deliberately lets viewers
// reach (read-style POSTs like the analyst must keep working for viewers). For
// the POSTs that ARE real writes (imports, entity creation) block viewers
// explicitly. companyGuard has already stashed req.companyRole. Returns true
// (after sending 403) when blocked. `action` completes "...can't <action>.".
function denyViewer(req, res, action = "make changes") {
  if (req.companyRole === "viewer") {
    res.status(403).json({ error: `Viewers have read-only access and can't ${action}.` });
    return true;
  }
  return false;
}

// ── Azure OpenAI ──────────────────────────────────────────────────────────────
const azureEndpoint = (process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/$/, "");
const azureKey = process.env.AZURE_OPENAI_KEY || "";
const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini";
// Cheaper model for everything EXCEPT the AI Analyst. Azure routes by the
// deployment in the URL path, so a different model needs its own client.
const azureDeploymentFast = process.env.AZURE_OPENAI_DEPLOYMENT_FAST || "gpt-5-nano";
const azureApiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview";

const makeAzureClient = (deployment) =>
  new OpenAI({
    baseURL: `${azureEndpoint}/openai/deployments/${deployment}`,
    apiKey: azureKey,
    defaultHeaders: { "api-key": azureKey },
    defaultQuery: { "api-version": azureApiVersion },
  });

// Analyst (strong, agentic tool-calling) vs fast (cheap, high-volume simple tasks).
const aiClient = azureKey && azureEndpoint ? makeAzureClient(azureDeployment) : null;
const aiClientFast = azureKey && azureEndpoint ? makeAzureClient(azureDeploymentFast) : null;

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
  // GA cubes (lib/cube_catalog) - the retired flat utm/country tables were dropped.
  path_exploration: "ga_landing",
  page_engagement_daily: "ga_landing",
  event_list: "ga_landing",
  page_metrics: "ga_landing",
  page_utm_metrics: "ga_landing",
  website_metrics: "ga_landing",
  session_quality_daily: "ga_landing",
  funnel_report: "ga_landing",
  purchase_list: "ga_landing",
  keyword_performance: "ga_landing",
  acquisition_session_daily: "ga_landing",
  acquisition_firstuser_daily: "ga_landing",
  channel_daily: "ga_landing",
  landing_page_daily: "ga_landing",
  utm_ad_performance: "ga_landing",
  utm_daily_utm_id_performance: "ga_landing",
  demographics_daily: "ga_landing",
  audience_daily: "ga_landing",
  tech_daily: "ga_landing",
  geo_daily: "ga_landing",
  interest_daily: "ga_landing",
  returning_daily: "ga_landing",
  item_performance: "ga_landing",
  item_attribution: "ga_landing",
  transaction_metrics: "ga_landing",
  cohort_weekly: "ga_landing",
  cohort_monthly: "ga_landing",
  customer_profiles: "app",
  anonymous_profiles: "app",
  profile_identities: "app",
  data_integrations: "app",
  company_report_config: "app",
  web_content_html_elements: "app",
};

// ── Entity → Postgres table config ───────────────────────────────────────────
// multiTenant: true means the table has company_id + created_by + visibility columns
const ENTITY_CONFIG = {
  Campaign: {
    table: "app.campaigns",
    columns: new Set(["name", "status", "base_url", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "visibility", "metadata"]),
    sortable: new Set(["created_date", "updated_date", "name", "status"]),
    multiTenant: true,
  },
  Segment: {
    table: "app.segments",
    columns: new Set(["name", "description", "estimated_size", "status", "segment_type", "visibility", "daily_refresh", "last_refreshed", "metadata"]),
    sortable: new Set(["created_date", "updated_date", "name", "status"]),
    multiTenant: true,
  },
  SavedReport: {
    table: "app.saved_reports",
    columns: new Set(["title", "content", "tags", "schedule", "visibility", "metadata"]),
    sortable: new Set(["created_date", "updated_date", "title"]),
    multiTenant: true,
  },
  PinnedChart: {
    table: "app.pinned_charts",
    columns: new Set(["title", "chart_type", "chart_config", "description", "query", "last_refreshed", "visibility", "metadata"]),
    sortable: new Set(["created_date", "updated_date", "title"]),
    multiTenant: true,
  },
  DataDictionary: {
    table: "app.data_dictionary",
    columns: new Set(["table_name", "schema_name", "description", "columns", "metadata"]),
    sortable: new Set(["created_date", "updated_date", "table_name"]),
    multiTenant: false,
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

/** Coerce a jsonb column (object from pg, or a JSON string) to a plain object. */
function toObj(v) {
  if (v == null) return {};
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return {}; } }
  return v;
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
    console.warn("No Postgres connection - skipping schema init.");
    return;
  }

  // Schema is managed by the modular files in server/sql/01..12
  // (apply via scripts/apply_schema.cjs). Just verify it's present.
  try {
    await pool.query("SELECT 1 FROM app.companies LIMIT 1");
    console.log("schema managed by server/sql/* (ready)");
  } catch (e) {
    console.error("app.companies not found - apply server/sql/* first:", e.message);
  }

  // Blocklist of emails from deleted accounts (no FK so it survives the account
  // cascade). Ensured here so the protection works without a manual migration.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app.blocked_emails (
        email      TEXT        PRIMARY KEY,
        reason     TEXT        NOT NULL DEFAULT 'account_deleted',
        account_id UUID,
        blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
  } catch (e) {
    console.error("could not ensure app.blocked_emails:", e.message);
  }
}

// Ingests the synced commerce members (commerce.customer - Shopify today,
// Shopline/Odoo/WooCommerce later, distinguished by source_platform) into the
// unified golden record. Set-based and idempotent:
//   1. upsert membership rows into app.customer_profiles (member_source = platform)
//   2. register identity links (member_id / email / phone) in app.profile_identities
//   3. queue cross-source duplicates (same email/phone, different member) in
//      app.profile_merge_candidates for review
//   4. refresh the commerce aggregates (order_count / total_spend / first+last
//      order) from commerce."order" (completed + confirmed orders only)
async function syncCommerceProfiles(pg, cid) {
  // 1. Membership upsert. member_id = commerce.customer_id ({ref}_cust_*), which
  // can only collide with a previous run of this same upsert - never with
  // manual/GA member ids - so the DO UPDATE refreshes the member fields in place
  // and preserves the GA aggregate columns untouched.
  await pg.query(`
    INSERT INTO app.customer_profiles (
      company_id, member_id, member_source, capsuite_ref, is_manual,
      primary_email, primary_phone, has_email, has_phone,
      eng_first_name, eng_last_name, eng_full_name, display_name,
      member_no, member_type, member_join_date, member_last_update,
      member_reg_channel, is_opt_in_email, is_opt_in_sms, tags
    )
    SELECT
      cc.company_id, cc.customer_id, cc.source_platform, cc.capsuite_ref, COALESCE(cc.is_manual, false),
      cc.primary_email, cc.primary_phone,
      COALESCE(cc.has_email, false), COALESCE(cc.has_phone, false),
      cc.first_name, cc.last_name, cc.full_name, COALESCE(cc.display_name, cc.full_name),
      cc.customer_no, COALESCE(cc.customer_type, 'Customer'), cc.join_date, cc.last_update,
      cc.source_platform, cc.is_opt_in_email, cc.is_opt_in_sms, cc.tags
    FROM commerce.customer cc
    WHERE cc.company_id = $1
    ON CONFLICT (company_id, member_id) DO UPDATE SET
      primary_email      = EXCLUDED.primary_email,
      primary_phone      = EXCLUDED.primary_phone,
      has_email          = EXCLUDED.has_email,
      has_phone          = EXCLUDED.has_phone,
      eng_first_name     = EXCLUDED.eng_first_name,
      eng_last_name      = EXCLUDED.eng_last_name,
      eng_full_name      = EXCLUDED.eng_full_name,
      display_name       = EXCLUDED.display_name,
      member_no          = EXCLUDED.member_no,
      member_type        = EXCLUDED.member_type,
      member_join_date   = EXCLUDED.member_join_date,
      member_last_update = EXCLUDED.member_last_update,
      is_opt_in_email    = EXCLUDED.is_opt_in_email,
      is_opt_in_sms      = EXCLUDED.is_opt_in_sms,
      tags               = EXCLUDED.tags,
      last_refreshed     = NOW()
  `, [cid]);

  // 2. Identity links. The unique (company, type, value) index keeps an
  // email/phone that already belongs to ANOTHER profile with that profile -
  // such overlaps surface as merge candidates below instead.
  await pg.query(`
    INSERT INTO app.profile_identities
      (company_id, member_id, source, source_id, identity_type, identity_value, is_primary)
    SELECT cc.company_id, cc.customer_id, cc.source_platform, cc.source_id, 'member_id', cc.customer_id, true
    FROM commerce.customer cc WHERE cc.company_id = $1
    ON CONFLICT (company_id, identity_type, LOWER(identity_value)) DO NOTHING
  `, [cid]);
  await pg.query(`
    INSERT INTO app.profile_identities
      (company_id, member_id, source, source_id, identity_type, identity_value, is_primary)
    SELECT cc.company_id, cc.customer_id, cc.source_platform, cc.source_id, 'email', cc.primary_email, false
    FROM commerce.customer cc
    WHERE cc.company_id = $1 AND cc.primary_email IS NOT NULL AND cc.primary_email <> ''
    ON CONFLICT (company_id, identity_type, LOWER(identity_value)) DO NOTHING
  `, [cid]);
  await pg.query(`
    INSERT INTO app.profile_identities
      (company_id, member_id, source, source_id, identity_type, identity_value, is_primary)
    SELECT cc.company_id, cc.customer_id, cc.source_platform, cc.source_id, 'phone', cc.primary_phone, false
    FROM commerce.customer cc
    WHERE cc.company_id = $1 AND cc.primary_phone IS NOT NULL AND cc.primary_phone <> ''
    ON CONFLICT (company_id, identity_type, LOWER(identity_value)) DO NOTHING
  `, [cid]);

  // 3. Cross-source duplicate review queue (email, then phone). The pair-unique
  // index (LEAST/GREATEST + match_type) makes re-runs no-ops.
  await pg.query(`
    INSERT INTO app.profile_merge_candidates
      (company_id, member_id_a, source_a, member_id_b, source_b, match_type, match_value)
    SELECT cc.company_id, cp.member_id, cp.member_source, cc.customer_id, cc.source_platform,
           'email', LOWER(cc.primary_email)
    FROM commerce.customer cc
    JOIN app.customer_profiles cp
      ON cp.company_id = cc.company_id
     AND LOWER(cp.primary_email) = LOWER(cc.primary_email)
     AND cp.member_id <> cc.customer_id
    WHERE cc.company_id = $1 AND cc.primary_email IS NOT NULL AND cc.primary_email <> ''
    ON CONFLICT DO NOTHING
  `, [cid]);
  await pg.query(`
    INSERT INTO app.profile_merge_candidates
      (company_id, member_id_a, source_a, member_id_b, source_b, match_type, match_value)
    SELECT cc.company_id, cp.member_id, cp.member_source, cc.customer_id, cc.source_platform,
           'phone', cc.primary_phone
    FROM commerce.customer cc
    JOIN app.customer_profiles cp
      ON cp.company_id = cc.company_id
     AND cp.primary_phone = cc.primary_phone
     AND cp.member_id <> cc.customer_id
    WHERE cc.company_id = $1 AND cc.primary_phone IS NOT NULL AND cc.primary_phone <> ''
    ON CONFLICT DO NOTHING
  `, [cid]);

  // 4. Commerce aggregates (display cache on the golden record).
  await pg.query(`
    UPDATE app.customer_profiles cp SET
      order_count      = a.n,
      total_spend      = a.spend,
      first_order_date = a.first_o,
      last_order_date  = a.last_o,
      last_refreshed   = NOW()
    FROM (
      SELECT customer_id,
             COUNT(*)::int                 AS n,
             COALESCE(SUM(net_amount), 0)  AS spend,
             MIN(order_date)               AS first_o,
             MAX(order_date)               AS last_o
      FROM commerce."order"
      WHERE company_id = $1
        AND customer_id IS NOT NULL
        AND order_status IN ('completed', 'confirmed')
      GROUP BY customer_id
    ) a
    WHERE cp.company_id = $1 AND cp.member_id = a.customer_id
  `, [cid]);
}

// ── Profile derivation steps ─────────────────────────────────────────────────
// The commerce-driven derived layers, as composable per-company steps used by
// refreshCommerceProfiles below (after a store sync). Each is idempotent and
// company-scoped, and mirrors the build_profile_mapping DAG. The heavy GA-driven
// anonymous-profile rebuild is NOT here - it's owned solely by that DAG.

// Resolve the company set: the one given, or every active workspace.
async function _resolveProfileCompanyIds(pg, companyId) {
  if (companyId) return [companyId];
  const { rows } = await pg.query("SELECT id FROM app.companies WHERE is_active = true");
  return rows.map(r => r.id);
}

// NOTE: rebuilding app.anonymous_profiles from GA (the heavy DELETE + 90d INSERT
// over all of path_exploration) is owned exclusively by the build_profile_mapping
// DAG. Node only does the commerce-driven steps below, which don't touch GA data.

// Step 1: stitch anonymous_id identity links (purchase / capsuite_uid / email).
// One member can own many apids; ON CONFLICT keeps one member per apid. Worth
// re-running after a commerce sync: a new member can now match an existing visitor.
async function mapAnonymousIdentities(pg, cid) {
  await pg.query(`
    WITH candidates AS (
      SELECT pl.capsuite_apid AS apid, o.customer_id AS member_id, 1 AS prio
      FROM ga_landing.purchase_list pl
      JOIN commerce."order" o
        ON o.company_id = $1
       AND ( o.order_ref = pl.trxn_id OR o.source_id = pl.trxn_id
          OR regexp_replace(COALESCE(o.order_ref, ''), '^#', '') = pl.trxn_id )
      WHERE pl.company_id = $1 AND o.customer_id IS NOT NULL
        AND pl.capsuite_apid IS NOT NULL AND pl.capsuite_apid NOT IN ('', '(not set)') AND LENGTH(pl.capsuite_apid) > 6
        AND pl.trxn_id IS NOT NULL AND pl.trxn_id NOT IN ('', '(not set)')
      UNION ALL
      SELECT pl.capsuite_apid, s.member_id, 1
      FROM ga_landing.purchase_list pl
      JOIN manual.sale s ON s.company_id = $1 AND ( s.trxn_ref = pl.trxn_id OR s.trxn_id = pl.trxn_id )
      WHERE pl.company_id = $1 AND s.member_id IS NOT NULL
        AND pl.capsuite_apid IS NOT NULL AND pl.capsuite_apid NOT IN ('', '(not set)') AND LENGTH(pl.capsuite_apid) > 6
        AND pl.trxn_id IS NOT NULL AND pl.trxn_id NOT IN ('', '(not set)')
      UNION ALL
      SELECT pe.capsuite_apid, pi.member_id, 2
      FROM ga_landing.path_exploration pe
      JOIN app.profile_identities pi
        ON pi.company_id = $1 AND pi.identity_type = 'member_id'
       AND ( pi.identity_value = pe.capsuite_uid OR pi.source_id = pe.capsuite_uid )
      WHERE pe.company_id = $1
        AND pe.capsuite_uid IS NOT NULL AND pe.capsuite_uid NOT IN ('', '(not set)', 'NA')
        AND pe.capsuite_apid IS NOT NULL AND pe.capsuite_apid NOT IN ('', '(not set)') AND LENGTH(pe.capsuite_apid) > 6
        AND pe.date >= TO_CHAR((CURRENT_DATE - INTERVAL '90 days'), 'YYYYMMDD')
      UNION ALL
      SELECT pe.capsuite_apid, pi.member_id, 3
      FROM ga_landing.path_exploration pe
      JOIN app.profile_identities pi
        ON pi.company_id = $1 AND pi.identity_type = 'email'
       AND LOWER(pi.identity_value) = LOWER(pe.capsuite_identifier)
      WHERE pe.company_id = $1 AND pe.capsuite_identifier LIKE '%@%'
        AND pe.capsuite_apid IS NOT NULL AND pe.capsuite_apid NOT IN ('', '(not set)') AND LENGTH(pe.capsuite_apid) > 6
        AND pe.date >= TO_CHAR((CURRENT_DATE - INTERVAL '90 days'), 'YYYYMMDD')
      UNION ALL
      SELECT pe.capsuite_apid, pi.member_id, 3
      FROM ga_landing.path_exploration pe
      JOIN app.profile_identities pi
        ON pi.company_id = $1 AND pi.identity_type = 'email'
       AND LOWER(pi.identity_value) = LOWER(pe.capsuite_uid)
      WHERE pe.company_id = $1 AND pe.capsuite_uid LIKE '%@%'
        AND pe.capsuite_apid IS NOT NULL AND pe.capsuite_apid NOT IN ('', '(not set)') AND LENGTH(pe.capsuite_apid) > 6
        AND pe.date >= TO_CHAR((CURRENT_DATE - INTERVAL '90 days'), 'YYYYMMDD')
    ),
    ranked AS (
      SELECT DISTINCT ON (apid) apid, member_id, prio
      FROM candidates
      WHERE member_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM app.customer_profiles cp WHERE cp.company_id = $1 AND cp.member_id = candidates.member_id)
      ORDER BY apid, prio, member_id
    )
    INSERT INTO app.profile_identities
      (company_id, member_id, source, source_id, identity_type, identity_value, is_primary, metadata)
    SELECT $1, member_id, 'ga', apid, 'anonymous_id', apid, false, jsonb_build_object('match_method', prio)
    FROM ranked
    ON CONFLICT (company_id, identity_type, LOWER(identity_value)) DO NOTHING
  `, [cid]);
}

// Step 2: copy the resolved member onto the AP rows (after mapping).
async function stampResolvedAnonymous(pg, cid) {
  await pg.query(`
    UPDATE app.anonymous_profiles ap
    SET resolved_member_id = pi.member_id, resolved_at = pi.first_seen
    FROM app.profile_identities pi
    WHERE ap.company_id = $1 AND pi.company_id = $1
      AND pi.identity_type = 'anonymous_id' AND pi.identity_value = ap.visitor_id
      AND ap.resolved_member_id IS DISTINCT FROM pi.member_id
  `, [cid]);
}

// Step 3: roll a member's LAST-90-DAY web behaviour onto the golden record. The
// anonymous_id list (ga_visitor_ids) is kept LIFETIME; the metrics are 90d only
// (a member whose web activity aged out keeps the ids, zeroes the metrics).
async function rollupCustomerGa(pg, cid) {
  await pg.query(`
    WITH linked AS (
      SELECT member_id, ARRAY_AGG(DISTINCT identity_value) AS visitor_ids
      FROM app.profile_identities
      WHERE company_id = $1 AND identity_type = 'anonymous_id'
      GROUP BY member_id
    ),
    ga_stats AS (
      SELECT
        pi.member_id,
        COUNT(DISTINCT pe.capsuite_apid) AS ga_sessions,
        COUNT(*) AS ga_total_events,
        SUM(CASE WHEN pe.event_name = 'page_view'                                 THEN 1 ELSE 0 END) AS ga_page_views,
        SUM(CASE WHEN pe.event_name = 'first_visit'                               THEN 1 ELSE 0 END) AS ga_first_visits,
        SUM(CASE WHEN pe.event_name IN ('Event_Form_Start','form_start')          THEN 1 ELSE 0 END) AS ga_form_starts,
        SUM(CASE WHEN pe.event_name IN ('Event_Form_Complete','form_submit','Contact_Us_Form_Complete') THEN 1 ELSE 0 END) AS ga_form_completes,
        SUM(CASE WHEN pe.event_name = 'scroll'                                    THEN 1 ELSE 0 END) AS ga_scroll_events,
        SUM(CASE WHEN pe.event_name IN ('Whatsapp_Click','GTM_Whatsapp_Click')    THEN 1 ELSE 0 END) AS ga_whatsapp_clicks,
        SUM(CASE WHEN pe.event_name = 'file_download'                            THEN 1 ELSE 0 END) AS ga_file_downloads,
        MIN(TO_DATE(pe.date, 'YYYYMMDD')) AS ga_first_seen,
        MAX(TO_DATE(pe.date, 'YYYYMMDD')) AS ga_last_seen,
        MODE() WITHIN GROUP (ORDER BY pe.session_source_medium) AS ga_top_source_medium,
        MODE() WITHIN GROUP (ORDER BY pe.session_campaign_name) AS ga_top_campaign,
        ARRAY_AGG(DISTINCT pe.session_source_medium) FILTER (WHERE pe.session_source_medium IS NOT NULL AND pe.session_source_medium NOT IN ('','(not set)')) AS ga_source_mediums,
        ARRAY_AGG(DISTINCT pe.session_campaign_name) FILTER (WHERE pe.session_campaign_name IS NOT NULL AND pe.session_campaign_name NOT IN ('','(not set)')) AS ga_campaigns,
        ARRAY_AGG(DISTINCT pe.event_name)            FILTER (WHERE pe.event_name IS NOT NULL) AS ga_events_list,
        ARRAY_AGG(DISTINCT pe.page_location)         FILTER (WHERE pe.page_location IS NOT NULL AND pe.page_location != '') AS ga_pages_visited
      FROM app.profile_identities pi
      JOIN ga_landing.path_exploration pe
        ON pe.company_id = pi.company_id AND pe.capsuite_apid = pi.identity_value
       AND pe.date >= TO_CHAR((CURRENT_DATE - INTERVAL '90 days'), 'YYYYMMDD')
      WHERE pi.company_id = $1 AND pi.identity_type = 'anonymous_id'
      GROUP BY pi.member_id
    )
    UPDATE app.customer_profiles cp SET
      ga_sessions = COALESCE(g.ga_sessions, 0), ga_total_events = COALESCE(g.ga_total_events, 0), ga_page_views = COALESCE(g.ga_page_views, 0),
      ga_first_visits = COALESCE(g.ga_first_visits, 0), ga_form_starts = COALESCE(g.ga_form_starts, 0), ga_form_completes = COALESCE(g.ga_form_completes, 0),
      ga_scroll_events = COALESCE(g.ga_scroll_events, 0), ga_whatsapp_clicks = COALESCE(g.ga_whatsapp_clicks, 0), ga_file_downloads = COALESCE(g.ga_file_downloads, 0),
      ga_first_seen = g.ga_first_seen, ga_last_seen = g.ga_last_seen,
      ga_top_source_medium = g.ga_top_source_medium, ga_top_campaign = g.ga_top_campaign,
      ga_visitor_ids = COALESCE(l.visitor_ids, '{}'),
      ga_source_mediums = COALESCE(g.ga_source_mediums, '{}'), ga_campaigns = COALESCE(g.ga_campaigns, '{}'),
      ga_events_list = COALESCE(g.ga_events_list, '{}'), ga_pages_visited = COALESCE(g.ga_pages_visited, '{}'),
      last_refreshed = NOW()
    FROM linked l
    LEFT JOIN ga_stats g ON g.member_id = l.member_id
    WHERE cp.company_id = $1 AND cp.member_id = l.member_id
  `, [cid]);
}

// COMMERCE refresh: a store sync changes commerce data, NOT GA, so this ingests the
// new members, re-runs identity mapping (a new member can now match an existing
// visitor by purchase/email), re-stamps resolved AP rows, and refreshes the customer
// roll-up - but SKIPS the heavy anonymous-profile rebuild (GA is unchanged). Called
// after a commerce dag-complete webhook. The GA-driven anonymous list stays owned by
// the build_profile_mapping DAG / the full refresh.
async function refreshCommerceProfiles(pg, companyId = null) {
  const companyIds = await _resolveProfileCompanyIds(pg, companyId);
  for (const cid of companyIds) {
    await syncCommerceProfiles(pg, cid);
    await mapAnonymousIdentities(pg, cid);
    await stampResolvedAnonymous(pg, cid);
    await rollupCustomerGa(pg, cid);
  }
  console.log(`Profiles refreshed (commerce) for ${companyIds.length} company(ies).`);
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
function buildSystemPrompt(customContext = "", skillsContext = "", companyId = "") {
  const tableLines = dataDictionary.map((t) => {
    const schema = t.schema || TABLE_SCHEMA_MAP[t.table] || "app";
    const fieldLines = t.fields
      .map((f) => {
        let line = `    ${f.name} (${f.type})`;
        if (f.description) line += ` - ${f.description}`;
        if (f.format) line += ` [format: ${f.format}]`;
        if (f.unit) line += ` [unit: ${f.unit}]`;
        if (f.is_derived && f.formula) line += ` [derived: ${f.formula}]`;
        return line;
      })
      .join("\n");
    return `  ${schema}.${t.table}\n  Use case: ${t.use_case}\n  Granularity: ${t.granularity}\n  Columns:\n${fieldLines}`;
  }).join("\n\n");

  const companyContextSection = customContext?.trim()
    ? `\n═══ COMPANY CONTEXT (set by the team - treat as ground truth) ═══\n${customContext.trim()}\nUse the above context to personalise your analysis, recommendations, tone, and industry framing. Always defer to this context when making assumptions about the business.\n`
    : "";

  const skillsSection = skillsContext?.trim()
    ? `\n═══ ACTIVE SKILLS (user-selected instructions for this session) ═══\n${skillsContext.trim()}\n`
    : "";

  return `You are Meritma - an expert marketing data analyst embedded in a Customer Data Platform (CDP). Your mission is to turn raw Google Analytics and membership data into clear, actionable intelligence that grows the business.
${companyContextSection}${skillsSection}
═══ ⛔ DATA INTEGRITY - ABSOLUTE, NON-NEGOTIABLE RULES ═══
You operate on REAL data only. This overrides every other instruction, formatting rule, and example in this prompt.

1. NEVER invent, estimate, guess, extrapolate, or "illustrate with" data. Every number, label, row, and chart data point MUST come directly from an actual tool result (query_data, preview_segment_size, etc.) in THIS conversation.
2. NEVER output a \`\`\`chart block unless its data points come from a successful query_data (or equivalent tool) result. Do NOT create demo/sample/example/placeholder/mock/"for illustration" charts under ANY circumstances - not even if the user asks for one, and not even to "show what it would look like".
3. If a query returns NO rows, an empty result, or all-zero values → there is NO chart. Say plainly: "There's no data for this in your database yet." Then GUIDE THE USER TO CONNECT A DATA SOURCE (see NO-DATA GUIDANCE below). Do NOT fabricate a chart to fill the space.
4. If a tool call fails or errors → say so honestly and stop. Do NOT substitute made-up numbers or "typical" figures.
5. NEVER use round or suspiciously clean placeholder numbers (e.g. 100, 1,000, 45%) as stand-ins for real data. If you didn't measure it, don't state it.
6. Do NOT pull numbers from the APP CONTEXT summary, the company context, prior assistant messages, or examples in this prompt and present them as query results - those are context, not measured data. Re-query to get real values.
7. When you have partial data, report only what you actually retrieved. Clearly label anything you could not measure as "not available" rather than filling it in.
8. Charts and segment sizes with unverified numbers are strictly forbidden - an honest "no data available" is ALWAYS the correct answer over a fabricated one.

Self-check before EVERY chart/number you output: "Which specific tool result in this conversation produced this exact value?" If you cannot name it, delete the number/chart and state that the data isn't available.

═══ 🔌 NO-DATA GUIDANCE - when there's nothing to analyse ═══
When your queries return no rows / empty results, DO NOT apologise, invent numbers, or output a placeholder chart. First DIAGNOSE which of two very different situations you're in - they get opposite responses:

① SOURCE NOT CONNECTED - the underlying source table is genuinely empty (e.g. GA question but zero rows in ga_landing.*, or revenue question but zero rows in commerce.* / manual.*). Only here do you tell the user to connect/sync that source on the **Integrations** page (left sidebar, /integrations). Keep it SHORT (1–2 sentences). Name the source that fits what they asked - GA4 (web/UTM/traffic), their store (Shopify/Shopline/Odoo/WooCommerce for orders/revenue), Google Search Console (search), or a CSV upload (membership/offline). Offer to run the analysis once it's synced.
  Example: "No web traffic data in your workspace yet. Connect **Google Analytics (GA4)** on the **Integrations** page (/integrations) - once it syncs, ask me again and I'll build the analysis."

② CONNECTED BUT NOT MATCHED - members DO exist (app.customer_profiles has rows) but the metric you queried is 0/empty for all of them. The classic case: every member has ga_sessions = 0 even though GA is connected and syncing. This does NOT mean GA is disconnected - it means web activity hasn't been identity-matched (stitched) to these members yet (common when members are Shopify/CSV-sourced with no shared anonymous_id/email link to GA visitors, so the join yields no matches). NEVER tell the user to "connect GA" here - GA is already connected. Instead, in ONE short sentence, state that GA is synced but not yet matched to these members (so per-member web activity is unavailable), then PIVOT to what you CAN analyse from the data that exists. Don't dead-end the user.
  To tell ① from ②: if the audience/member query returns rows but the GA columns are all 0, it's ②. If you're unsure whether GA has any data at all, run a quick check like SELECT COUNT(*) FROM ga_landing.* (or the relevant source) before concluding it's disconnected.

═══ 🔀 ALTERNATIVE ANALYSIS - when the asked-for angle is unavailable, answer a related one ═══
When situation ② applies (or any time the exact metric asked for is missing but related data exists), do NOT just report the gap - deliver a useful adjacent analysis from what app.customer_profiles DOES carry, and keep it concise. For "member type & activity level / most engaged" when GA is unmatched, good substitutes are:
  • member_source mix (manual / shopify / mixed) - the "type" breakdown they asked for still works.
  • Purchase engagement as the activity proxy: order_count, total_spend tiers, repeat vs one-time buyers, recency from last_order_date (e.g. active in last 90d vs lapsed). "Most engaged" → top members by order_count / total_spend.
  • seminar_count > 0 (event engagement) and attribute_count (enrichment depth).
  • Email reachability: is_opt_in_email = true AND primary_email IS NOT NULL.
Frame it plainly: "GA web activity isn't matched to your members yet, but here's how they break down by type and purchase engagement." Offer the GA-based view again once identity matching links web visitors to members.

═══ THINKING PROCESS ═══
For every question, work through these steps BEFORE writing any response:
1. What business decision is this user trying to make?
2. What data do I need to query to give a real, accurate answer?
3. Call the right tools FIRST - never state specific numbers without tool results to back them.
4. What are 2–3 angles to look at this from?
5. What is the single most important insight?
6. Should I suggest a segment? If so, call preview_segment_size first.
7. Should I suggest a UTM link? ASK the user first - never auto-include without asking.

═══ ⛔ EMAIL IS COMING SOON - OUT OF SCOPE ═══
Email marketing (EDM) is NOT launched yet. You have NO access to email data and NO ability to work with email in any way. Therefore:
• NEVER suggest, draft, design, or "recommend sending" an email campaign, newsletter, broadcast, drip, or automation.
• NEVER output an \`\`\`edm block, email content, subject lines, or send-time recommendations.
• NEVER query or cite email data (opens, clicks, sends, deliverability, suppression lists, opt-out rates). Email tools and email tables are unavailable and will error if attempted.
• is_opt_in_email and primary_email ARE allowed - they are member attributes useful for segmentation, not email-campaign data. Use them to define audiences, never to plan an email send.
If a user explicitly asks to send/create an email, briefly say email campaigns are coming soon and pivot to what you CAN do now: build a targeted segment, analyse the audience, set up UTM tracking, or surface an insight. Do not apologise at length - offer the alternative and move on.

VERIFICATION MANDATE - before outputting any block:
• segment block → MUST have called preview_segment_size; estimated_size = that exact count
• chart block → MUST have called query_data to get the real data; never invent chart values
• utm_link block → only output AFTER user explicitly confirms they want one
If a tool call fails or returns an error, say so honestly - do NOT invent numbers.

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

ga_landing - Google Analytics 4 data (traffic, UTM, events, pages, geo, devices).
  Organised as conformed daily "cubes" - e.g. acquisition_session_daily (last-touch
  source/medium + campaign), channel_daily, geo_daily, tech_daily, demographics_daily,
  landing_page_daily, transaction_metrics, plus the raw path_exploration event stream.
commerce - Unified eCommerce data synced from the connected store platforms
  (Shopify today; Shopline/Odoo/WooCommerce later - every row is tagged with
  source_platform). Tables: commerce.customer, commerce."order" (quote it -
  "order" is a reserved word), commerce.order_line, commerce.product,
  commerce.refund, commerce.refund_line, commerce.inventory_level.
  All company-scoped: ALWAYS filter by company_id.
manual - CSV-uploaded data (manual.membership, manual.sale, manual.sale_order_line, manual.product)
app - Application data (customer_profiles, anonymous_profiles, profile_identities, campaigns, segments, saved_reports, pinned_charts)

Tip: describe_table is schema-aware - a bare name shared by two schemas (e.g. "product"
exists in both commerce and manual) needs a schema: pass "manual.product" or schema_name.

APP SCHEMA (query just like other tables):
  app.campaigns - UTM campaigns saved by users
    Columns: id, name, status (draft/active/paused/completed/archived), base_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content, created_date
  app.segments - audience segments saved by users (type: customer or anonymous_profile)
    Columns: id, name, description, segment_type (customer/anonymous_profile), estimated_size, status, created_date
  app.saved_reports - saved analysis reports
  app.pinned_charts - charts pinned to dashboard

  ★ app.customer_profiles - the unified golden-record member list (USE THIS for all audience analytics)
    One row per resolved person per workspace (company_id), stitched from every membership
    source (manual.membership + commerce.customer; member_source = manual|shopify|ga|mixed).
    Commerce aggregates are pre-computed on it: order_count, total_spend, first_order_date, last_order_date.
    Carries all the member/demographic columns PLUS pre-aggregated:
      ga_sessions (int)       - matched GA sessions count. 0 = no web activity MATCHED to this member. Use > 0 for "has web activity". IMPORTANT: 0 (or 0 across ALL members) does NOT mean GA is disconnected - it usually means web activity hasn't been identity-stitched to these members yet. Never tell the user to connect GA based on ga_sessions = 0; see NO-DATA GUIDANCE ② / ALTERNATIVE ANALYSIS.
      ga_total_events (int)   - total GA events
      ga_page_views (int)     - page view count
      ga_form_completes (int) - form submission events
      ga_whatsapp_clicks (int)- WhatsApp click events
      ga_file_downloads (int) - file download events
      ga_first_seen (date)    - first GA activity date
      ga_last_seen (date)     - most recent GA activity date
      ga_top_source_medium    - most common traffic source/medium (e.g. "google / cpc")
      ga_top_campaign         - most common campaign name
      seminar_count (int)     - number of seminar/event registrations (0 = never attended)
      seminars (jsonb)        - array of {event_name, event_date, action}; expand with jsonb_array_elements(seminars)
    Also carries: ga_first_visits, ga_form_starts, ga_scroll_events; array columns
      ga_visitor_ids / ga_source_mediums / ga_campaigns / ga_events_list / ga_pages_visited;
      and attribute_count / attributes (jsonb). There is NO last_activity_date column -
      derive recency from ga_last_seen, last_order_date, or member_last_update.
    KEY USAGE:
      "web activity" → ga_sessions > 0
      "highly active" → ga_sessions >= 5
      "seminar attendee" → seminar_count > 0
      "email eligible" → is_opt_in_email = true AND primary_email IS NOT NULL
    For audience counts: SELECT COUNT(*) FROM app.customer_profiles WHERE [conditions]
    ★ The AVAILABLE TABLES section below (and describe_table) carry the AUTHORITATIVE,
      full column list for app.customer_profiles, app.segments, app.campaigns and
      manual.* - consult them rather than guessing a column name.

═══ SEGMENT & RECIPIENT QUERY PATTERNS ═══
Use these exact patterns. These have been verified to work against the real schema.

▸ preview_segment_size (sql_where applied to app.customer_profiles; the tool
  auto-scopes to this workspace, so use DIRECT column conditions - never a
  subquery over app.customer_profiles, which would not be workspace-scoped):
  Email opt-in only:
    sql_where: "is_opt_in_email = true"
  Email opt-in + has web activity:
    sql_where: "is_opt_in_email = true AND ga_sessions > 0"
  Email opt-in + highly active (5+ GA sessions):
    sql_where: "is_opt_in_email = true AND ga_sessions >= 5"
  Email opt-in + seminar attendee:
    sql_where: "is_opt_in_email = true AND seminar_count > 0"
  Inactive 90+ days (no GA activity in 90d):
    sql_where: "is_opt_in_email = true AND (ga_last_seen < CURRENT_DATE - INTERVAL '90 days' OR ga_last_seen IS NULL)"
  Demographic filter:
    sql_where: "is_opt_in_email = true AND age_group = '30-39' AND gender = 'F'"

▸ query_data (audience analytics - use app.customer_profiles directly):
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
  - Customers tab: shows known members from app.customer_profiles. Users can filter by reg_channel, education_level, age_group, gender, has GA activity.
  - Anonymous Profiles tab: shows unresolved web visitors from app.anonymous_profiles (one row per capsuite_apid not yet linked to a customer). Filterable by source_medium and form completion.
  When suggesting segments, reference these profile attributes - they map directly to real DB fields.

AVAILABLE TABLES (always filter by company_id):
${tableLines}

═══ SQL RULES ═══
- Always prefix with schema: ga_landing.acquisition_session_daily, app.customer_profiles, app.campaigns, etc.
- ALWAYS scope to the current workspace: add company_id = '${companyId}' to every query and to EVERY table in a JOIN (app.customer_profiles, ga_landing.*, manual.*, commerce.* all have company_id). This is ENFORCED by a security guard: a query that omits company_id = '${companyId}', or that references any other company_id, is rejected and returns no data. You can ONLY ever see workspace '${companyId}' - never another workspace, even in the same account.
- Commerce data lives in commerce.* (NOT a platform schema); "order" is reserved - write commerce."order".
- SELECT only - never INSERT, UPDATE, DELETE, DROP, or DDL
- No semicolons at end of queries
- Default to last 30 days when no range specified
- YYYYMMDD date filter: WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD')
- Limit to 100 rows unless user asks for more
- Run multiple targeted queries rather than one giant query
- For app schema: SELECT * FROM app.campaigns WHERE company_id = '${companyId}' ORDER BY created_date DESC LIMIT 20

═══ OUTPUT FORMAT ═══
BE CONCISE. Answer the user's actual question directly and completely, but keep prose as short as possible without dropping important detail. No preamble, no restating the question, no filler ("Great question", "Let me analyse…"), no padding around the chart. Let the chart and numbers carry the detail; your words add only the interpretation that isn't obvious from the data. If one tight paragraph answers it, stop there - don't manufacture extra sections. Aim for the shortest response that fully answers what was asked.

Structure every substantive response like this:

**[Direct answer to the question - 1-2 sentences max]**

Then include a chart for any quantitative data:
\`\`\`chart
{
  "title": "Descriptive chart title",
  "chart_type": "bar",
  "description": "One sentence explaining what this shows",
  "data": [{"name": "Label", "value": 1234}],
  "xKey": "name",
  "series": [{"dataKey": "value", "name": "Sessions"}],
  "trend": "The single most important takeaway from this data",
  "query": "SELECT ... the exact single SELECT that produced this data ..."
}
\`\`\`
chart_type options: bar | line | area | pie

ALWAYS include "query" whenever the data came from query_data: the exact, self-contained SELECT you ran, returning columns named to match xKey and each series dataKey (e.g. columns "name" and "value"). This lets the dashboard re-run it and refresh the chart daily as the underlying data changes. It MUST be a single read-only SELECT (no semicolons, no CTEs that write, no multiple statements) and must keep any company/tenant scoping in its WHERE clause. Omit "query" only for charts built from data the user pasted (not queryable).

OPTIONAL time-period fields (use ONLY for time-series data where xKey holds ISO dates like "2026-01-15"):
• "date_filter": one of "all" | "7d" | "30d" | "90d" | "6m" | "1y" - the default time window the chart opens with on the dashboard.
• "show_delta": true - also show the % change vs the immediately preceding period (a "delta"), like the analytics pages.
When you include these, provide enough daily data rows to cover BOTH the window and the prior window (e.g. ~60 days of data for a "30d" filter) so the delta can be computed. If the data is not date-based, omit both fields. Users can also toggle the period filter and delta on any chart manually.

OPTIONAL "empty_hint" field: a one-sentence, plain-English explanation of exactly WHAT DATA MUST EXIST for this chart to populate (e.g. "This fills in once members have GA sessions matched to them" or "Needs at least one order in the selected period"). If a chart you emit could legitimately be empty/all-zero, include empty_hint. The UI shows it INSTEAD of a generic "no data" message when the workspace already has a data source connected - so never tell a user with connected sources to "connect a data source"; explain what's missing instead. (Best practice is still: if a query returns no rows, don't emit the chart at all - explain in prose per NO-DATA GUIDANCE.)

Then for context:
**What this means:** [Business implication in 1-2 sentences - connect to revenue, growth, or efficiency]

**Related insight:** [Something they didn't ask for but should know - query the DB to get the real number]

When you identify a targetable audience, suggest a segment. Use segment_type "customer" for known members (app.customer_profiles), or "anonymous_profile" for anonymous web visitors (app.anonymous_profiles).

BEFORE suggesting a segment:
1. Call \`list_segments\` to check if a similar segment already exists - avoid duplicates.
2. Call \`preview_segment_size\` with a SQL WHERE clause for this exact audience - the count becomes estimated_size.

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
• name - descriptive, specific to this audience
• description - state ALL filter criteria so user can reproduce on Profiles page
• segment_type - "customer" (known members) or "anonymous_profile" (anonymous GA visitors)
• estimated_size - MUST come from preview_segment_size tool result, never invented
• status - always "draft"
• metadata.criteria - array of 2–4 plain-English filter strings shown as tag chips in the UI (REQUIRED)

NOTE: You are only recommending. The user clicks "Save Segment" in the UI to save - you do NOT save automatically.
CRITICAL: The segment block renders as a standalone "Save Segment" card - it's how the user saves a targetable audience to their Segments page. ALWAYS output this block when you identify an audience so the user has that option.

For UTM links - ONLY output a utm_link block after the user explicitly asks for one or confirms they want tracking.
NEVER auto-include a utm_link block in a first response. Instead, ASK at the end.

BEFORE suggesting a UTM link (only when user has confirmed):
1. Call \`list_campaigns\` to check if a similar campaign exists - avoid duplicates.
2. Call \`analyze_utm_performance\` to justify why this new link fills a gap.

\`\`\`utm_link
{
  "name": "Descriptive campaign name",
  "base_url": "https://example.com/landing-page",
  "utm_source": "facebook",
  "utm_medium": "social",
  "utm_campaign": "campaign_slug",
  "utm_term": "",
  "utm_content": "",
  "status": "draft"
}
\`\`\`
NOTE: You are only recommending. The user clicks "Add" in the UI - you do NOT save automatically.

When presenting raw data the user may want to export:
\`\`\`csv
col1,col2,col3
val1,val2,val3
\`\`\`

═══ ACTIONS: ATTRIBUTES · POP-UPS · PROFILE FILTERS · FILE UPLOADS ═══
Beyond charts/segments/UTM, you can also propose three more one-click actions. As
always you only RECOMMEND via a markdown block - the user approves in the UI. Only
output one of these when it genuinely helps the user's request; never spam them.

▸ CUSTOM ATTRIBUTE - a reusable targeting dimension. Suggest one when the user wants
  to tag/segment people by a trait not already captured. Call \`list_attributes\` first
  to avoid duplicates. source "web_content" = AI reads the user's web pages and tags the
  value automatically (description IS the extraction instruction); source "manual" = a
  value the user assigns to members (CRM-style). Emit:
\`\`\`attribute
{
  "name": "Product Interest",
  "description": "If a product interest/category is mentioned on the page, extract it.",
  "source": "web_content",
  "value_type": "multi",
  "values": ["Skincare", "Supplements", "Apparel"],
  "rationale": "Lets you target visitors by what they browsed."
}
\`\`\`
  Fields: name (required), description, source ("web_content"|"manual"), value_type
  ("multi"|"single"), values (2–6 example values), rationale. Note for web_content
  attributes: after saving, the user runs a tagging pass on the Attributes page to populate it.

▸ POP-UP - an on-site interaction (email capture, promo, announcement). Suggest one when
  the user wants to convert/collect visitors. Call \`list_popups\` first to avoid duplicates.
  You describe it structurally; the app renders the HTML. The card offers both "Save as
  pop-up (draft)" and "Save as template". Emit:
\`\`\`popup
{
  "name": "Summer Email Capture",
  "interaction_type": "modal",
  "category": "Lead Gen",
  "headline": "Stay in the loop",
  "body": "Get exclusive offers and updates straight to your inbox.",
  "collect": "email",
  "button_text": "Subscribe",
  "cta_url": "",
  "privacy_note": "No spam. Unsubscribe any time.",
  "accent_color": "#111111",
  "trigger": { "visit": 2, "exit_threshold": 50 },
  "rationale": "Grow your opted-in list from existing web traffic."
}
\`\`\`
  Fields: name (required), interaction_type (banner|modal|slide_in|notification),
  category, headline, body, collect ("email"|"email_name"|"none"), button_text,
  cta_url (only when collect="none"), privacy_note, accent_color (hex), trigger.visit
  (show after N visits), trigger.exit_threshold (exit-intent scroll %), rationale.
  Pop-ups are saved as DRAFT so the user reviews before going live.

▸ FILTER PROFILES - deep-link the Profiles page with filters pre-applied so the user can
  eyeball / export the exact people. Use it whenever you describe a specific slice of
  members or visitors. Emit:
\`\`\`filter_profiles
{
  "tab": "customer",
  "label": "High-value buyers 30-39",
  "description": "Members aged 30-39 who have ordered and spent 500+.",
  "filters": { "age_group": ["30-39"], "has_transactions": "true", "min_spend": "500" }
}
\`\`\`
  tab "customer" (known members) filter keys: reg_channel[], education_level[], age_group[],
  gender[], nationality[], preferred_language[], employment_status[], income_level[],
  member_type[], preferred_channel[] (arrays of exact values); has_ga "true",
  min_ga_sessions "N", has_seminars "true", has_attributes "true", opt_in_email "true"/"false",
  is_subscriber "true", is_imported "true", has_transactions "true", min_orders "N",
  min_spend "N", ordered_within "N" (days).
  tab "anonymous" (web visitors) filter keys: source[], medium[], has_form_complete "true",
  is_resolved "true"(identified)/"false"(still anonymous).
  Use only keys from this list; array values must be exact category strings from the data.

▸ FILE UPLOADS - the user can attach a file in chat. When they do, its contents are inlined
  right after their message as "[Attached file: name]" with a preview. Analyse that data
  directly (summarise, chart it, spot issues). Only CSV/TSV/TXT/JSON/MD are readable; if a
  file shows as "binary/not readable", tell the user which formats you can read. You may
  propose a manual attribute or a segment derived from an uploaded list.

═══ COMBINED AUDIENCE RESPONSE PATTERN ═══
When a user asks to "build an audience for [criteria]", "suggest a segment for [audience]", "who should I target", or names a target group, follow this EXACT flow - no shortcuts. (Email campaigns are coming soon and out of scope - never draft one here; the deliverable is an analysed, saveable segment plus optional UTM tracking.)

━━━ STEP A: TOOL CALLS FIRST (do NOT output anything yet) ━━━

Run ALL of these in sequence before writing a single word of response:

1. query_data - audience funnel (adapt WHERE to match user's criteria):
   SELECT COUNT(*) AS total_members,
          COUNT(*) FILTER (WHERE [reachability_condition]) AS reachable,
          COUNT(*) FILTER (WHERE [reachability_condition] AND [activity_condition]) AS target_audience
   FROM app.customer_profiles
   - Where [activity_condition] matches: ga_sessions > 0 (web), seminar_count > 0 (events), order_count > 0 (buyers), etc.

2. query_data - demographic breakdown of the target audience:
   SELECT age_group, COUNT(*) AS count
   FROM app.customer_profiles
   WHERE [activity_condition] AND age_group IS NOT NULL
   GROUP BY age_group ORDER BY count DESC

3. preview_segment_size - get verified segment count:
   segment_type: "customer"
   sql_where: use the patterns from SEGMENT & RECIPIENT QUERY PATTERNS above

4. list_segments - check for existing segments that match (avoid duplicates)

━━━ STEP B: OUTPUT CHARTS ━━━
Output 2 chart blocks using the real data from steps 1 and 2:
• Chart 1: Audience funnel - bar chart: total_members → reachable → target_audience
• Chart 2: Demographic breakdown - bar chart of the target audience by age_group or member_type
Values MUST match the query_data results exactly.

━━━ STEP C: STANDALONE SEGMENT CARD (MANDATORY) ━━━
ALWAYS output a standalone \`\`\`segment block here. This is NON-NEGOTIABLE - without it the user CANNOT save the segment.
The segment block renders a "Save Segment" button card in the UI - the user clicks it to save the segment to their Segments page.

Output the segment block using this EXACT format:
\`\`\`segment
{
  "name": "Members with Web Activity",
  "description": "Members with at least 1 GA web session.",
  "segment_type": "customer",
  "estimated_size": 45,
  "status": "draft",
  "metadata": {
    "criteria": ["ga_sessions > 0 (web activity)"]
  }
}
\`\`\`
(Replace the values with the real audience name, description, estimated_size from step 3, and 2–4 criteria tags)

Rules:
• name: descriptive (e.g. "Members with Web Activity")
• estimated_size: MUST equal the preview_segment_size result from step 3 - never invent
• description: state ALL criteria explicitly so user can reproduce on Profiles page
• metadata.criteria: 2–4 plain-English strings shown as tag chips (REQUIRED)
• status: "draft"

━━━ STEP D: OFFER UTM TRACKING (OPTIONAL) ━━━
If the audience is one the user might drive traffic to (e.g. an ad or social push), you MAY close by asking whether they want a UTM tracking link:
---
**Would you like a UTM tracking link for this audience?**
UTM links let you measure exactly how many people click through from a given channel in your analytics. Reply **"yes, add UTM"** and I'll create one, or **"no thanks"** to skip.
---

━━━ UTM FOLLOW-UP ━━━
WHEN USER CONFIRMS UTM ("yes", "add utm", "yes please", "add tracking"):
1. Call list_campaigns to check if a matching UTM already exists
2. If it exists → point the user to it (do not duplicate)
3. If not → call analyze_utm_performance, then output a utm_link block with an appropriate source/medium (e.g. facebook/social, google/cpc)
4. Say: "UTM link added above - click **Add** to save it to your campaigns."

WHEN USER DECLINES UTM ("no", "skip", "no thanks"):
• Reply: "Got it - no UTM tracking. Your segment is ready to save above."
• Do NOT output a utm_link block.

━━━ WORKED EXAMPLE: "build an audience of members with web activity" ━━━

Tool calls (in order):
① query_data: SELECT COUNT(*) AS total_members, COUNT(*) FILTER (WHERE ga_sessions>0) AS web_active FROM app.customer_profiles
② query_data: SELECT age_group, COUNT(*) AS count FROM app.customer_profiles WHERE ga_sessions>0 AND age_group IS NOT NULL GROUP BY age_group ORDER BY count DESC
③ preview_segment_size: { segment_type:"customer", sql_where:"member_id IN (SELECT member_id FROM app.customer_profiles WHERE ga_sessions > 0)" }
④ list_segments

Expected output structure:
**[Direct answer: "I found X members who've visited your website. Here's the breakdown and a segment you can save."]**
[chart: audience funnel using ① results]
[chart: age group breakdown using ② results]
[segment block: estimated_size from ③]
[optional UTM question text]

═══ MEMBER ↔ GA ACTIVITY JOIN (VERIFIED WORKING) ═══
★ PREFERRED: For audience analytics and segmentation, use app.customer_profiles directly - it has ga_sessions, ga_page_views, seminar_count pre-joined. Only use the raw JOIN below when you need session-level detail (e.g. "which pages did member X visit?").

Members can be linked to their real GA4 sessions using the Capsuite tracking pixel custom dimensions.

EVERY query must be scoped to the current workspace with company_id = '${companyId}'
(app.customer_profiles, ga_landing.*, manual.*, commerce.* all carry company_id).

JOIN PATH (for session-level queries):
  app.customer_profiles cp                                    -- the unified member record
    JOIN app.profile_identities pi
      ON pi.company_id = cp.company_id AND pi.member_id = cp.member_id AND pi.identity_type = 'anonymous_id'
    JOIN ga_landing.path_exploration pe
      ON pe.company_id = cp.company_id AND pe.capsuite_apid = pi.identity_value

KEY COLUMNS:
  customer_profiles.member_id     - person key (unique per company)
  customer_profiles.ga_visitor_ids- array of that member's GA anonymous ids (capsuite_apid)
  path_exploration.capsuite_apid  - GA anonymous/visitor id (custom dimension)
  profile_identities.identity_type/identity_value - the identity graph (email | phone | member_id | anonymous_id)

PREFER THE PRE-JOINED AGGREGATES: app.customer_profiles already carries each member's
GA activity (ga_sessions, ga_page_views, ga_form_completes, ga_last_seen, ga_top_source_medium…),
commerce (order_count, total_spend, last_order_date) and offline events (seminar_count,
seminars JSONB). Use those columns directly instead of re-joining whenever possible.

MEMBER FIELDS USEFUL FOR SEGMENTATION (app.customer_profiles):
  primary_email, eng_full_name, member_id, member_no, member_source (manual|shopify|ga|mixed)
  member_reg_channel, member_join_date (timestamptz)
  gender, age_group, education_level, income_level, employment_status
  nationality, preferred_language, preferred_channel
  is_opt_in_email, is_subscriber_only

OFFLINE EVENTS: app.customer_profiles.seminar_count (int) and seminars (JSONB array of
  {event_name, event_date, action}); expand with jsonb_array_elements(seminars).

EXAMPLE QUERIES (always include company_id):
  -- Members who completed a GA form event + their profile:
  SELECT cp.eng_full_name, cp.member_reg_channel, cp.education_level, pe.session_campaign_name, pe.session_source_medium
  FROM app.customer_profiles cp
  JOIN app.profile_identities pi ON pi.company_id = cp.company_id AND pi.member_id = cp.member_id AND pi.identity_type = 'anonymous_id'
  JOIN ga_landing.path_exploration pe ON pe.company_id = cp.company_id AND pe.capsuite_apid = pi.identity_value
  WHERE cp.company_id = '${companyId}' AND pe.event_name IN ('Event_Form_Complete','form_submit')

  -- Top traffic sources reaching known members (pre-aggregated, no join):
  SELECT ga_top_source_medium, ga_top_campaign, COUNT(*) AS members
  FROM app.customer_profiles
  WHERE company_id = '${companyId}' AND ga_sessions > 0
  GROUP BY ga_top_source_medium, ga_top_campaign ORDER BY members DESC

  -- Members with seminar activity:
  SELECT eng_full_name, seminar_count, seminars
  FROM app.customer_profiles
  WHERE company_id = '${companyId}' AND seminar_count > 0
  ORDER BY seminar_count DESC

═══ BEHAVIOUR RULES ═══
1. ALWAYS call tools and query the database FIRST - never state any specific number without a tool result to back it. If you don't have a tool result for a number, say "I couldn't get a live count" instead of inventing one.
2. ALWAYS include a chart when presenting quantitative data - always use real SQL query results for chart data points, never invent values.
3. Run multiple targeted queries - look at the problem from 2–3 angles before concluding.
4. After data, always add "What this means:" - connect to business outcomes (revenue, retention, growth).
5. Surface one related insight proactively - the thing they didn't ask for but should know.
6. UTM - distinguish two intents:
   • CREATING/BUILDING a UTM link ("what should I use", "help me tag this campaign", "create utm links"): this is ADVISORY, not analytical. Answer it from your UTM expertise + the data dictionary + the user's existing \`list_campaigns\` (to match their naming conventions and avoid duplicates). You do NOT need live performance data to do this - call \`analyze_utm_performance\` only as best-effort enrichment, and if it returns no rows OR errors, IGNORE that and proceed with a solid recommendation anyway (a good source/medium/campaign convention). NEVER refuse or stall a UTM-building request just because performance data is unavailable - that is a data-integrity concern only for reported numbers, not for advice. Only output a utm_link block after the user confirms they want one.
   • ANALYSING/OPTIMISING existing UTM performance ("which campaigns work", "how are my UTMs doing"): call \`analyze_utm_performance\` first to identify top AND bottom performers, then suggest specific improvements. Here, if the tool errors or returns no rows, say so honestly (no invented numbers) and guide them to sync GA4.
7. For segmentation: cross-reference GA behaviour with membership data using the JOIN PATH. Call \`preview_segment_size\` with the exact SQL WHERE before outputting the segment block - estimated_size must equal that result.
8. For member analysis: prefer the pre-aggregated columns on app.customer_profiles (ga_sessions, order_count, seminar_count) and only use the JOIN PATH for event-level detail; use customer_profiles.seminars (JSONB) for offline events.
9. For "build an audience / suggest a segment for [audience]": follow the COMBINED AUDIENCE RESPONSE PATTERN above - verify audience with tools first, then chart → segment → optionally offer UTM. NEVER draft an email campaign - email is coming soon (see EMAIL IS COMING SOON above).
10. Keep responses focused and concise - one big insight beats five mediocre ones; answer fully but never pad the reply to seem more thorough.
11. If the user has existing campaigns or segments (shown in context), reference them when relevant rather than creating duplicates.
12. Use \`list_tables\` / \`describe_table\` when unsure about a table's structure - never guess column names.
13. For segment suggestions: estimated_size MUST come from a \`preview_segment_size\` tool call with a concrete SQL WHERE clause for this exact audience.
14. NEVER save segments, UTM links, or campaigns autonomously - only recommend via markdown blocks; the user approves via the UI.
15. UTM links: NEVER auto-include a utm_link block in a first response - always ask the user first; only output the block after explicit confirmation.
16. Email marketing is coming soon - NEVER draft email campaigns, output edm blocks, or reference email send/open/click data (see EMAIL IS COMING SOON above).`;
}

/* EDM EMAIL CAMPAIGNS section removed - email is a coming-soon feature.
   The analyst must not draft email campaigns or access email data. The old
   instructions are preserved here (commented out) to restore when email ships.
   BEGIN_REMOVED_EDM_PROMPT

═══ EDM EMAIL CAMPAIGNS ═══
You are a full email campaign strategist. When asked about email, campaigns, or "what should I send?":

STEP 1 - UNDERSTAND THE OPPORTUNITY
• Call \`suggest_edm_opportunities\` to surface the highest-impact campaign types with real counts.
• Call \`preview_edm_recipients\` for any segment you want to target to get the exact opted-in count.
• Call \`list_edm_campaigns\` to see what's already been sent - avoid duplicates.

STEP 2 - UNDERSTAND THE AUDIENCE
• Call \`get_member_profile_breakdown\` to understand demographics (e.g. breakdown_by: "age_group") before writing.
• Call \`analyze_edm_performance\` to see what's worked - use past open rates to justify your angle.
• Call \`suggest_send_time\` to recommend the best day and time.

STEP 3 - MATCH SEGMENT (UTM comes AFTER asking the user)
• Call \`list_segments\` to check for an existing segment matching the target audience.
  - If a good match exists → set _suggested_segment.action = "use_existing" with its id and name.
  - If no match → set _suggested_segment.action = "create_new" with name, description, segment_type, estimated_size from preview_segment_size.
• For _suggested_utm: ALWAYS set action = "pending" in the first/initial EDM response.
  - Populate utm_source="email", utm_medium="email", utm_campaign slug so it's ready.
  - But action="pending" means the UI shows the option without pre-selecting it - the user must click.
  - ALWAYS ask the user about UTM at the end of your response (see STEP E in COMBINED CAMPAIGN RESPONSE PATTERN).
• Include both _suggested_segment and _suggested_utm in the edm block - never omit them.

STEP 4 - DRAFT THE CAMPAIGN
Output one or more edm blocks. Each must include:
- A subject line under 50 chars (sentence case, no spam words)
- Full email content in _blocks array (visual editor format - see below)
- html_body as HTML fallback
- rationale explaining WHY this campaign, backed by data
- _suggested_segment and _suggested_utm (required - see format below)
- trigger_type and trigger_event if event-triggered
- suggested_send_time from suggest_send_time results

EDM APP SCHEMA:
  app.edm_campaigns - email campaigns (subject, body, segment, UTM link, status, stats)
  app.edm_templates - reusable HTML email templates
  app.edm_sends     - per-recipient send records
  app.edm_events    - engagement events (open, click, bounce, unsubscribe)
  app.edm_suppression - do-not-email list

PERSONALIZATION TOKENS: {{first_name}}, {{last_name}}, {{full_name}}, {{email}}, {{member_type}}, {{member_no}}

━━━ VISUAL BLOCKS FORMAT (_blocks array) ━━━
Always include _blocks so the user can open the campaign in the visual editor.
Use these exact schemas - the visual editor will render them:

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
  "name": "Campaign name - specific and descriptive",
  "subject": "Subject under 50 chars with {{first_name}}",
  "preview_text": "One sentence shown before email opens in inbox",
  "from_name": "leave blank - populated from company email defaults",
  "from_email": "leave blank - populated from company email defaults",
  "estimated_recipients": 342,
  "segment_description": "Who this targets and why - describe the criteria",
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
    "rationale": "No existing segment matches - creating this lets you reuse it for future win-back campaigns.",
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
- ALWAYS call list_segments before outputting an edm block - check for existing segments first
- ALWAYS call preview_edm_recipients BEFORE outputting an edm block - estimated_recipients must equal the tool result; NEVER invent this number
- ALWAYS include _blocks with real, personalized content tailored to this specific audience (no generic placeholders)
- ALWAYS include _suggested_segment (required) and _suggested_utm (required, action="pending" on first suggestion)
- _suggested_segment: action="use_existing" if matching segment found; otherwise action="create_new" with count from preview_segment_size
- _suggested_segment MUST include metadata.criteria: array of 2–4 plain-English filter strings visible as tag chips in the UI
- estimated_size in _suggested_segment MUST come from a preview_segment_size tool call result
- _suggested_utm: ALWAYS set action="pending" on the first/initial suggestion - NEVER "create_new" without user confirmation
- ALWAYS end your EDM response asking the user about UTM tracking (see COMBINED CAMPAIGN RESPONSE PATTERN, STEP E)
- Subject lines: under 50 chars, sentence case, no ALL CAPS, no excessive punctuation
- Every email must include {{first_name}} somewhere to increase open rates
- html_body: inline CSS only (no <style> tags), max-width 600px
- Never suggest sending to users without is_opt_in_email=true - the platform enforces this
- You are only recommending. The user approves via "Save as Draft" or "Open in Editor" in the UI.
   END_REMOVED_EDM_PROMPT */

// ── Uploaded-file ingestion ───────────────────────────────────────────────────
// The chat "Upload file" button stores files under uploadsDir and attaches their
// /uploads/<name> URLs to the message. This turns readable text/CSV/JSON files
// into a compact preview that gets inlined into the model prompt so the analyst
// can actually reason over uploaded data (previously file_urls were dropped).
const READABLE_EXT = new Set([".csv", ".tsv", ".txt", ".json", ".md"]);
async function buildAttachmentPreview(fileUrls, companyId) {
  if (!Array.isArray(fileUrls) || fileUrls.length === 0 || !companyId) return "";
  let budget = 48 * 1024; // total bytes inlined across all attachments
  const parts = [];
  for (const url of fileUrls.slice(0, 5)) {
    let rel;
    try { rel = new URL(url).pathname; } catch { rel = String(url || ""); }
    // Only read files under THIS workspace's folder (/uploads/<companyId>/<file>)
    // so a crafted file_url can't make the analyst read another tenant's upload.
    const m = /^\/uploads\/([^/]+)\/(.+)$/.exec(rel);
    if (!m || m[1] !== String(companyId)) {
      parts.push(`[Attached file: ${path.basename(rel) || "unknown"} - not accessible in this workspace]`);
      continue;
    }
    // path.basename defends against ../ traversal in a crafted url.
    const base = path.basename(m[2]);
    const label = base.replace(/^\d+-/, ""); // strip the Date.now()- prefix
    const ext = path.extname(base).toLowerCase();
    if (!base) continue;
    if (!READABLE_EXT.has(ext)) {
      parts.push(`[Attached file: ${label} - ${ext || "binary"} file, contents not readable by the analyst]`);
      continue;
    }
    try {
      const filePath = path.join(uploadsDir, String(companyId), base);
      const stat = fs.statSync(filePath);
      const readBytes = Math.min(stat.size, 32 * 1024, budget);
      if (readBytes <= 0) { parts.push(`[Attached file: ${label} - skipped, attachment size budget reached]`); continue; }
      const fd = fs.openSync(filePath, "r");
      const buf = Buffer.alloc(readBytes);
      fs.readSync(fd, buf, 0, readBytes, 0);
      fs.closeSync(fd);
      const text = buf.toString("utf8");
      // Control bytes (excluding tab/newline/CR) → treat as binary, don't inline.
      if (/[\x00-\x08\x0E-\x1F]/.test(text)) { parts.push(`[Attached file: ${label} - binary, not readable]`); continue; }
      budget -= readBytes;
      const lines = text.split(/\r?\n/);
      const shown = lines.slice(0, 40);
      const fence = ext === ".json" ? "json" : (ext === ".csv" || ext === ".tsv") ? "csv" : "";
      const trunc = (stat.size > readBytes || lines.length > shown.length)
        ? `\n… (showing the first ${shown.length} lines; the file is larger)` : "";
      parts.push(`[Attached file: ${label}]\n\`\`\`${fence}\n${shown.join("\n")}\n\`\`\`${trunc}`);
    } catch {
      parts.push(`[Attached file: ${label} - could not be read from storage]`);
    }
  }
  return parts.length ? "\n\n" + parts.join("\n\n") : "";
}

// ── AI agent loop (MCP-based) ─────────────────────────────────────────────────
// Tools are served by the MCP server (server/mcp/server.js).
// Tool groups: DB Connector, Segments, UTM - all read-only; no writes without user approval.
async function runAnalystAgent(messages, skillsContext = "", companyId = null) {
  if (!aiClient) throw new Error("Azure OpenAI is not configured.");
  if (!mcpClient) throw new Error("MCP analyst server is not initialized.");

  // Load this workspace's analyst context from settings (company-scoped)
  let customContext = "";
  if (pool && companyId) {
    try {
      const { rows } = await pool.query(
        "SELECT value FROM app.settings WHERE key = 'analyst_system_prompt' AND company_id = $1",
        [companyId]
      );
      customContext = rows[0]?.value || "";
    } catch { /* table might not exist yet - safe to ignore */ }
  }

  // Discover tools from MCP server and convert to OpenAI function format
  const { tools: mcpTools } = await mcpClient.listTools();
  const aiTools = toOpenAITools(mcpTools);

  const convoMsgs = messages.filter((m) => m.role === "user" || m.role === "assistant");
  // Inline a preview of any files attached to the LATEST user turn (only the last
  // turn, to bound token cost) so the analyst can actually read uploaded data.
  let lastUserWithFiles = -1;
  for (let j = convoMsgs.length - 1; j >= 0; j--) {
    if (convoMsgs[j].role === "user" && convoMsgs[j].file_urls?.length) { lastUserWithFiles = j; break; }
  }
  const filePreview = lastUserWithFiles >= 0
    ? await buildAttachmentPreview(convoMsgs[lastUserWithFiles].file_urls, companyId)
    : "";

  const aiMessages = [
    { role: "system", content: buildSystemPrompt(customContext, skillsContext, companyId) },
    ...convoMsgs.map((m, idx) => ({
      role: m.role,
      content: (m.content || "") + (idx === lastUserWithFiles ? filePreview : ""),
    })),
  ];

  let totalInputTokens = 0;
  let totalCachedTokens = 0;
  let totalOutputTokens = 0;
  // Transparency log of tools the analyst ran, surfaced on the assistant message
  // for the FunctionDisplay UI. Display-only: these are NOT replayed to the model
  // (the aiMessages rebuild maps role+content only), so no orphaned-tool_call error.
  const toolCallLog = [];

  for (let i = 0; i < 12; i++) {
    const response = await aiClient.chat.completions.create({
      model: azureDeployment,
      messages: aiMessages,
      tools: aiTools,
      tool_choice: "auto",
      max_completion_tokens: 8192,
      // gpt-5 models only accept the default temperature (1); passing any other
      // value is a 400 error, so we omit it.
    });

    if (response.usage) {
      totalInputTokens += response.usage.prompt_tokens || 0;
      totalCachedTokens += response.usage.prompt_tokens_details?.cached_tokens || 0;
      totalOutputTokens += response.usage.completion_tokens || 0;
    }

    const choice = response.choices[0];
    const msg = choice.message;

    if (msg.tool_calls?.length > 0) {
      aiMessages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });

      for (const tc of msg.tool_calls) {
        let toolResult;
        try {
          const args = JSON.parse(tc.function.arguments);
          // ── Workspace isolation ──────────────────────────────────────────
          // Fail CLOSED: the analyst may only touch the active workspace's data.
          // We inject the trusted companyId AFTER spreading args so a model-
          // supplied _company_id can never override it, and refuse to run any
          // tool without a resolved workspace. Every tool handler scopes its
          // queries to args._company_id.
          if (!companyId) {
            toolResult = JSON.stringify({ error: "No active workspace resolved for this request - refusing to query data. This is a security guard; retry from within a workspace." });
          } else {
            const scopedArgs = { ...args, _company_id: companyId };
            const result = await mcpClient.callTool({ name: tc.function.name, arguments: scopedArgs });
            toolResult = result.content?.[0]?.text ?? JSON.stringify(result);
          }
        } catch (err) {
          toolResult = JSON.stringify({ error: String(err.message || err) });
        }
        // Record for the UI (result truncated so the conversation JSON stays small).
        const resultStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult);
        toolCallLog.push({
          name: tc.function.name,
          arguments_string: tc.function.arguments,
          results: resultStr.length > 4000 ? resultStr.slice(0, 4000) + "…(truncated)" : resultStr,
          status: "completed",
        });
        aiMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
      }
      continue;
    }

    return {
      content: msg.content || "",
      toolCalls: toolCallLog,
      usage: { input: totalInputTokens, cached: totalCachedTokens, output: totalOutputTokens, total: totalInputTokens + totalOutputTokens },
    };
  }

  return {
    content: "I reached the analysis limit for this request. Please try a more specific question.",
    toolCalls: toolCallLog,
    usage: { input: totalInputTokens, cached: totalCachedTokens, output: totalOutputTokens, total: totalInputTokens + totalOutputTokens },
  };
}

// ── Simple LLM call (chart editor, explainers) ────────────────────────────────
// Runs on the cheaper FAST model (NOT the analyst model). Pass usageCtx
// ({ companyId, userId, feature }) to ledger token spend + cost.
async function runSimpleLLM(prompt, jsonMode = false, usageCtx = null) {
  if (!aiClientFast) throw new Error("Azure OpenAI is not configured.");
  const response = await aiClientFast.chat.completions.create({
    model: azureDeploymentFast,
    messages: [{ role: "user", content: prompt }],
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    max_completion_tokens: 2000,
    // gpt-5 models only accept the default temperature (1); omit it.
  });
  if (usageCtx && response.usage) {
    recordAiUsage(pool, {
      ...usageCtx,
      model: azureDeploymentFast,
      inputTokens: response.usage.prompt_tokens,
      cachedTokens: response.usage.prompt_tokens_details?.cached_tokens || 0,
      outputTokens: response.usage.completion_tokens,
    });
  }
  return response.choices[0].message.content || "";
}

// ── Express setup ─────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());
app.use("/uploads", express.static(uploadsDir));

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "cdp-click-ai-server", ai: !!aiClient, db: !!pool });
});

// ── Auth & Company routes ─────────────────────────────────────────────────────
// (mounted after pool is available - see start())


// ── Entity CRUD - backed by Postgres app schema ───────────────────────────────
// Multi-tenant entities filter by company_id + visibility (private = only creator, company = all members)

app.get("/api/entities/:entity", authenticate, async (req, res) => {
  const config = ENTITY_CONFIG[req.params.entity];
  if (!config) return res.status(400).json({ error: `Unknown entity: ${req.params.entity}` });
  try {
    const p = requirePool();
    const order = buildOrderBy(req.query.sort, config.sortable);
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 1000) : 500;

    if (config.multiTenant) {
      const companyId = await companyGuard(req, res);
      if (!companyId) return;
      // Join the creator so the UI can attribute the item to a user (e.g. the
      // "created by" tag on dashboard charts). Table aliased to `e` so the
      // ORDER BY column (which also exists on app.users) isn't ambiguous.
      const { rows } = await p.query(
        `SELECT e.*, cu.full_name AS created_by_name, cu.email AS created_by_email
           FROM ${config.table} e
           LEFT JOIN app.users cu ON cu.id = e.created_by
          WHERE e.company_id = $1
            AND (e.visibility = 'company' OR e.created_by = $2)
          ORDER BY e.${order} LIMIT $3`,
        [companyId, req.user.id, limit]
      );
      return res.json(rows.map(normalizeRow));
    }

    const { rows } = await p.query(
      `SELECT * FROM ${config.table} ORDER BY ${order} LIMIT $1`,
      [limit]
    );
    res.json(rows.map(normalizeRow));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/entities/:entity", authenticate, async (req, res) => {
  const config = ENTITY_CONFIG[req.params.entity];
  if (!config) return res.status(400).json({ error: `Unknown entity: ${req.params.entity}` });
  try {
    const p = requirePool();
    const cols = pickColumns(req.body, config.columns);

    if (config.multiTenant) {
      const companyId = await companyGuard(req, res);
      if (!companyId) return;
      // Creating an entity (campaign, segment, pinned chart, saved report) is a
      // write - viewers are read-only. companyGuard allows read-style POSTs, so
      // block viewers here explicitly.
      if (denyViewer(req, res, "create items")) return;
      const allCols = [...cols, "company_id", "created_by"];
      const placeholders = allCols.map((_, i) => `$${i + 1}`).join(", ");
      const values = [...cols.map((c) => req.body[c]), companyId, req.user.id];
      const { rows } = await p.query(
        `INSERT INTO ${config.table} (${allCols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      return res.status(201).json(normalizeRow(rows[0]));
    }

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

app.patch("/api/entities/:entity/:id", authenticate, async (req, res) => {
  const config = ENTITY_CONFIG[req.params.entity];
  if (!config) return res.status(400).json({ error: `Unknown entity: ${req.params.entity}` });
  try {
    const p = requirePool();
    const cols = pickColumns(req.body, config.columns);
    if (cols.length === 0) return res.status(400).json({ error: "No valid fields to update." });

    let companyId = null;
    if (config.multiTenant) {
      companyId = await companyGuard(req, res);
      if (!companyId) return;

      // Only the creator or an admin/owner can edit
      const { rows: owned } = await p.query(
        `SELECT id FROM ${config.table} WHERE id = $1 AND company_id = $2 AND (created_by = $3 OR $4 IN (
           SELECT role FROM app.company_members WHERE company_id = $2 AND user_id = $3
         ))`,
        [req.params.id, companyId, req.user.id, req.user.id]
      );
      if (!owned.length) {
        // Simpler: check if editor/creator via separate query
        const { rows: item } = await p.query(
          `SELECT created_by FROM ${config.table} WHERE id = $1 AND company_id = $2`,
          [req.params.id, companyId]
        );
        if (!item.length) return res.status(404).json({ error: "Not found" });
        const { rows: membership } = await p.query(
          `SELECT role FROM app.company_members WHERE company_id = $1 AND user_id = $2 AND status = 'active'`,
          [companyId, req.user.id]
        );
        const role = membership[0]?.role;
        const isOwnerOrAdmin = ["owner", "admin"].includes(role);
        if (item[0].created_by !== req.user.id && !isOwnerOrAdmin) {
          return res.status(403).json({ error: "You can only edit items you created" });
        }
      }
    }

    const setClauses = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
    const idIdx = cols.length + 1;
    const values = [...cols.map((c) => req.body[c]), req.params.id];
    // Self-scope the write to the company (defence in depth beyond the SELECT above).
    let whereScope = "";
    if (companyId) { values.push(companyId); whereScope = ` AND company_id = $${cols.length + 2}`; }
    const { rows } = await p.query(
      `UPDATE ${config.table} SET ${setClauses} WHERE id = $${idIdx}${whereScope} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Re-run a pinned chart's stored SELECT (read-only) and persist the fresh rows
// into chart_config.data + last_refreshed. Shared by the manual refresh endpoint
// and the nightly cron. Never throws for a bad/failed query - it records the
// failure on the chart (metadata.last_refresh_error) so the UI can flag stale
// data instead of silently showing it, and keeps the existing snapshot. Returns:
//   { status: "refreshed", chart }  - query ran, snapshot + timestamp updated
//   { status: "no_query" }          - nothing to run, snapshot kept
//   { status: "invalid", error, chart }  - query is not a lone read-only SELECT
//   { status: "failed",  error, chart }  - query threw (snapshot kept)
async function refreshChartData(p, chart, companyId) {
  // Stamp an error onto the chart's metadata and return it, keeping the snapshot.
  const recordError = async (message) => {
    const meta = { ...toObj(chart.metadata), last_refresh_error: message };
    const { rows } = await p.query(
      `UPDATE app.pinned_charts SET metadata = $1 WHERE id = $2 AND company_id = $3 RETURNING *`,
      [JSON.stringify(meta), chart.id, companyId]
    );
    return rows[0] ? normalizeRow(rows[0]) : normalizeRow(chart);
  };

  // Strip a single trailing semicolon; must be a lone read-only SELECT.
  const sql = String(chart.query || "").trim().replace(/;\s*$/, "");
  if (!sql) return { status: "no_query" };
  if (!/^select\b/i.test(sql) || sql.includes(";")) {
    const msg = "Chart query must be a single read-only SELECT statement.";
    return { status: "invalid", error: msg, chart: await recordError(msg) };
  }

  // Execute inside a READ ONLY transaction with a statement timeout and hard row
  // cap so a stored query can never write or run away.
  const client = await p.connect();
  let rows;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = 15000");
    const result = await client.query(`SELECT * FROM (${sql}) AS _chart_refresh LIMIT 1000`);
    rows = result.rows;
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    return { status: "failed", error: e.message, chart: await recordError(e.message) };
  } finally {
    client.release();
  }

  const nextConfig = { ...toObj(chart.chart_config), data: rows };
  // Success clears any prior refresh error so a recovered chart drops the flag.
  const nextMeta = { ...toObj(chart.metadata) };
  delete nextMeta.last_refresh_error;
  const { rows: updated } = await p.query(
    `UPDATE app.pinned_charts SET chart_config = $1, metadata = $2, last_refreshed = NOW()
     WHERE id = $3 AND company_id = $4 RETURNING *`,
    [JSON.stringify(nextConfig), JSON.stringify(nextMeta), chart.id, companyId]
  );
  return { status: "refreshed", chart: normalizeRow(updated[0]) };
}

// POST /api/charts/:id/refresh - re-run a pinned chart's stored SELECT query
// (read-only) and refresh its data snapshot + last_refreshed. Charts that were
// pinned without a stored query keep their snapshot and report refreshed:false.
app.post("/api/charts/:id/refresh", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;

    const { rows: found } = await p.query(
      `SELECT * FROM app.pinned_charts WHERE id = $1 AND company_id = $2`,
      [req.params.id, companyId]
    );
    if (!found.length) return res.status(404).json({ error: "Not found" });

    const r = await refreshChartData(p, found[0], companyId);
    if (r.status === "no_query") {
      return res.json({ refreshed: false, reason: "no_query", chart: normalizeRow(found[0]) });
    }
    if (r.status === "invalid") return res.status(400).json({ error: r.error, chart: r.chart });
    if (r.status === "failed") return res.status(400).json({ error: `Query failed: ${r.error}`, chart: r.chart });
    res.json({ refreshed: true, chart: r.chart });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete("/api/entities/:entity/:id", authenticate, async (req, res) => {
  const config = ENTITY_CONFIG[req.params.entity];
  if (!config) return res.status(400).json({ error: `Unknown entity: ${req.params.entity}` });
  try {
    const p = requirePool();

    let companyId = null;
    if (config.multiTenant) {
      companyId = await companyGuard(req, res);
      if (!companyId) return;
      const { rows: item } = await p.query(
        `SELECT created_by FROM ${config.table} WHERE id = $1 AND company_id = $2`,
        [req.params.id, companyId]
      );
      if (!item.length) return res.status(404).json({ error: "Not found" });
      const { rows: membership } = await p.query(
        `SELECT role FROM app.company_members WHERE company_id = $1 AND user_id = $2 AND status = 'active'`,
        [companyId, req.user.id]
      );
      const role = membership[0]?.role;
      if (item[0].created_by !== req.user.id && !["owner", "admin"].includes(role)) {
        return res.status(403).json({ error: "You can only delete items you created" });
      }
    }

    const delParams = [req.params.id];
    let delScope = "";
    if (companyId) { delParams.push(companyId); delScope = " AND company_id = $2"; }
    await p.query(`DELETE FROM ${config.table} WHERE id = $1${delScope}`, delParams);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Conversations - backed by app.conversations ───────────────────────────────
// AI Analyst chats are PRIVATE to the user who created them - never shared at the
// workspace/company/account level. Every read/write is scoped by created_by =
// req.user.id (in addition to company_id), so no member - not even an admin or the
// account owner - can see or touch another user's conversations.

app.get("/api/agents/conversations", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;
    const params = [companyId, req.user.id];
    let q = "SELECT * FROM app.conversations WHERE company_id = $1 AND created_by = $2";
    if (req.query.agent_name) {
      q += " AND agent_name = $3";
      params.push(req.query.agent_name);
    }
    q += " ORDER BY updated_date DESC LIMIT 200";
    const { rows } = await p.query(q, params);
    res.json(rows.map(normalizeRow));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/agents/conversations", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;
    const { rows } = await p.query(
      `INSERT INTO app.conversations (company_id, created_by, agent_name, metadata)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [companyId, req.user.id, req.body.agent_name || "cdp_analyst", req.body.metadata || {}]
    );
    res.status(201).json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/agents/conversations/:id", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;
    const { rows } = await p.query(
      "SELECT * FROM app.conversations WHERE id = $1 AND company_id = $2 AND created_by = $3",
      [req.params.id, companyId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Conversation not found" });
    res.json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.patch("/api/agents/conversations/:id", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;
    const allowed = new Set(["title", "metadata", "status"]);
    const cols = pickColumns(req.body, allowed);
    if (cols.length === 0) return res.status(400).json({ error: "No valid fields to update." });

    // Merge metadata instead of replacing
    const setClauses = cols.map((c, i) =>
      c === "metadata"
        ? `metadata = metadata || $${i + 1}`
        : `${c} = $${i + 1}`
    ).join(", ");
    const values = [...cols.map((c) => req.body[c]), req.params.id, companyId, req.user.id];

    const { rows } = await p.query(
      `UPDATE app.conversations SET ${setClauses}
       WHERE id = $${values.length - 2} AND company_id = $${values.length - 1} AND created_by = $${values.length} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Conversation not found" });
    res.json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete("/api/agents/conversations/:id", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;
    await p.query("DELETE FROM app.conversations WHERE id = $1 AND company_id = $2 AND created_by = $3", [req.params.id, companyId, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Messages - returns immediately, runs AI in background
app.post("/api/agents/conversations/:id/messages", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;

    // Block once the account has spent its monthly AI allowance (no new spend).
    if (!(await enforceAiQuota(p, req, res, { companyId }))) return;

    // Fetch current conversation (owner-scoped: a user can only post to their own chat)
    const { rows: convRows } = await p.query(
      "SELECT * FROM app.conversations WHERE id = $1 AND company_id = $2 AND created_by = $3",
      [req.params.id, companyId, req.user.id]
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

    (async () => {
      // Fetch active context skills from conversation metadata
      let skillsContext = "";
      const activeSkillIds = conv.metadata?.active_skill_ids;
      if (p && Array.isArray(activeSkillIds) && activeSkillIds.length > 0) {
        try {
          const { rows: skillRows } = await p.query(
            "SELECT name, content FROM app.skills WHERE id = ANY($1::uuid[]) AND type = 'context' AND is_active = true",
            [activeSkillIds]
          );
          if (skillRows.length > 0) {
            skillsContext = skillRows.map((s) => `### ${s.name}\n${s.content}`).join("\n\n");
          }
        } catch { /* skills table may not exist yet */ }
      }

      let replyContent;
      let toolCalls = [];
      let usage = { input: 0, cached: 0, output: 0, total: 0 };
      try {
        const result = await runAnalystAgent(updatedMessages, skillsContext, companyId);
        replyContent = result.content;
        usage = result.usage;
        toolCalls = result.toolCalls || [];
      } catch (err) {
        console.error("AI agent error:", err.message);
        replyContent = `I encountered an error while processing your request: ${err.message}`;
      }

      // Ledger the token spend + cost for billing (per user / workspace / account).
      recordAiUsage(p, {
        companyId,
        userId: req.user?.id,
        feature: "analyst",
        model: azureDeployment,
        inputTokens: usage.input,
        cachedTokens: usage.cached,
        outputTokens: usage.output,
        metadata: { conversation_id: convId },
      });

      const assistantMsg = {
        role: "assistant",
        content: replyContent,
        created_date: new Date().toISOString(),
        token_usage: usage,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };

      const { rows: finalConv } = await p.query(
        "SELECT messages, metadata FROM app.conversations WHERE id = $1",
        [convId]
      );
      if (finalConv.length === 0) return;

      const finalMessages = [...(finalConv[0].messages || []), assistantMsg];
      const existingUsage = finalConv[0].metadata?.token_usage || { input: 0, output: 0, total: 0 };
      const newTokenUsage = {
        input: (existingUsage.input || 0) + usage.input,
        output: (existingUsage.output || 0) + usage.output,
        total: (existingUsage.total || 0) + usage.total,
      };

      await p.query(
        `UPDATE app.conversations
         SET messages = $1::jsonb, status = 'idle', updated_date = NOW(),
             metadata = metadata || $3::jsonb
         WHERE id = $2`,
        [JSON.stringify(finalMessages), convId, JSON.stringify({ token_usage: newTokenUsage })]
      );
    })().catch(console.error);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Skills ────────────────────────────────────────────────────────────────────

app.get("/api/skills", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;
    const { rows } = await p.query(
      `SELECT s.*, u.full_name AS creator_name, u.email AS creator_email
       FROM app.skills s
       LEFT JOIN app.users u ON u.id = s.created_by
       WHERE s.company_id = $1
       ORDER BY s.type, s.name`,
      [companyId]
    );
    res.json(rows.map(normalizeRow));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/skills", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;
    const { name, description = "", content = "", type = "context", icon } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const { rows } = await p.query(
      `INSERT INTO app.skills (company_id, created_by, name, description, content, type, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [companyId, req.user.id, name.trim(), description, content, type, icon || null]
    );
    // Re-fetch with creator info
    const { rows: full } = await p.query(
      `SELECT s.*, u.full_name AS creator_name, u.email AS creator_email
       FROM app.skills s LEFT JOIN app.users u ON u.id = s.created_by
       WHERE s.id = $1`,
      [rows[0].id]
    );
    res.status(201).json(normalizeRow(full[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.patch("/api/skills/:id", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;

    // Permission: creator or owner/admin
    const { rows: existing } = await p.query(
      "SELECT created_by FROM app.skills WHERE id = $1 AND company_id = $2",
      [req.params.id, companyId]
    );
    if (existing.length === 0) return res.status(404).json({ error: "Skill not found" });
    if (existing[0].created_by !== req.user.id) {
      const { rows: memberRows } = await p.query(
        "SELECT role FROM app.company_members WHERE company_id = $1 AND user_id = $2 AND status = 'active'",
        [companyId, req.user.id]
      );
      if (!["owner", "admin"].includes(memberRows[0]?.role)) {
        return res.status(403).json({ error: "Only the creator or an admin can edit this skill" });
      }
    }

    const allowed = new Set(["name", "description", "content", "type", "icon", "is_active"]);
    const cols = pickColumns(req.body, allowed);
    if (cols.length === 0) return res.status(400).json({ error: "No valid fields to update." });
    const values = [...cols.map((c) => req.body[c]), req.params.id, companyId];
    const setClauses = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
    await p.query(
      `UPDATE app.skills SET ${setClauses} WHERE id = $${values.length - 1} AND company_id = $${values.length}`,
      values
    );
    const { rows: full } = await p.query(
      `SELECT s.*, u.full_name AS creator_name, u.email AS creator_email
       FROM app.skills s LEFT JOIN app.users u ON u.id = s.created_by
       WHERE s.id = $1`,
      [req.params.id]
    );
    res.json(normalizeRow(full[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete("/api/skills/:id", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;

    // Permission: creator or owner/admin
    const { rows: existing } = await p.query(
      "SELECT created_by FROM app.skills WHERE id = $1 AND company_id = $2",
      [req.params.id, companyId]
    );
    if (existing.length === 0) return res.status(404).json({ error: "Skill not found" });
    if (existing[0].created_by !== req.user.id) {
      const { rows: memberRows } = await p.query(
        "SELECT role FROM app.company_members WHERE company_id = $1 AND user_id = $2 AND status = 'active'",
        [companyId, req.user.id]
      );
      if (!["owner", "admin"].includes(memberRows[0]?.role)) {
        return res.status(403).json({ error: "Only the creator or an admin can delete this skill" });
      }
    }

    await p.query("DELETE FROM app.skills WHERE id = $1 AND company_id = $2", [req.params.id, companyId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Functions ─────────────────────────────────────────────────────────────────

// NOTE: arbitrary read-only SQL with no tenant scoping - kept only for legacy/AI
// internal use. UTM and other UI features must use the company-scoped routes
// (e.g. /api/utm/*). Requires authentication.
app.post("/api/functions/queryPostgres", authenticate, async (req, res) => {
  try {
    const result = await runReadOnlyQuery(req.body.query);
    res.json({ data: result });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/api/functions/deleteConversation", authenticate, async (req, res) => {
  try {
    const p = requirePool();
    const companyId = await companyGuard(req, res);
    if (!companyId) return;
    await p.query("DELETE FROM app.conversations WHERE id = $1 AND company_id = $2 AND created_by = $3", [req.body.conversation_id, companyId, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── LLM integration (chart editor, explainers) ────────────────────────────────
app.post("/api/integrations/llm", authenticate, async (req, res) => {
  if (!aiClient) {
    return res.status(503).json({ error: "Azure OpenAI is not configured." });
  }
  // Tenant-scope the call so it can't be used as an anonymous GPT proxy and so
  // its token spend is attributed to a workspace (recorded via runSimpleLLM).
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  if (!(await enforceAiQuota(pool, req, res, { companyId }))) return;
  try {
    const content = await runSimpleLLM(
      String(req.body.prompt || ""),
      !!req.body.response_json_schema,
      { companyId, userId: req.user?.id, feature: "llm" }
    );
    if (req.body.response_json_schema) return res.json(JSON.parse(content));
    return res.json(content);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Chart Summaries (DB-cached AI explanations) ───────────────────────────────
app.post("/api/chart-summaries/explain", authenticate, async (req, res) => {
  if (!aiClient) return res.status(503).json({ error: "Azure OpenAI is not configured." });
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  const { chart_key, chart_title, chart_type, data } = req.body;
  if (!chart_key) return res.status(400).json({ error: "chart_key is required" });
  const p = requirePool();
  try {
    // Fingerprint the exact prompt input (title + type + the data the LLM will see).
    // The cache is valid only while this input is unchanged: when the chart's data
    // changes the fingerprint changes and we regenerate, so explanations never go stale.
    const dataPreview = JSON.stringify((data || []).slice(0, 15), null, 2).slice(0, 1500);
    const fingerprint = createHash("sha1")
      .update(`${chart_title || ""}\n${chart_type || ""}\n${dataPreview}`)
      .digest("hex");

    // Cache is per workspace - chart_key is a static per-chart string, so without
    // company_id one tenant's explanation would leak to (and be reused by) others.
    const existing = await p.query(
      "SELECT summary, data_hash FROM app.chart_summaries WHERE company_id = $1 AND chart_key = $2",
      [companyId, chart_key]
    );
    // Reuse only on a fingerprint match; a stale row (data changed) falls through to regenerate.
    if (existing.rows.length > 0 && existing.rows[0].data_hash === fingerprint) {
      return res.json({ summary: existing.rows[0].summary });
    }

    // A cache miss means a real LLM call - block it if the monthly AI limit is hit.
    if (!(await enforceAiQuota(p, req, res, { companyId }))) return;

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

    const summary = await runSimpleLLM(prompt, false, {
      companyId, userId: req.user?.id, feature: "chart_summary",
      metadata: { chart_key },
    });
    await p.query(
      `INSERT INTO app.chart_summaries (company_id, chart_key, summary, data_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, chart_key) DO UPDATE SET summary = EXCLUDED.summary, data_hash = EXCLUDED.data_hash, updated_date = NOW()`,
      [companyId, chart_key, summary, fingerprint]
    );
    return res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: Customers (reads from app.customer_profiles) ────────────────────
app.get("/api/profiles/customers", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const {
      search = "", page = "1", limit = "20",
      reg_channel, education_level, age_group, gender, nationality, preferred_language,
      employment_status, income_level, member_type, preferred_channel,
      has_ga, min_ga_sessions,
      opt_in_email, opt_in_sms, is_subscriber,
      has_seminars, has_attributes, is_imported,
      has_transactions, min_orders, min_spend, ordered_within,
      attribute_value_ids, attr_groups,
      sort, dir,
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    // Profiles are fully company-scoped in the unified schema.
    const params = [companyId];
    const conditions = ["company_id = $1"];
    // Multi-select demographic fields arrive comma-separated → match any (IN/ANY).
    const addIn = (raw, col) => {
      const vals = String(raw || "").split(",").map(s => s.trim()).filter(Boolean);
      if (vals.length) { params.push(vals); conditions.push(`${col} = ANY($${params.length}::text[])`); }
    };

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(LOWER(eng_full_name) LIKE $${params.length} OR LOWER(primary_email) LIKE $${params.length} OR LOWER(member_no) LIKE $${params.length} OR LOWER(customer_profiles.member_id) LIKE $${params.length})`);
    }
    addIn(reg_channel,        "member_reg_channel");
    addIn(education_level,    "education_level");
    addIn(age_group,          "age_group");
    addIn(gender,             "gender");
    addIn(nationality,        "nationality");
    addIn(preferred_language, "preferred_language");
    addIn(employment_status,  "employment_status");
    addIn(income_level,       "income_level");
    addIn(member_type,        "member_type");
    addIn(preferred_channel,  "preferred_channel");
    if (has_ga === "true")        conditions.push("ga_sessions > 0");
    if (min_ga_sessions)          { params.push(parseInt(min_ga_sessions)); conditions.push(`ga_sessions >= $${params.length}`); }
    if (opt_in_email === "true")  conditions.push("is_opt_in_email = true");
    if (opt_in_email === "false") conditions.push("(is_opt_in_email = false OR is_opt_in_email IS NULL)");
    if (opt_in_sms === "true")    conditions.push("is_opt_in_sms = true");
    if (is_subscriber === "true") conditions.push("is_subscriber_only = true");
    if (has_seminars === "true")  conditions.push("seminar_count > 0");
    if (has_attributes === "true") conditions.push("attribute_count > 0");
    if (is_imported === "true")   conditions.push("is_manual = true");
    // Transaction (Shopify sale) filters - reference the `txn` aggregate join below.
    if (has_transactions === "true") conditions.push("COALESCE(txn.order_count, 0) > 0");
    if (min_orders) { params.push(parseInt(min_orders));   conditions.push(`COALESCE(txn.order_count, 0) >= $${params.length}`); }
    if (min_spend)  { params.push(parseFloat(min_spend));  conditions.push(`COALESCE(txn.total_spend, 0) >= $${params.length}`); }
    if (ordered_within) { params.push(parseInt(ordered_within)); conditions.push(`txn.last_order_date >= NOW() - make_interval(days => $${params.length})`); }
    // Applied-attribute filters: each group (one per attribute) ANDs, values within a group OR.
    // `attr_groups` = "v1,v2;v3"; legacy `attribute_value_ids` = "v1,v2" is treated as one group.
    const attrGroups = String(attr_groups || attribute_value_ids || "")
      .split(";").map(g => g.split(",").map(s => s.trim()).filter(Boolean)).filter(g => g.length);
    for (const group of attrGroups) {
      params.push(group);
      conditions.push(`EXISTS (SELECT 1 FROM app.profile_attribute_values pav
        JOIN app.attributes pa ON pa.id = pav.attribute_id AND pa.status = 'active'
        WHERE pav.entity_type = 'customer' AND pav.entity_id = customer_profiles.member_id
          AND pav.attribute_value_id = ANY($${params.length}::uuid[]))`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    // Per-member purchase aggregates, company-scoped and source-agnostic (synced
    // commerce + manual sales). Members with no sales get NULL → COALESCE'd to 0.
    const txnJoin = `
      LEFT JOIN (
        SELECT member_id,
               COUNT(*)                                  AS order_count,
               COALESCE(SUM(net_amount), 0)              AS total_spend,
               MAX(order_date)                           AS last_order_date,
               MIN(order_date)                           AS first_order_date,
               MODE() WITHIN GROUP (ORDER BY currency)   AS order_currency
          FROM (
            SELECT customer_id AS member_id, net_amount, currency, order_date
              FROM commerce."order" WHERE company_id = $1 AND order_status IN ('completed','confirmed')
            UNION ALL
            SELECT member_id, trxn_original_net_amt, trxn_original_net_currency, trxn_date
              FROM manual.sale  WHERE company_id = $1 AND trxn_order_status IN ('completed','confirmed')
          ) all_sales
         WHERE member_id IS NOT NULL
         GROUP BY member_id
      ) txn ON txn.member_id = customer_profiles.member_id`;
    const from = `FROM app.customer_profiles ${txnJoin} ${where}`;
    // Whitelisted sort column + direction (order_count/total_spend are SELECT aliases).
    const CUST_SORT = {
      join_date: "member_join_date", name: "eng_full_name", orders: "order_count",
      spend: "total_spend", last_order: "txn.last_order_date", sessions: "ga_sessions",
      last_seen: "ga_last_seen",
    };
    const orderCol = CUST_SORT[sort] || "member_join_date";
    const orderDir = String(dir).toLowerCase() === "asc" ? "ASC" : "DESC";
    params.push(parseInt(limit), offset);

    const [result, countResult] = await Promise.all([
      pool.query(`SELECT customer_profiles.*,
                         customer_profiles.is_manual AS is_imported,
                         COALESCE(txn.order_count, 0) AS order_count,
                         COALESCE(txn.total_spend, 0) AS total_spend,
                         txn.last_order_date, txn.first_order_date, txn.order_currency
                  ${from}
                  ORDER BY ${orderCol} ${orderDir} NULLS LAST
                  LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) ${from}`, params.slice(0, params.length - 2)),
    ]);
    res.json({ profiles: result.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/profiles/customer-filters", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const scope = "company_id = $1";
    const webScope = `${scope} AND %COL% IS NOT NULL AND %COL% NOT IN ('', '(not set)')`;
    const [channels, educations, ages, genders, nationalities, languages, employments, incomes, memberTypes, prefChannels, sourceMediums, sources, mediums, campaigns] = await Promise.all([
      pool.query(`SELECT DISTINCT member_reg_channel FROM app.customer_profiles WHERE ${scope} AND member_reg_channel IS NOT NULL ORDER BY member_reg_channel`, [companyId]),
      pool.query(`SELECT DISTINCT education_level FROM app.customer_profiles WHERE ${scope} AND education_level IS NOT NULL ORDER BY education_level`, [companyId]),
      pool.query(`SELECT DISTINCT age_group FROM app.customer_profiles WHERE ${scope} AND age_group IS NOT NULL ORDER BY age_group`, [companyId]),
      pool.query(`SELECT DISTINCT gender FROM app.customer_profiles WHERE ${scope} AND gender IS NOT NULL ORDER BY gender`, [companyId]),
      pool.query(`SELECT DISTINCT nationality FROM app.customer_profiles WHERE ${scope} AND nationality IS NOT NULL ORDER BY nationality`, [companyId]),
      pool.query(`SELECT DISTINCT preferred_language FROM app.customer_profiles WHERE ${scope} AND preferred_language IS NOT NULL ORDER BY preferred_language`, [companyId]),
      pool.query(`SELECT DISTINCT employment_status FROM app.customer_profiles WHERE ${scope} AND employment_status IS NOT NULL ORDER BY employment_status`, [companyId]),
      pool.query(`SELECT DISTINCT income_level FROM app.customer_profiles WHERE ${scope} AND income_level IS NOT NULL ORDER BY income_level`, [companyId]),
      pool.query(`SELECT DISTINCT member_type FROM app.customer_profiles WHERE ${scope} AND member_type IS NOT NULL ORDER BY member_type`, [companyId]),
      pool.query(`SELECT DISTINCT preferred_channel FROM app.customer_profiles WHERE ${scope} AND preferred_channel IS NOT NULL ORDER BY preferred_channel`, [companyId]),
      pool.query(`SELECT DISTINCT ga_top_source_medium FROM app.customer_profiles WHERE ${webScope.replace(/%COL%/g, "ga_top_source_medium")} ORDER BY ga_top_source_medium`, [companyId]),
      pool.query(`SELECT DISTINCT TRIM(SPLIT_PART(ga_top_source_medium, ' / ', 1)) AS s FROM app.customer_profiles WHERE ${webScope.replace(/%COL%/g, "ga_top_source_medium")} ORDER BY s`, [companyId]),
      pool.query(`SELECT DISTINCT TRIM(SPLIT_PART(ga_top_source_medium, ' / ', 2)) AS m FROM app.customer_profiles WHERE ${webScope.replace(/%COL%/g, "ga_top_source_medium")} ORDER BY m`, [companyId]),
      pool.query(`SELECT DISTINCT ga_top_campaign FROM app.customer_profiles WHERE ${webScope.replace(/%COL%/g, "ga_top_campaign")} ORDER BY ga_top_campaign`, [companyId]),
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
      source_mediums: sourceMediums.rows.map(r => r.ga_top_source_medium),
      sources: sources.rows.map(r => r.s).filter(s => s && s !== '(not set)'),
      mediums: mediums.rows.map(r => r.m).filter(m => m && m !== '(not set)'),
      campaigns: campaigns.rows.map(r => r.ga_top_campaign),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: Anonymous (reads from app.anonymous_profiles) ───────────────────
app.get("/api/profiles/anonymous", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const { search = "", page = "1", limit = "20", source_medium, source, medium, has_form_complete, is_resolved, attribute_value_ids, attr_groups, sort, dir } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [companyId];
    const conditions = ["company_id = $1"];
    // Identity filter: identified (mapped to a customer) vs still-anonymous.
    if (is_resolved === "true")  conditions.push("resolved_member_id IS NOT NULL");
    if (is_resolved === "false") conditions.push("resolved_member_id IS NULL");

    if (search)       { params.push(`%${search.toLowerCase()}%`); conditions.push(`LOWER(visitor_id) LIKE $${params.length}`); }
    // source_mediums is an array of "source / medium" strings.
    const sourceMediums = String(source_medium || "").split(",").map(s => s.trim()).filter(Boolean);
    if (sourceMediums.length) { params.push(sourceMediums); conditions.push(`source_mediums && $${params.length}::text[]`); }
    // Separate source / medium: match the split parts of any element of source_mediums.
    const sources = String(source || "").split(",").map(s => s.trim()).filter(Boolean);
    if (sources.length) { params.push(sources); conditions.push(`EXISTS (SELECT 1 FROM unnest(source_mediums) sm WHERE TRIM(split_part(sm, ' / ', 1)) = ANY($${params.length}::text[]))`); }
    const mediums = String(medium || "").split(",").map(s => s.trim()).filter(Boolean);
    if (mediums.length) { params.push(mediums); conditions.push(`EXISTS (SELECT 1 FROM unnest(source_mediums) sm WHERE TRIM(split_part(sm, ' / ', 2)) = ANY($${params.length}::text[]))`); }
    if (has_form_complete === "true") conditions.push("form_completes > 0");
    // Applied-attribute filters: each group (one per attribute) ANDs, values within a group OR.
    const attrGroups = String(attr_groups || attribute_value_ids || "")
      .split(";").map(g => g.split(",").map(s => s.trim()).filter(Boolean)).filter(g => g.length);
    for (const group of attrGroups) {
      params.push(group);
      conditions.push(`EXISTS (SELECT 1 FROM app.profile_attribute_values pav
        JOIN app.attributes pa ON pa.id = pav.attribute_id AND pa.status = 'active'
        WHERE pav.entity_type = 'anonymous' AND pav.entity_id = anonymous_profiles.visitor_id
          AND pav.attribute_value_id = ANY($${params.length}::uuid[]))`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const ANON_SORT = {
      events: "total_events", page_views: "page_views", sessions: "sessions",
      last_seen: "last_seen", first_seen: "first_seen",
    };
    const orderCol = ANON_SORT[sort] || "total_events";
    const orderDir = String(dir).toLowerCase() === "asc" ? "ASC" : "DESC";
    params.push(parseInt(limit), offset);

    // resolved_name: friendly label for the linked member (NULL when unresolved),
    // resolved via a correlated subselect so the WHERE/filters above stay untouched.
    const resolvedNameExpr = `(
      SELECT COALESCE(NULLIF(cp.display_name,''), NULLIF(cp.eng_full_name,''), NULLIF(cp.primary_email,''), anonymous_profiles.resolved_member_id)
      FROM app.customer_profiles cp
      WHERE cp.company_id = anonymous_profiles.company_id
        AND cp.member_id = anonymous_profiles.resolved_member_id
    ) AS resolved_name`;
    const [result, countResult, totalsResult] = await Promise.all([
      pool.query(`SELECT *, ${resolvedNameExpr} FROM app.anonymous_profiles ${where} ORDER BY ${orderCol} ${orderDir} NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM app.anonymous_profiles ${where}`, params.slice(0, params.length - 2)),
      // Company-wide totals (unfiltered) so the UI can show "X of Y identified".
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE resolved_member_id IS NOT NULL)::int AS identified FROM app.anonymous_profiles WHERE company_id = $1`, [companyId]),
    ]);
    res.json({
      profiles: result.rows,
      total: parseInt(countResult.rows[0].count),
      anonymous_total: totalsResult.rows[0].total,
      identified_total: totalsResult.rows[0].identified,
      page: parseInt(page), limit: parseInt(limit),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/profiles/anonymous-filters", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const [sm, src, med, camp] = await Promise.all([
      pool.query(`SELECT DISTINCT UNNEST(source_mediums) AS sm FROM app.anonymous_profiles WHERE company_id = $1 ORDER BY sm`, [companyId]),
      pool.query(`SELECT DISTINCT TRIM(SPLIT_PART(UNNEST(source_mediums), ' / ', 1)) AS s FROM app.anonymous_profiles WHERE company_id = $1 ORDER BY s`, [companyId]),
      pool.query(`SELECT DISTINCT TRIM(SPLIT_PART(UNNEST(source_mediums), ' / ', 2)) AS m FROM app.anonymous_profiles WHERE company_id = $1 ORDER BY m`, [companyId]),
      pool.query(`SELECT DISTINCT top_campaign AS c FROM app.anonymous_profiles WHERE company_id = $1 AND top_campaign IS NOT NULL AND top_campaign NOT IN ('', '(not set)') ORDER BY top_campaign`, [companyId]),
    ]);
    res.json({
      source_mediums: sm.rows.map(x => x.sm).filter(Boolean),
      sources: src.rows.map(x => x.s).filter(s => s && s !== '(not set)'),
      mediums: med.rows.map(x => x.m).filter(m => m && m !== '(not set)'),
      campaigns: camp.rows.map(x => x.c).filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: identification funnel (Visitors → Engaged → Identified → Customers) ─
app.get("/api/profiles/funnel", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const [anon, cust] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int                                                                              AS visitors,
          COUNT(*) FILTER (WHERE user_engagement > 0 OR form_starts > 0 OR scroll_events > 0 OR page_views > 1)::int AS engaged,
          COUNT(*) FILTER (WHERE resolved_member_id IS NOT NULL)::int                                AS identified
        FROM app.anonymous_profiles WHERE company_id = $1`, [companyId]),
      pool.query(`
        SELECT
          COUNT(*)::int                                            AS customers,
          COUNT(*) FILTER (WHERE order_count > 0)::int             AS buyers
        FROM app.customer_profiles WHERE company_id = $1`, [companyId]),
    ]);
    res.json({ ...anon.rows[0], ...cust.rows[0] });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: duplicate / merge candidates (review queue) ─────────────────────
app.get("/api/profiles/merge-candidates", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const status = ["pending", "merged", "dismissed"].includes(req.query.status) ? req.query.status : "pending";
    const { rows } = await pool.query(`
      SELECT mc.id, mc.member_id_a, mc.source_a, mc.member_id_b, mc.source_b,
             mc.match_type, mc.match_value, mc.confidence, mc.status, mc.created_date,
             (SELECT COALESCE(NULLIF(a.display_name,''), NULLIF(a.eng_full_name,''), a.primary_email, mc.member_id_a)
                FROM app.customer_profiles a WHERE a.company_id = mc.company_id AND a.member_id = mc.member_id_a) AS name_a,
             (SELECT COALESCE(NULLIF(b.display_name,''), NULLIF(b.eng_full_name,''), b.primary_email, mc.member_id_b)
                FROM app.customer_profiles b WHERE b.company_id = mc.company_id AND b.member_id = mc.member_id_b) AS name_b
      FROM app.profile_merge_candidates mc
      WHERE mc.company_id = $1 AND mc.status = $2
      ORDER BY mc.created_date DESC
      LIMIT 200`, [companyId, status]);
    res.json({ candidates: rows });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Dismiss a false-positive duplicate (keeps both profiles separate).
app.post("/api/profiles/merge-candidates/:id/dismiss", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const { rowCount } = await pool.query(`
      UPDATE app.profile_merge_candidates
      SET status = 'dismissed', resolved_by = $3, resolved_at = NOW(), updated_date = NOW()
      WHERE id = $1 AND company_id = $2 AND status = 'pending'`,
      [req.params.id, companyId, req.user?.id || null]);
    if (!rowCount) return res.status(404).json({ error: "Candidate not found or already resolved" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: Analytics (aggregates over customer + anonymous profiles) ───────
app.get("/api/profiles/analytics", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const { from = "", to = "" } = req.query;
    const scope = "company_id = $1";

    // Date window. Empty range = all-time (default, unchanged). When a range is set
    // every metric is scoped to it - customers by member_join_date, anonymous by
    // last_seen - so the period filter, and period comparison, are meaningful.
    const dParams = [companyId];
    let dClause = "";
    if (from) { dParams.push(from); dClause += ` AND member_join_date >= $${dParams.length}`; }
    if (to)   { dParams.push(to);   dClause += ` AND member_join_date <= ($${dParams.length}::date + 1)`; }

    const aParams = [companyId];
    let aClause = "";
    if (from) { aParams.push(from); aClause += ` AND last_seen >= $${aParams.length}`; }
    if (to)   { aParams.push(to);   aClause += ` AND last_seen <= ($${aParams.length}::date + 1)`; }
    // Anonymous metrics are company-scoped just like the customer ones.
    const aWhere = `WHERE company_id = $1${aClause}`;

    // Categorical breakdown over customer_profiles, excluding blanks/(not set).
    const groupQ = (col, { excludeNotSet = false } = {}) => pool.query(
      `SELECT ${col} AS name, COUNT(*)::int AS value
         FROM app.customer_profiles
        WHERE ${scope} AND ${col} IS NOT NULL AND ${col} <> ''
              ${excludeNotSet ? `AND ${col} NOT IN ('(not set)', '(none)')` : ""}${dClause}
        GROUP BY ${col} ORDER BY value DESC LIMIT 12`,
      dParams
    );

    const [
      kpis, newOverTime, newInRange,
      ageGroup, gender, education, income, nationality, memberType,
      channels, sources, consent, engagement,
      anon, anonSources, withPurchases,
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total_customers,
                COUNT(*) FILTER (WHERE is_opt_in_email::text = 'true')::int AS opt_in_email,
                COUNT(*) FILTER (WHERE ga_sessions > 0)::int                AS web_active,
                COUNT(*) FILTER (WHERE seminar_count > 0)::int              AS with_seminars,
                COUNT(*) FILTER (WHERE attribute_count > 0)::int            AS with_attributes
           FROM app.customer_profiles WHERE ${scope}${dClause}`, dParams),
      pool.query(
        `SELECT to_char(date_trunc('month', member_join_date), 'YYYY-MM') AS name, COUNT(*)::int AS value
           FROM app.customer_profiles
          WHERE ${scope} AND member_join_date IS NOT NULL${dClause}
          GROUP BY 1 ORDER BY 1 ASC`, dParams),
      pool.query(
        `SELECT COUNT(*)::int AS value FROM app.customer_profiles
          WHERE ${scope} AND member_join_date IS NOT NULL${dClause}`, dParams),
      groupQ("age_group"),
      groupQ("gender"),
      groupQ("education_level"),
      groupQ("income_level"),
      groupQ("nationality"),
      groupQ("member_type"),
      groupQ("member_reg_channel"),
      groupQ("ga_top_source_medium", { excludeNotSet: true }),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE is_opt_in_email::text = 'true')::int AS email,
                COUNT(*) FILTER (WHERE is_opt_in_sms::text   = 'true')::int AS sms,
                COUNT(*) FILTER (WHERE is_opt_in_call::text  = 'true')::int AS call,
                COUNT(*) FILTER (WHERE is_opt_in_dm::text    = 'true')::int AS dm
           FROM app.customer_profiles WHERE ${scope}${dClause}`, dParams),
      pool.query(
        `SELECT CASE
                  WHEN ga_sessions IS NULL OR ga_sessions = 0 THEN '0'
                  WHEN ga_sessions BETWEEN 1 AND 2  THEN '1-2'
                  WHEN ga_sessions BETWEEN 3 AND 5  THEN '3-5'
                  WHEN ga_sessions BETWEEN 6 AND 10 THEN '6-10'
                  ELSE '10+' END AS name,
                COUNT(*)::int AS value
           FROM app.customer_profiles WHERE ${scope}${dClause}
          GROUP BY 1`, dParams),
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE form_completes > 0)::int AS high_intent
           FROM app.anonymous_profiles ${aWhere}`, aParams),
      pool.query(
        `SELECT top_source_medium AS name, COUNT(*)::int AS value
           FROM app.anonymous_profiles
          WHERE company_id = $1 AND top_source_medium IS NOT NULL AND top_source_medium NOT IN ('', '(not set)', '(none)')${aClause}
          GROUP BY 1 ORDER BY value DESC LIMIT 10`, aParams),
      pool.query(
        `SELECT COUNT(DISTINCT cp.member_id)::int AS value
           FROM app.customer_profiles cp
          WHERE ${scope.replace(/company_id/g, "cp.company_id")}${dClause}
            AND EXISTS (SELECT 1 FROM commerce."order" s
                         WHERE s.customer_id = cp.member_id AND s.company_id = cp.company_id
                           AND s.order_status IN ('completed', 'confirmed'))`, dParams)
        .catch(() => ({ rows: [{ value: 0 }] })), // commerce schema may be absent
    ]);

    res.json({
      kpis: {
        ...kpis.rows[0],
        with_purchases: withPurchases.rows[0].value,
        new_in_range: newInRange.rows[0].value,
        anonymous_total: anon.rows[0].total,
        anonymous_high_intent: anon.rows[0].high_intent,
      },
      new_over_time: newOverTime.rows,
      demographics: {
        age_group: ageGroup.rows,
        gender: gender.rows,
        education_level: education.rows,
        income_level: income.rows,
        nationality: nationality.rows,
        member_type: memberType.rows,
      },
      channels: channels.rows,
      sources: sources.rows,
      consent: [
        { name: "Email", value: consent.rows[0].email },
        { name: "SMS",   value: consent.rows[0].sms },
        { name: "Call",  value: consent.rows[0].call },
        { name: "DM",    value: consent.rows[0].dm },
      ],
      engagement: engagement.rows,
      anonymous_sources: anonSources.rows,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: CSV helpers ─────────────────────────────────────────────────────

const IMPORT_TEMPLATE_HEADERS = [
  "member_id", "primary_email", "primary_phone",
  "eng_full_name", "eng_first_name", "eng_last_name", "display_name",
  "member_no", "title", "member_type", "member_join_date",
  "member_reg_channel",
  "gender", "age_group", "nationality",
  "education_level", "income_level", "employment_status", "marital_status",
  "preferred_language", "preferred_channel",
  "is_opt_in_email", "is_opt_in_sms", "is_opt_in_call", "is_opt_in_dm",
  "tags",
];

const IMPORT_TEMPLATE_SAMPLE = [
  "", "john.doe@example.com", "+1234567890",
  "John Doe", "John", "Doe", "",
  "MEM001", "Mr", "Regular", "2024-01-15",
  "Manual Import",
  "M", "25-34", "Australian",
  "Bachelor's Degree", "50000-75000", "Employed", "Single",
  "English", "Email",
  "true", "false", "false", "false",
  "",
];

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 1) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || "").trim(); });
    return obj;
  });
  return { headers, rows };
}

// ── Profiles: Download CSV template ──────────────────────────────────────────
app.get("/api/profiles/template", (_req, res) => {
  const csv = [
    IMPORT_TEMPLATE_HEADERS.join(","),
    IMPORT_TEMPLATE_SAMPLE.map(v => v.includes(",") ? `"${v}"` : v).join(","),
  ].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="customer_profiles_template.csv"');
  res.send(csv);
});

// ── Profiles: Import CSV ──────────────────────────────────────────────────────
app.post("/api/profiles/import", authenticate, upload.single("file"), async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  if (denyViewer(req, res, "import data")) return;

  let text;
  try {
    text = fs.readFileSync(req.file.path, "utf8");
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
  }

  try {
    const { rows: csvRows } = parseCSV(text);
    if (csvRows.length === 0) return res.status(400).json({ error: "CSV has no data rows" });

    // Enforce the account plan's profile limit (null = unlimited).
    const profileCap = await planLimit(pool, companyId, "profiles");
    if (profileCap != null) {
      const { rows: [pc] } = await pool.query(
        "SELECT COUNT(*)::int AS n FROM app.customer_profiles WHERE company_id = $1", [companyId]
      );
      if (pc.n + csvRows.length > profileCap) {
        return res.status(403).json({
          error: `Importing ${csvRows.length} profiles would exceed your plan's ${profileCap}-profile limit (you have ${pc.n}). Upgrade for more.`,
        });
      }
    }

    const errors = [];
    const validRows = [];

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      const lineNum = i + 2;
      if (!row.primary_email) {
        errors.push({ row: lineNum, error: "Missing required field: primary_email" });
        continue;
      }
      if (!row.member_id) row.member_id = `IMP-${randomUUID()}`;
      validRows.push({ ...row, _line: lineNum });
    }

    // Dedup within the file
    const emailSet = new Set();
    const phoneSet = new Set();
    const memberIdSet = new Set();
    const deduped = [];

    for (const row of validRows) {
      const emailKey = row.primary_email.toLowerCase();
      if (emailSet.has(emailKey)) {
        errors.push({ row: row._line, error: `Duplicate email in file: ${row.primary_email}` });
        continue;
      }
      emailSet.add(emailKey);

      if (row.primary_phone) {
        if (phoneSet.has(row.primary_phone)) {
          errors.push({ row: row._line, error: `Duplicate phone in file: ${row.primary_phone}` });
          continue;
        }
        phoneSet.add(row.primary_phone);
      }

      if (memberIdSet.has(row.member_id)) {
        errors.push({ row: row._line, error: `Duplicate member_id in file: ${row.member_id}` });
        continue;
      }
      memberIdSet.add(row.member_id);
      deduped.push(row);
    }

    if (deduped.length === 0) {
      return res.status(400).json({ error: "No valid rows to import", details: errors });
    }

    // Check against existing profiles in THIS company: the unified golden record
    // plus both membership sources (manual + synced commerce). All company-scoped.
    const emails = deduped.map(r => r.primary_email.toLowerCase());
    const phones = deduped.filter(r => r.primary_phone).map(r => r.primary_phone);
    const memberIds = deduped.map(r => r.member_id);

    const [existEmailsCp, existPhonesCp, existIdsCp, existIdsMan, existIdsShop] = await Promise.all([
      pool.query("SELECT LOWER(primary_email) AS email FROM app.customer_profiles WHERE company_id = $2 AND LOWER(primary_email) = ANY($1)", [emails, companyId]),
      phones.length ? pool.query("SELECT primary_phone FROM app.customer_profiles WHERE company_id = $2 AND primary_phone = ANY($1)", [phones, companyId]) : Promise.resolve({ rows: [] }),
      pool.query("SELECT member_id FROM app.customer_profiles WHERE company_id = $2 AND member_id = ANY($1)", [memberIds, companyId]),
      pool.query("SELECT member_id FROM manual.membership WHERE company_id = $2 AND member_id = ANY($1)", [memberIds, companyId]),
      pool.query("SELECT customer_id AS member_id FROM commerce.customer WHERE company_id = $2 AND customer_id = ANY($1)", [memberIds, companyId]),
    ]);

    const conflictEmails = new Set(existEmailsCp.rows.map(r => r.email));
    const conflictPhones = new Set(existPhonesCp.rows.map(r => r.primary_phone));
    const conflictIds = new Set([
      ...existIdsCp.rows.map(r => r.member_id),
      ...existIdsMan.rows.map(r => r.member_id),
      ...existIdsShop.rows.map(r => r.member_id),
    ]);

    const toInsert = [];
    for (const row of deduped) {
      if (conflictEmails.has(row.primary_email.toLowerCase())) {
        errors.push({ row: row._line, error: `Email already exists: ${row.primary_email}` });
        continue;
      }
      if (row.primary_phone && conflictPhones.has(row.primary_phone)) {
        errors.push({ row: row._line, error: `Phone already exists: ${row.primary_phone}` });
        continue;
      }
      if (conflictIds.has(row.member_id)) {
        errors.push({ row: row._line, error: `Member ID already exists: ${row.member_id}` });
        continue;
      }
      toInsert.push(row);
    }

    // Provenance: every manual-upload row is tagged company + capsuite_ref + is_manual.
    const { rows: coRows } = await pool.query("SELECT capsuite_ref FROM app.companies WHERE id = $1", [companyId]);
    const capsuiteRef = coRows[0]?.capsuite_ref || null;

    // One upload batch per import, so manual rows carry their provenance
    // (file name, who uploaded, when) and a batch can later be tracked / undone.
    let uploadBatchId = null;
    if (toInsert.length) {
      const { rows: [batch] } = await pool.query(
        `INSERT INTO manual.upload_batches (company_id, uploaded_by, entity_type, file_name, row_count, status)
         VALUES ($1, $2, 'membership', $3, $4, 'completed')
         RETURNING id`,
        [companyId, req.user?.id || null, req.file.originalname || null, toInsert.length]
      );
      uploadBatchId = batch.id;
    }

    let imported = 0;
    for (const row of toInsert) {
      const boolField = v => v === "true" ? true : v === "false" ? false : null;
      const regChannel = row.member_reg_channel || "Manual Import";

      const params = [
        row.member_id,                    // $1
        row.primary_email || null,        // $2
        row.primary_phone || null,        // $3
        !!row.primary_email,              // $4  has_email
        !!row.primary_phone,              // $5  has_phone
        row.eng_full_name || null,        // $6
        row.eng_first_name || null,       // $7
        row.eng_last_name || null,        // $8
        row.display_name || null,         // $9
        row.member_no || null,            // $10
        row.title || null,                // $11
        row.member_type || null,          // $12
        row.member_join_date || null,     // $13
        regChannel,                       // $14  member_reg_channel
        row.gender || null,               // $15
        row.age_group || null,            // $16
        row.nationality || null,          // $17
        row.education_level || null,      // $18
        row.income_level || null,         // $19
        row.employment_status || null,    // $20
        row.marital_status || null,       // $21
        row.preferred_language || null,   // $22
        row.preferred_channel || null,    // $23
        boolField(row.is_opt_in_email),   // $24
        boolField(row.is_opt_in_sms),     // $25
        boolField(row.is_opt_in_call),    // $26
        boolField(row.is_opt_in_dm),      // $27
        row.tags || null,                 // $28
        companyId,                        // $29
        capsuiteRef,                      // $30
        uploadBatchId,                    // $31  upload_batch_id (provenance)
      ];

      // 1. Source-of-record row in the manual schema (provenance: is_manual=true,
      //    linked to this import's upload batch).
      await pool.query(
        `INSERT INTO manual.membership (
          member_id, company_id, is_manual, capsuite_ref, upload_batch_id,
          primary_email, primary_phone, has_email, has_phone,
          eng_full_name, eng_first_name, eng_last_name, display_name,
          member_no, title, member_type, member_join_date, member_last_update,
          member_reg_channel,
          gender, age_group, nationality,
          education_level, income_level, employment_status, marital_status,
          preferred_language, preferred_channel,
          is_opt_in_email, is_opt_in_sms, is_opt_in_call, is_opt_in_dm,
          tags
        ) VALUES (
          $1,$29,true,$30,$31,
          $2,$3,$4,$5,
          $6,$7,$8,$9,
          $10,$11,$12,$13,NOW(),
          $14,
          $15,$16,$17,$18,$19,$20,$21,
          $22,$23,$24,$25,$26,$27,$28
        ) ON CONFLICT (company_id, member_id) DO NOTHING`,
        params
      );

      // 2. Unified golden record used by the Profiles page / segmentation / EDM.
      await pool.query(
        `INSERT INTO app.customer_profiles (
          company_id, member_source, is_manual, capsuite_ref,
          member_id, primary_email, primary_phone, has_email, has_phone,
          eng_full_name, eng_first_name, eng_last_name, display_name,
          member_no, title, member_type, member_join_date,
          member_reg_channel,
          gender, age_group, nationality,
          education_level, income_level, employment_status, marital_status,
          preferred_language, preferred_channel,
          is_opt_in_email, is_opt_in_sms, is_opt_in_call, is_opt_in_dm,
          tags
        ) VALUES (
          $29,'manual',true,$30,
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,
          $10,$11,$12,$13,
          $14,
          $15,$16,$17,$18,$19,$20,$21,
          $22,$23,$24,$25,$26,$27,$28
        ) ON CONFLICT (company_id, member_id) DO NOTHING`,
        params
      );

      // 3. Identity links so this profile is reachable by email / phone / member_id.
      const identities = [["member_id", row.member_id, true]];
      if (row.primary_email) identities.push(["email", row.primary_email, false]);
      if (row.primary_phone) identities.push(["phone", row.primary_phone, false]);
      for (const [itype, ivalue, isPrimary] of identities) {
        await pool.query(
          `INSERT INTO app.profile_identities
             (company_id, member_id, source, source_id, identity_type, identity_value, is_primary)
           VALUES ($1,$2,'manual',$2,$3,$4,$5)
           ON CONFLICT (company_id, identity_type, LOWER(identity_value)) DO NOTHING`,
          [companyId, row.member_id, itype, ivalue, isPrimary]
        );
      }

      imported++;
    }

    res.json({
      ok: true,
      imported,
      skipped: csvRows.length - imported,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: Delete imported profile ─────────────────────────────────────────
app.delete("/api/profiles/customers/:memberId", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const { rows } = await pool.query(
      "SELECT is_manual FROM app.customer_profiles WHERE member_id = $1 AND company_id = $2",
      [req.params.memberId, companyId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Profile not found" });
    if (!rows[0].is_manual) return res.status(403).json({ error: "Only manually imported profiles can be deleted" });

    // Delete from the manual source and the unified record (both company-scoped).
    // profile_identities cascade off customer_profiles via FK.
    await Promise.all([
      pool.query("DELETE FROM manual.membership WHERE member_id = $1 AND company_id = $2", [req.params.memberId, companyId]),
      pool.query("DELETE FROM app.customer_profiles WHERE member_id = $1 AND company_id = $2 AND is_manual = true", [req.params.memberId, companyId]),
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Commerce: manual transaction/order CSV import ─────────────────────────────
// Lets users hand-upload their own orders (like the Shopify feed) into the same
// neutral commerce layer, tagged source_platform='manual'. Because the profile
// builder, segment engine and AI analyst all already read commerce.*, imported
// orders flow straight into profiles / segments / analyst with no extra wiring.
// One denormalised CSV = one row per line item, grouped by (customer_email, order_ref).

const ORDER_IMPORT_HEADERS = [
  "customer_email", "customer_name", "order_ref", "order_date", "order_status",
  "currency", "product_sku", "product_name", "quantity", "unit_price", "discount_amount",
];
const ORDER_IMPORT_SAMPLE = [
  ["jane@example.com", "Jane Smith", "ORD-1001", "2024-03-15", "completed", "USD", "SKU-001", "Blue T-Shirt", "2", "19.99", "0"],
  ["jane@example.com", "Jane Smith", "ORD-1001", "2024-03-15", "completed", "USD", "SKU-002", "Baseball Cap", "1", "24.99", "5.00"],
];
const ORDER_STATUSES = new Set(["draft", "confirmed", "completed", "cancelled"]);
const csvCell = v => (String(v ?? "").includes(",") ? `"${v}"` : String(v ?? ""));

// Deterministic ids so a re-uploaded file updates rows instead of duplicating.
const manualCustomerId = (ref, email) => `${ref || "man"}_cust_man_${createHash("md5").update(email.toLowerCase()).digest("hex").slice(0, 16)}`;
const manualOrderId = (ref, email, orderRef) => `${ref || "man"}_ord_man_${createHash("md5").update(`${email.toLowerCase()}|${orderRef}`).digest("hex").slice(0, 16)}`;

app.get("/api/commerce/import/template", (_req, res) => {
  const csv = [
    ORDER_IMPORT_HEADERS.join(","),
    ...ORDER_IMPORT_SAMPLE.map(r => r.map(csvCell).join(",")),
  ].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="orders_import_template.csv"');
  res.send(csv);
});

app.post("/api/commerce/import", authenticate, upload.single("file"), async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  if (denyViewer(req, res, "import data")) return;

  let text;
  try {
    text = fs.readFileSync(req.file.path, "utf8");
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
  }

  try {
    const { rows: csvRows } = parseCSV(text);
    if (csvRows.length === 0) return res.status(400).json({ error: "CSV has no data rows" });

    const { rows: coRows } = await pool.query("SELECT capsuite_ref FROM app.companies WHERE id = $1", [companyId]);
    const capsuiteRef = coRows[0]?.capsuite_ref || null;

    // 1. Validate + group rows into orders keyed by (email, order_ref).
    const errors = [];
    const orders = new Map(); // key -> { email, name, orderRef, date, status, currency, lines[] }
    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      const lineNum = i + 2;
      const email = (row.customer_email || "").trim().toLowerCase();
      const orderRef = (row.order_ref || "").trim();
      if (!email) { errors.push({ row: lineNum, error: "Missing required field: customer_email" }); continue; }
      if (!orderRef) { errors.push({ row: lineNum, error: "Missing required field: order_ref" }); continue; }
      if (!row.order_date) { errors.push({ row: lineNum, error: "Missing required field: order_date" }); continue; }

      const key = `${email}||${orderRef}`;
      if (!orders.has(key)) {
        const status = (row.order_status || "completed").trim().toLowerCase();
        orders.set(key, {
          email, name: (row.customer_name || "").trim(), orderRef,
          date: row.order_date.trim(),
          status: ORDER_STATUSES.has(status) ? status : "completed",
          currency: (row.currency || "").trim() || null,
          lines: [],
        });
      }
      const qty = parseFloat(row.quantity) || 1;
      const unitPrice = parseFloat(row.unit_price) || 0;
      const discount = parseFloat(row.discount_amount) || 0;
      orders.get(key).lines.push({
        sku: (row.product_sku || "").trim() || null,
        name: (row.product_name || "").trim() || null,
        qty, unitPrice, discount,
        net: qty * unitPrice - discount,
      });
    }

    const orderList = [...orders.values()];
    if (orderList.length === 0) {
      return res.status(400).json({ error: "No valid orders to import", details: errors });
    }

    // 2. Resolve each customer to an existing profile by email, else mint a new id.
    //    Existing matches attach orders to the current golden record WITHOUT
    //    overwriting its fields; only newly-minted customers create a profile.
    const emails = [...new Set(orderList.map(o => o.email))];
    const { rows: idRows } = await pool.query(
      `SELECT LOWER(identity_value) AS email, member_id
         FROM app.profile_identities
        WHERE company_id = $2 AND identity_type = 'email' AND LOWER(identity_value) = ANY($1)`,
      [emails, companyId]
    );
    const emailToMember = new Map(idRows.map(r => [r.email, r.member_id]));
    const mintedNew = []; // { email, name, customerId }
    for (const o of orderList) {
      if (emailToMember.has(o.email)) { o.customerId = emailToMember.get(o.email); o.isNew = false; }
      else {
        o.customerId = manualCustomerId(capsuiteRef, o.email);
        o.isNew = true;
        if (!mintedNew.find(m => m.customerId === o.customerId)) mintedNew.push({ email: o.email, name: o.name, customerId: o.customerId });
      }
    }

    // Enforce the plan's profile limit against the NEW customers we'd create.
    if (mintedNew.length) {
      const profileCap = await planLimit(pool, companyId, "profiles");
      if (profileCap != null) {
        const { rows: [pc] } = await pool.query(
          "SELECT COUNT(*)::int AS n FROM app.customer_profiles WHERE company_id = $1", [companyId]
        );
        if (pc.n + mintedNew.length > profileCap) {
          return res.status(403).json({
            error: `Importing these orders would create ${mintedNew.length} new profiles, exceeding your plan's ${profileCap}-profile limit (you have ${pc.n}). Upgrade for more.`,
          });
        }
      }
    }

    // 3. One upload batch for provenance / undo.
    const { rows: [batch] } = await pool.query(
      `INSERT INTO manual.upload_batches (company_id, uploaded_by, entity_type, file_name, row_count, status)
       VALUES ($1, $2, 'sale', $3, $4, 'completed') RETURNING id`,
      [companyId, req.user?.id || null, req.file.originalname || null, orderList.length]
    );
    const batchId = batch.id;

    // 4. Upsert new customers (existing ones are left untouched).
    for (const m of mintedNew) {
      const parts = (m.name || "").trim().split(/\s+/);
      const first = parts[0] || null;
      const last = parts.length > 1 ? parts.slice(1).join(" ") : null;
      await pool.query(
        `INSERT INTO commerce.customer (
           customer_id, company_id, capsuite_ref, source_platform, source_id,
           primary_email, has_email, first_name, last_name, full_name, display_name,
           join_date, is_manual, upload_batch_id
         ) VALUES ($1,$2,$3,'manual',$4,$5,true,$6,$7,$8,$8,NOW(),true,$9)
         ON CONFLICT (customer_id) DO UPDATE SET
           primary_email   = EXCLUDED.primary_email,
           has_email       = true,
           full_name       = COALESCE(EXCLUDED.full_name, commerce.customer.full_name),
           display_name    = COALESCE(EXCLUDED.display_name, commerce.customer.display_name),
           is_manual       = true,
           upload_batch_id = EXCLUDED.upload_batch_id`,
        [m.customerId, companyId, capsuiteRef, m.email, m.email, first, last, m.name || null, batchId]
      );
    }

    // 5. Upsert order headers + replace their line items. A bad row (e.g. an
    //    unparseable order_date) is reported and skipped, not fatal to the batch.
    let imported = 0;
    for (const o of orderList) {
      const orderId = manualOrderId(capsuiteRef, o.email, o.orderRef);
      const netAmount = o.lines.reduce((s, l) => s + l.net, 0);
      try {
      await pool.query(
        `INSERT INTO commerce."order" (
           order_id, company_id, capsuite_ref, source_platform, source_id, customer_id,
           order_ref, channel, order_date,
           order_year, order_month, order_day, order_week,
           net_amount, currency, order_status, is_manual, upload_batch_id
         ) VALUES (
           $1,$2,$3,'manual',$4,$5,$6,'manual',$7::timestamptz,
           EXTRACT(YEAR FROM $7::timestamptz)::int, EXTRACT(MONTH FROM $7::timestamptz)::int,
           EXTRACT(DAY FROM $7::timestamptz)::int, EXTRACT(WEEK FROM $7::timestamptz)::int,
           $8,$9,$10,true,$11
         )
         ON CONFLICT (order_id) DO UPDATE SET
           customer_id   = EXCLUDED.customer_id,
           order_ref     = EXCLUDED.order_ref,
           order_date    = EXCLUDED.order_date,
           order_year    = EXCLUDED.order_year,
           order_month   = EXCLUDED.order_month,
           order_day     = EXCLUDED.order_day,
           order_week    = EXCLUDED.order_week,
           net_amount    = EXCLUDED.net_amount,
           currency      = EXCLUDED.currency,
           order_status  = EXCLUDED.order_status,
           is_manual     = true,
           upload_batch_id = EXCLUDED.upload_batch_id`,
        [orderId, companyId, capsuiteRef, o.orderRef, o.customerId, o.orderRef, o.date, netAmount, o.currency, o.status, batchId]
      );

      // Replace this order's lines so a re-import mirrors the file exactly.
      await pool.query(`DELETE FROM commerce.order_line WHERE order_id = $1 AND company_id = $2`, [orderId, companyId]);
      for (let li = 0; li < o.lines.length; li++) {
        const l = o.lines[li];
        await pool.query(
          `INSERT INTO commerce.order_line (
             order_line_id, company_id, capsuite_ref, source_platform, source_id,
             order_id, customer_id, order_date, line_type,
             product_sku, product_name, qty, qty_ordered,
             unit_price_net, discount_amt, currency, is_manual, upload_batch_id
           ) VALUES ($1,$2,$3,'manual',$4,$5,$6,$7::timestamptz,'line_item',
             $8,$9,$10,$10,$11,$12,$13,true,$14)`,
          [`${orderId}_${li}`, companyId, capsuiteRef, o.orderRef, orderId, o.customerId, o.date,
           l.sku, l.name, l.qty, l.unitPrice, l.discount, o.currency, batchId]
        );
      }
      imported++;
      } catch (e) {
        errors.push({ row: o.orderRef, error: `Order ${o.orderRef}: ${String(e.message || e)}` });
      }
    }

    // 6. Rebuild profiles/identities/aggregates from the new commerce rows.
    await refreshCommerceProfiles(pool, companyId);

    res.json({
      ok: true,
      imported,
      newProfiles: mintedNew.length,
      skipped: errors.length,
      batchId,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Commerce: undo a manual order import (delete everything in one batch) ──────
app.delete("/api/commerce/import/batch/:batchId", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  const batchId = req.params.batchId;
  try {
    const { rows: [b] } = await pool.query(
      "SELECT id FROM manual.upload_batches WHERE id = $1 AND company_id = $2 AND entity_type = 'sale'",
      [batchId, companyId]
    );
    if (!b) return res.status(404).json({ error: "Import batch not found" });

    // Customers minted by THIS batch → their auto-created profiles get removed too
    // (identities cascade off app.customer_profiles). Orders attached to pre-existing
    // profiles just lose their rows; the refresh below recomputes those aggregates.
    const { rows: cust } = await pool.query(
      "SELECT customer_id FROM commerce.customer WHERE upload_batch_id = $1 AND company_id = $2",
      [batchId, companyId]
    );
    const mintedIds = cust.map(r => r.customer_id);

    await pool.query("DELETE FROM commerce.order_line WHERE upload_batch_id = $1 AND company_id = $2", [batchId, companyId]);
    await pool.query('DELETE FROM commerce."order" WHERE upload_batch_id = $1 AND company_id = $2', [batchId, companyId]);
    await pool.query("DELETE FROM commerce.customer WHERE upload_batch_id = $1 AND company_id = $2", [batchId, companyId]);
    if (mintedIds.length) {
      await pool.query(
        "DELETE FROM app.customer_profiles WHERE company_id = $1 AND is_manual = true AND member_id = ANY($2)",
        [companyId, mintedIds]
      );
    }
    await pool.query("DELETE FROM manual.upload_batches WHERE id = $1 AND company_id = $2", [batchId, companyId]);

    await refreshCommerceProfiles(pool, companyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Profiles: a customer's commerce transactions (orders + line items) ────────
// Reads the platform-neutral commerce layer (Shopify today; Shopline/Odoo land
// in the same tables tagged by source_platform). Response keys keep the trxn_*
// names the Profiles UI already consumes.
app.get("/api/profiles/customers/:memberId/transactions", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const memberId = req.params.memberId;
    // Most recent orders, each with its line items rolled up as JSON.
    const { rows } = await pool.query(
      `SELECT o.order_id AS trxn_id, o.order_ref AS trxn_ref, o.order_date AS trxn_date,
              o.order_status AS trxn_order_status, o.channel AS trxn_channel,
              o.net_amount AS amount, o.currency, o.source_platform,
              COALESCE((
                SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                         'name', l.product_name, 'sku', l.product_sku, 'category', l.product_type,
                         'type', l.line_type, 'qty', l.qty_ordered,
                         'unit_price', l.unit_price_net
                       ) ORDER BY l.unit_price_net DESC NULLS LAST)
                  FROM commerce.order_line l
                 WHERE l.order_id = o.order_id AND l.company_id = o.company_id
              ), '[]'::jsonb) AS items
         FROM commerce."order" o
        WHERE o.customer_id = $1 AND o.company_id = $2
        ORDER BY o.order_date DESC NULLS LAST
        LIMIT 25`,
      [memberId, companyId]
    );
    // Lifetime summary (counts only real orders, matching the card aggregates).
    const { rows: sum } = await pool.query(
      `SELECT COUNT(*)                     AS order_count,
              COALESCE(SUM(net_amount), 0) AS total_spend,
              MAX(order_date)              AS last_order_date,
              MIN(order_date)              AS first_order_date,
              MODE() WITHIN GROUP (ORDER BY currency) AS currency
         FROM commerce."order"
        WHERE customer_id = $1 AND company_id = $2 AND order_status IN ('completed', 'confirmed')`,
      [memberId, companyId]
    );
    res.json({ orders: rows, summary: sum[0] });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Which (non-archived) segments a single profile currently belongs to. Reuses the
// exact Segments-page predicate builder, scoped to this one entity by id.
async function segmentsForEntity(pool, companyId, scope, entityId) {
  if (!companyId || !entityId) return [];
  const segType = scope === "anonymous" ? "anonymous_profile" : "customer";
  const table = scope === "anonymous" ? "app.anonymous_profiles" : "app.customer_profiles";
  const idcol = scope === "anonymous" ? "visitor_id" : "member_id";
  const { rows: segs } = await pool.query(
    `SELECT id, name, metadata FROM app.segments WHERE company_id = $1 AND segment_type = $2 AND status <> 'archived' ORDER BY name`,
    [companyId, segType]
  );
  const out = [];
  for (const s of segs) {
    const fc = s.metadata?.filter_criteria || {};
    const built = scope === "anonymous" ? anonWhere(fc) : customerWhere(fc);
    const params = [entityId, companyId, ...built.params];
    const shifted = String(built.where || "TRUE").replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 2}`);
    try {
      const r = await pool.query(`SELECT 1 FROM ${table} p WHERE p.${idcol} = $1 AND p.company_id = $2 AND (${shifted}) LIMIT 1`, params);
      if (r.rows.length) out.push({ id: s.id, name: s.name });
    } catch { /* a segment whose criteria can't be evaluated is simply skipped */ }
  }
  return out;
}

// ── Profiles: per-profile insights (Top web / transaction values + touchpoints) ─
// Computed live (GA web data, Shopify sales, EDM/popup/UTM touchpoints) when a
// card is expanded. Device & true engagement-duration aren't in the GA feed, so
// engagement is reported as the user_engagement event count.
app.get("/api/profiles/customers/:memberId/insights", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const memberId = req.params.memberId;
    const prof = await pool.query(
      "SELECT primary_email, COALESCE(ga_visitor_ids, '{}') AS apids FROM app.customer_profiles WHERE member_id = $1 AND company_id = $2",
      [memberId, companyId]
    );
    if (!prof.rows.length) return res.status(404).json({ error: "Profile not found" });
    const email = prof.rows[0].primary_email || "";
    const apids = prof.rows[0].apids || [];
    const hasApids = apids.length > 0;
    const none = { rows: [] };

    const [topPage, topLink, engagement, topAttr, topProduct, topCategory, topChannel, emails, popups, utmLinks] = await Promise.all([
      hasApids ? pool.query(
        `SELECT page_location AS value, COUNT(*)::int AS count FROM ga_landing.path_exploration
          WHERE company_id = $2 AND capsuite_apid = ANY($1) AND event_name = 'page_view' AND page_location <> ''
          GROUP BY page_location ORDER BY count DESC LIMIT 1`, [apids, companyId]) : none,
      hasApids ? pool.query(
        `SELECT link_url AS value, COUNT(*)::int AS count FROM ga_landing.path_exploration
          WHERE company_id = $2 AND capsuite_apid = ANY($1) AND link_url IS NOT NULL AND link_url <> ''
          GROUP BY link_url ORDER BY count DESC LIMIT 1`, [apids, companyId]) : none,
      hasApids ? pool.query(
        `SELECT COUNT(*)::int AS count FROM ga_landing.path_exploration
          WHERE company_id = $2 AND capsuite_apid = ANY($1) AND event_name = 'user_engagement'`, [apids, companyId]) : { rows: [{ count: 0 }] },
      pool.query(
        // Only web-content (behavioral) attributes belong under "Top Web Activity".
        // Manual / rule attributes surface in the card's "Affinities & Attributes" block.
        `SELECT a.name, COALESCE(v.display_label, v.value) AS value, pv.score
           FROM app.profile_attribute_values pv
           JOIN app.attributes a       ON a.id = pv.attribute_id AND a.status = 'active'
           JOIN app.attribute_values v ON v.id = pv.attribute_value_id
          WHERE pv.company_id = $2 AND pv.entity_type = 'customer' AND pv.entity_id = $1
            AND pv.source = 'web_content'
          ORDER BY pv.score DESC LIMIT 1`, [memberId, companyId]),
      pool.query(
        `SELECT product_name AS value, SUM(qty_ordered)::int AS qty FROM commerce.order_line
          WHERE company_id = $2 AND customer_id = $1 AND line_type = 'line_item' AND product_name IS NOT NULL
          GROUP BY product_name ORDER BY qty DESC NULLS LAST LIMIT 1`, [memberId, companyId]),
      pool.query(
        `SELECT product_type AS value, SUM(qty_ordered)::int AS qty FROM commerce.order_line
          WHERE company_id = $2 AND customer_id = $1 AND product_type IS NOT NULL AND product_type <> ''
          GROUP BY product_type ORDER BY qty DESC NULLS LAST LIMIT 1`, [memberId, companyId]),
      pool.query(
        `SELECT channel AS value, COUNT(*)::int AS count FROM commerce."order"
          WHERE company_id = $2 AND customer_id = $1 AND channel IS NOT NULL AND channel <> ''
          GROUP BY channel ORDER BY count DESC LIMIT 1`, [memberId, companyId]),
      email ? pool.query(
        `SELECT ec.name AS campaign, es.status, es.sent_at,
                BOOL_OR(ee.event_type = 'open')  AS opened,
                BOOL_OR(ee.event_type = 'click') AS clicked
           FROM app.edm_sends es
           JOIN app.edm_campaigns ec ON ec.id = es.edm_campaign_id
           LEFT JOIN app.edm_events ee ON ee.send_id = es.id
          WHERE es.company_id = $2 AND LOWER(es.email) = LOWER($1)
          GROUP BY ec.name, es.status, es.sent_at
          ORDER BY es.sent_at DESC NULLS LAST LIMIT 10`, [email, companyId]) : none,
      pool.query(
        `SELECT DISTINCT ON (COALESCE(popup_name, popup_ref)) COALESCE(popup_name, popup_ref) AS name, collected_at AS at
           FROM app.popup_email_collected
          WHERE company_id = $3 AND (($1 <> '' AND LOWER(email) = LOWER($1)) OR (CARDINALITY($2::text[]) > 0 AND visitor_id = ANY($2)))
          ORDER BY COALESCE(popup_name, popup_ref), collected_at DESC LIMIT 10`, [email, apids, companyId]),
      hasApids ? pool.query(
        `SELECT DISTINCT c.name, c.utm_source, c.utm_medium, c.utm_campaign, c.utm_term, c.utm_content, c.base_url
           FROM ga_landing.path_exploration pe
           JOIN app.campaigns c ON c.utm_campaign = pe.session_campaign_name AND c.company_id = $2
          WHERE pe.company_id = $2 AND pe.capsuite_apid = ANY($1)
            AND pe.session_campaign_name <> '' AND pe.session_campaign_name <> '(not set)'
          LIMIT 10`, [apids, companyId]) : none,
    ]);

    const segments = await segmentsForEntity(pool, companyId, "customer", memberId);

    res.json({
      web: {
        top_page: topPage.rows[0] || null,
        top_outbound_link: topLink.rows[0] || null,
        engagement_events: engagement.rows[0]?.count || 0,
        top_content_attribute: topAttr.rows[0] || null,
      },
      transactions: {
        top_product: topProduct.rows[0] || null,
        top_category: topCategory.rows[0] || null,
        top_channel: topChannel.rows[0] || null,
      },
      segments,
      touchpoints: { emails: emails.rows, popups: popups.rows, utm_links: utmLinks.rows },
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/profiles/anonymous/:visitorId/insights", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const vid = req.params.visitorId;
    const [topPage, topLink, engagement, topAttr, popups, utmLinks] = await Promise.all([
      pool.query(
        `SELECT page_location AS value, COUNT(*)::int AS count FROM ga_landing.path_exploration
          WHERE company_id = $2 AND capsuite_apid = $1 AND event_name = 'page_view' AND page_location <> ''
          GROUP BY page_location ORDER BY count DESC LIMIT 1`, [vid, companyId]),
      pool.query(
        `SELECT link_url AS value, COUNT(*)::int AS count FROM ga_landing.path_exploration
          WHERE company_id = $2 AND capsuite_apid = $1 AND link_url IS NOT NULL AND link_url <> ''
          GROUP BY link_url ORDER BY count DESC LIMIT 1`, [vid, companyId]),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM ga_landing.path_exploration
          WHERE company_id = $2 AND capsuite_apid = $1 AND event_name = 'user_engagement'`, [vid, companyId]),
      pool.query(
        // Only web-content (behavioral) attributes belong under "Top Web Activity".
        // Manual / rule attributes surface in the card's "Affinities & Attributes" block.
        `SELECT a.name, COALESCE(v.display_label, v.value) AS value, pv.score
           FROM app.profile_attribute_values pv
           JOIN app.attributes a       ON a.id = pv.attribute_id AND a.status = 'active'
           JOIN app.attribute_values v ON v.id = pv.attribute_value_id
          WHERE pv.company_id = $2 AND pv.entity_type = 'anonymous' AND pv.entity_id = $1
            AND pv.source = 'web_content'
          ORDER BY pv.score DESC LIMIT 1`, [vid, companyId]),
      pool.query(
        `SELECT DISTINCT ON (COALESCE(popup_name, popup_ref)) COALESCE(popup_name, popup_ref) AS name, collected_at AS at
           FROM app.popup_email_collected WHERE company_id = $2 AND visitor_id = $1
          ORDER BY COALESCE(popup_name, popup_ref), collected_at DESC LIMIT 10`, [vid, companyId]),
      pool.query(
        `SELECT DISTINCT c.name, c.utm_source, c.utm_medium, c.utm_campaign, c.utm_term, c.utm_content, c.base_url
           FROM ga_landing.path_exploration pe
           JOIN app.campaigns c ON c.utm_campaign = pe.session_campaign_name AND c.company_id = $2
          WHERE pe.company_id = $2 AND pe.capsuite_apid = $1
            AND pe.session_campaign_name <> '' AND pe.session_campaign_name <> '(not set)'
          LIMIT 10`, [vid, companyId]),
    ]);

    // Pop-ups actually seen/clicked - from the interaction service's activity log
    // (keyed by capsuite_apid = visitor_id). Guarded: that schema may be absent.
    let popupsSeen = [];
    const actReg = await pool.query(`SELECT to_regclass('interaction.activities') AS t`);
    if (actReg.rows[0]?.t) {
      const seen = await pool.query(
        `SELECT pu.name,
                MIN(ia.created_at) AS at,
                BOOL_OR(ia.action ILIKE '%click%') AS clicked
           FROM interaction.activities ia
           JOIN interaction.interactions ii ON ii.id = ia.correlated_interaction_id
           JOIN app.popups pu ON pu.cdp_reference_id = ii.cdp_reference_id
          WHERE ia.capsuite_apid = $1 AND pu.company_id = $2
          GROUP BY pu.name
          ORDER BY MIN(ia.created_at) DESC LIMIT 10`, [vid, companyId]);
      popupsSeen = seen.rows;
    }

    const segments = await segmentsForEntity(pool, companyId, "anonymous", vid);

    res.json({
      web: {
        top_page: topPage.rows[0] || null,
        top_outbound_link: topLink.rows[0] || null,
        engagement_events: engagement.rows[0]?.count || 0,
        top_content_attribute: topAttr.rows[0] || null,
      },
      segments,
      touchpoints: { emails: [], popups: popups.rows, popups_seen: popupsSeen, utm_links: utmLinks.rows },
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Segments: export matching profiles + criteria as CSV ─────────────────────
// Renders a segment's filter_criteria into a human-readable summary (the criteria
// every exported profile validates), resolves the matching profiles live, and
// streams a CSV with a leading "# ..." criteria preamble followed by the rows.
function summarizeCriteria(fc) {
  const out = [];
  const arr = (k, label) => { const v = fc[k]; if (Array.isArray(v) ? v.length : v) out.push(`${label}: ${Array.isArray(v) ? v.join("/") : v}`); };
  arr("reg_channel", "channel"); arr("education_level", "education"); arr("age_group", "age group");
  arr("gender", "gender"); arr("nationality", "nationality"); arr("preferred_language", "language");
  arr("employment_status", "employment"); arr("income_level", "income"); arr("member_type", "member type");
  arr("preferred_channel", "preferred channel"); arr("source_medium", "source/medium");
  arr("source", "source"); arr("medium", "medium"); arr("campaign", "campaign");
  if (fc.min_page_views) out.push(`${fc.min_page_views}+ page views`);
  if (fc.max_page_views) out.push(`<= ${fc.max_page_views} page views`);
  if (fc.min_sessions) out.push(`${fc.min_sessions}+ visits`);
  if (fc.max_sessions) out.push(`<= ${fc.max_sessions} visits`);
  if (fc.min_engagement) out.push(`${fc.min_engagement}+ engagement`);
  if (fc.max_engagement) out.push(`<= ${fc.max_engagement} engagement`);
  if (fc.visited_within) out.push(`visited in last ${fc.visited_within} days`);
  if (fc.is_opt_in_email === "true" || fc.is_opt_in_email === true) out.push("email opted-in");
  if (fc.opt_in_sms === "true") out.push("SMS opted-in");
  if (fc.is_subscriber === "true") out.push("subscriber only");
  if (fc.has_ga_activity === "true") out.push("has web activity");
  if (fc.min_ga_sessions) out.push(`${fc.min_ga_sessions}+ GA sessions`);
  if (fc.max_ga_sessions) out.push(`<= ${fc.max_ga_sessions} GA sessions`);
  if (fc.has_seminars === "true") out.push("attended seminar");
  if (fc.has_attributes === "true") out.push("has attributes");
  if (fc.has_transactions === "true") out.push("has purchases");
  if (fc.min_orders) out.push(`${fc.min_orders}+ orders`);
  if (fc.max_orders) out.push(`<= ${fc.max_orders} orders`);
  if (fc.min_spend) out.push(`${fc.min_spend}+ spend`);
  if (fc.max_spend) out.push(`<= ${fc.max_spend} spend`);
  if (fc.ordered_within) out.push(`ordered in last ${fc.ordered_within} days`);
  if (fc.has_form_complete === "true") out.push("completed a form");
  if (Array.isArray(fc.attribute_value_ids) && fc.attribute_value_ids.length) out.push(`${fc.attribute_value_ids.length} attribute value(s)`);
  return out;
}

// Live member count for a segment (used by the Segments cards).
app.get("/api/segments/:id/size", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM app.segments
        WHERE id = $1 AND company_id = $2 AND (visibility = 'company' OR created_by = $3)`,
      [req.params.id, companyId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Segment not found" });
    const count = await countSegmentEntities(pool, companyId, req.params.id);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Live member count for UNSAVED criteria (used by the create/edit form to preview
// how many profiles a segment would match before it's saved). Same filter logic as
// countSegmentEntities, but reads filter_criteria from the request body.
app.post("/api/segments/preview-count", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const fc = req.body?.filter_criteria || {};
    const isCustomer = (req.body?.segment_type || "customer") === "customer";
    const { where, params } = isCustomer ? customerWhere(fc) : anonWhere(fc);
    params.push(companyId);
    const table = isCustomer ? "app.customer_profiles" : "app.anonymous_profiles";
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ${table} p WHERE (${where}) AND p.company_id = $${params.length}`,
      params
    );
    res.json({ count: r.rows[0].n });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/segments/:id/export", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const { rows: segRows } = await pool.query(
      `SELECT id, name, segment_type, metadata FROM app.segments
        WHERE id = $1 AND company_id = $2 AND (visibility = 'company' OR created_by = $3)`,
      [req.params.id, companyId, req.user.id]
    );
    if (!segRows.length) return res.status(404).json({ error: "Segment not found" });
    const seg = segRows[0];
    const fc = seg.metadata?.filter_criteria || {};
    const criteria = summarizeCriteria(fc);
    const { entityType, ids } = await resolveSegmentEntities(pool, companyId, seg.id);

    const csvCell = (v) => {
      if (v == null) return "";
      let s = Array.isArray(v) ? v.join("; ") : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    let columns, rows;
    if (entityType === "customer") {
      columns = ["member_id", "primary_email", "primary_phone", "eng_full_name", "member_no", "member_reg_channel",
        "member_type", "age_group", "gender", "nationality", "education_level", "income_level", "employment_status",
        "preferred_language", "preferred_channel", "is_opt_in_email", "is_opt_in_sms", "is_subscriber_only",
        "ga_sessions", "seminar_count", "attribute_count", "member_join_date", "tags"];
      rows = ids.length ? (await pool.query(
        `SELECT ${columns.join(", ")} FROM app.customer_profiles WHERE member_id = ANY($1::text[]) AND company_id = $2 ORDER BY member_join_date DESC NULLS LAST`,
        [ids, companyId]
      )).rows : [];
    } else {
      columns = ["visitor_id", "first_seen", "last_seen", "sessions", "page_views", "total_events",
        "form_starts", "form_completes", "top_source_medium", "top_campaign"];
      rows = ids.length ? (await pool.query(
        `SELECT ${columns.join(", ")} FROM app.anonymous_profiles WHERE visitor_id = ANY($1::text[]) AND company_id = $2 ORDER BY last_seen DESC NULLS LAST`,
        [ids, companyId]
      )).rows : [];
    }

    const lines = [
      `# Segment: ${seg.name || "Untitled"}`,
      `# Type: ${seg.segment_type}`,
      `# Criteria validated by every profile below: ${criteria.length ? criteria.join("; ") : "none (all profiles)"}`,
      `# Profiles: ${rows.length}`,
      columns.join(","),
      ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")),
    ];
    const safeName = (seg.name || "segment").replace(/[^a-z0-9\-_]+/gi, "_").toLowerCase();
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="segment_${safeName}.csv"`);
    res.send(lines.join("\n"));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Dashboard layout visibility (server-side privacy boundary) ───────────────
// The dashboard layout is one company-shared document, but individual TABS can
// be private to their creator. These helpers enforce that at the API layer, so a
// member can never retrieve OR overwrite another member's private tab (its name,
// chart assignments) even by calling the settings endpoint directly - the UI
// filter is only a convenience; this is the actual boundary.
const DASHBOARD_LAYOUT_KEY = "dashboard_layout";

// A tab is visible to a user if it's public (default when unset) or they made it.
function tabVisibleTo(tab, userId) {
  return tab?.visibility !== "private" || tab?.created_by === userId;
}

function parseLayout(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

// Strip tabs (and their assignments) the user may not see. Returns a JSON string;
// non-parseable/empty values pass through untouched so non-layout data is safe.
function filterDashboardLayout(value, userId) {
  const layout = parseLayout(value);
  if (!layout || !Array.isArray(layout.tabs)) return value;
  const visibleTabs = layout.tabs.filter(t => tabVisibleTo(t, userId));
  const visibleIds = new Set(visibleTabs.map(t => t.id));
  const tabAssignments = {};
  for (const [tabId, arr] of Object.entries(layout.tabAssignments || {})) {
    if (visibleIds.has(tabId)) tabAssignments[tabId] = arr;
  }
  return JSON.stringify({ ...layout, tabs: visibleTabs, tabAssignments });
}

// Merge a user's edited (visible-only) layout back into the full stored layout,
// preserving other members' private tabs + their assignments. Hidden tabs are
// re-anchored after the visible tab that preceded them in the stored order.
function mergeDashboardLayout(incomingValue, storedValue, userId) {
  const incoming = parseLayout(incomingValue) || { tabs: [], tabAssignments: {}, chartSizes: {} };
  const stored = parseLayout(storedValue) || { tabs: [], tabAssignments: {}, chartSizes: {} };
  const canSee = (t) => tabVisibleTo(t, userId);

  const storedTabs = Array.isArray(stored.tabs) ? stored.tabs : [];
  const incomingTabs = Array.isArray(incoming.tabs) ? incoming.tabs : [];
  const hidden = storedTabs.filter(t => !canSee(t));

  let mergedTabs;
  if (!hidden.length) {
    mergedTabs = incomingTabs;
  } else {
    const anchorOf = new Map();
    let lastVisibleId = null;
    for (const t of storedTabs) {
      if (canSee(t)) lastVisibleId = t.id;
      else anchorOf.set(t.id, lastVisibleId);
    }
    const byAnchor = new Map();
    for (const h of hidden) {
      const a = anchorOf.get(h.id) ?? null;
      if (!byAnchor.has(a)) byAnchor.set(a, []);
      byAnchor.get(a).push(h);
    }
    mergedTabs = [];
    for (const h of byAnchor.get(null) || []) mergedTabs.push(h);
    for (const vt of incomingTabs) {
      mergedTabs.push(vt);
      for (const h of byAnchor.get(vt.id) || []) mergedTabs.push(h);
    }
    const emitted = new Set(mergedTabs.map(t => t.id));
    for (const h of hidden) if (!emitted.has(h.id)) mergedTabs.push(h);
  }

  // Assignments: visible tabs take the user's latest; hidden tabs keep stored.
  const tabAssignments = {};
  for (const tab of mergedTabs) {
    tabAssignments[tab.id] = canSee(tab)
      ? (incoming.tabAssignments?.[tab.id] ?? stored.tabAssignments?.[tab.id] ?? [])
      : (stored.tabAssignments?.[tab.id] ?? []);
  }
  // Chart sizes are keyed by chartId (a chart can sit on several tabs), so keep
  // stored sizes and layer the user's changes on top - matches prior behaviour.
  const chartSizes = { ...(stored.chartSizes || {}), ...(incoming.chartSizes || {}) };

  return JSON.stringify({ ...stored, ...incoming, tabs: mergedTabs, tabAssignments, chartSizes });
}

// ── Settings ─────────────────────────────────────────────────────────────────
app.get("/api/settings", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  try {
    const { rows } = await pool.query(
      "SELECT key, value, label, updated_date FROM app.settings WHERE company_id = $1 ORDER BY key",
      [companyId]
    );
    const settings = Object.fromEntries(rows.map(r => {
      // Enforce per-user tab privacy before the layout ever leaves the server.
      const value = r.key === DASHBOARD_LAYOUT_KEY ? filterDashboardLayout(r.value, req.user.id) : r.value;
      return [r.key, { value, label: r.label, updated_date: r.updated_date }];
    }));
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.put("/api/settings/:key", authenticate, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not configured" });
  const companyId = await companyGuard(req, res);
  if (!companyId) return;
  const { key } = req.params;
  const { value, label } = req.body;

  // The dashboard layout is a shared document with per-user-private tabs. Merge
  // the incoming (visible-only) layout into the stored full doc under a row lock
  // so a member's save can't drop or expose another member's private tabs, and
  // concurrent saves serialise instead of clobbering each other.
  if (key === DASHBOARD_LAYOUT_KEY) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: existing } = await client.query(
        "SELECT value FROM app.settings WHERE company_id = $1 AND key = $2 FOR UPDATE",
        [companyId, key]
      );
      const merged = mergeDashboardLayout(value, existing[0]?.value, req.user.id);
      const { rows } = await client.query(
        `INSERT INTO app.settings (company_id, key, value, label, updated_date)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (company_id, key)
         DO UPDATE SET value = EXCLUDED.value, label = COALESCE(EXCLUDED.label, app.settings.label), updated_date = NOW()
         RETURNING *`,
        [companyId, key, merged, label ?? null]
      );
      await client.query("COMMIT");
      // Never echo the full doc back - filter to what the caller may see.
      res.json({ ...rows[0], value: filterDashboardLayout(rows[0].value, req.user.id) });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      res.status(500).json({ error: String(err.message || err) });
    } finally {
      client.release();
    }
    return;
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO app.settings (company_id, key, value, label, updated_date)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (company_id, key)
       DO UPDATE SET value = EXCLUDED.value, label = COALESCE(EXCLUDED.label, app.settings.label), updated_date = NOW()
       RETURNING *`,
      [companyId, key, value ?? null, label ?? null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── EDM routes ───────────────────────────────────────────────────────────────
if (pool) {
  app.use("/api/edm", createEdmRouter(pool));
}

// ── Data Integration routes ───────────────────────────────────────────────────
if (pool) {
  app.use("/api/data-integrations", createIntegrationsRouter(pool, { refreshCommerceProfiles }));
}

// ── Popup routes ──────────────────────────────────────────────────────────────
if (pool) {
  app.use("/api/popups", createPopupRouter(pool));
}

// ── UTM analytics routes (company-scoped) ──────────────────────────────────────
if (pool) {
  app.use("/api/utm", createUtmRouter(pool));
}

// ── Attributes routes ─────────────────────────────────────────────────────────
if (pool) {
  // Public webhook the content_scrape Airflow DAG calls when scraping finishes.
  // Registered BEFORE the authenticated router so it is reachable without a token
  // (Airflow has no session); it identifies the tenant by company_id in the body.
  app.post("/api/attributes/webhook/scrape-complete", async (req, res) => {
    try {
      const { company_id, job_id, changed = 0 } = req.body || {};
      if (!company_id) return res.status(400).json({ error: "company_id required" });
      // A user-initiated "Crawl pages only" run is a 'refresh' job: complete it but
      // do NOT auto-tag, so the user can review/exclude pages and dry-run attributes
      // before committing to a full reconstruct. Other scrapes (escalations, etc.)
      // still auto-tag the pages they changed.
      let crawlOnly = false;
      if (job_id) {
        const { rows } = await pool.query(
          `UPDATE app.attribute_jobs SET status='completed', phase='done', completed_at=NOW()
           WHERE id=$1 AND company_id=$2 AND status IN ('queued','running')
           RETURNING job_type`,
          [job_id, company_id]
        );
        crawlOnly = rows[0]?.job_type === "refresh";
      }
      // If pages changed/were added, run the Node tag phase for them.
      if (Number(changed) > 0 && !crawlOnly) {
        const { rows: busy } = await pool.query(
          `SELECT id FROM app.attribute_jobs WHERE company_id=$1 AND status IN ('queued','running') AND job_type IN ('tag','behavioral') LIMIT 1`,
          [company_id]
        );
        if (!busy.length) {
          await pool.query(
            `INSERT INTO app.attribute_jobs (company_id, job_type, status, phase) VALUES ($1,'tag','queued','queued')`,
            [company_id]
          );
          processNextAttributeJob(pool).catch((e) => console.error("[attr] scrape-webhook kick failed:", e.message));
        }
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.use("/api/attributes", createAttributesRouter(pool));
}

// ── EDM tracking endpoints (open pixel + click redirect + unsubscribe) ────────
// These are intentionally outside /api so URLs are short and clean.

// Open pixel - 1x1 transparent GIF
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
  } catch { /* silent - don't break pixel response */ }
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
// Authenticated + workspace-scoped: files are stored under a per-company folder
// (uploads/<companyId>/…) so the analyst's file-reader can verify ownership and
// one tenant can't read another's uploads by guessing a filename.
app.post("/api/integrations/upload", authenticate, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const companyId = await companyGuard(req, res);
  if (!companyId) { try { fs.unlinkSync(req.file.path); } catch {} return; }
  const safeName = `${Date.now()}-${req.file.originalname}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const dir = path.join(uploadsDir, companyId);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, safeName);
  fs.renameSync(req.file.path, finalPath);
  // Return absolute URL so images work inside email HTML sent via Resend
  const origin = process.env.BACKEND_URL || `${req.protocol}://${req.get("host")}`;
  res.json({ file_url: `${origin}/uploads/${companyId}/${safeName}`, relative_url: `/uploads/${companyId}/${safeName}` });
});

// ── Route registration (module-level - happens at process start, not after DB init) ───
// Registering here means routes are always available regardless of initDb() timing or failures.
if (pool) {
  app.use("/api/plans", createPlansRouter(pool));
  app.use("/api/auth", createAuthRouter(pool));
  app.use("/api/companies", createCompanyRouter(pool));
  app.use("/api/account", createAccountRouter(pool));
  app.use("/api/billing", createBillingRouter(pool));
  app.use("/api/admin", createAdminRouter(pool));
  app.use("/api/support", createSupportRouter(pool));
  app.use("/api/notifications", createNotificationsRouter(pool));
  app.use("/api/announcements", createAnnouncementsRouter(pool));
} else {
  // Fallback local-mode (no DB) - return static data so the UI is usable
  app.get("/api/plans", (_req, res) => res.json(FALLBACK_PLANS));
  const LOCAL_COMPANY = { id: "local-company", name: "Local Workspace", slug: "local", plan: "standard", role: "owner", logo_url: null, created_date: new Date().toISOString() };
  app.get("/api/auth/me", (_req, res) =>
    res.json({ id: "local-user", email: "local@cdp-click-ai", role: "admin", full_name: "Local User", companies: [LOCAL_COMPANY] })
  );
  app.post("/api/auth/logout", (_req, res) => res.json({ ok: true }));
  app.post("/api/companies", (_req, res) => res.status(503).json({ error: "Database not configured - cannot create company without a DB connection." }));
}

// ── Production static serving ─────────────────────────────────────────────────
// MUST be registered AFTER every /api route. The SPA catch-all matches every GET,
// so registering it earlier shadows API GET endpoints (e.g. /api/auth/me) and
// returns index.html instead of JSON. The /api guard lets unmatched API GETs fall
// through to a real 404 instead of the SPA. Only active when a built dist/ exists.
if (process.env.NODE_ENV === "production") {
  const distDir = path.join(rootDir, "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(distDir, "index.html"));
    });
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
      console.error("  MCP: Failed to initialize - ", err.message);
    }
  }

  app.listen(port, () => {
    console.log(`cdp-click-ai server running on http://localhost:${port}`);
    console.log(`  AI: ${aiClient ? `Azure OpenAI (analyst: ${azureDeployment}, fast: ${azureDeploymentFast})` : "NOT CONFIGURED"}`);
    console.log(`  DB: ${pool ? "Postgres connected" : "NOT CONFIGURED"}`);
  });

  // ── EDM scheduled campaign cron (runs every minute) ──────────────────────
  // DISABLED by default. The fire-and-forget POST below carries no auth /
  // x-company-id, so the /send endpoint rejects it before the campaign leaves
  // 'scheduled' - causing it to re-fire (and attempt to re-send) every minute.
  // Re-enable only once the send is invoked with proper internal auth or by
  // calling the send logic directly and claiming the campaign atomically.
  if (pool && process.env.ENABLE_EDM_CRON === "true") {
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
  } else {
    console.log("  EDM: Scheduled campaign cron DISABLED (set ENABLE_EDM_CRON=true to enable)");
  }

  // ── Nightly segment re-sync (2:00 AM every day) ──────────────────────────
  // Re-resolves capsuite_apid lists for all active popups whose segment has daily_refresh=true,
  // then pushes the updated rules to the interaction service.
  if (pool) {
    cron.schedule("0 2 * * *", async () => {
      console.log("[Segment cron] Starting nightly segment re-sync...");
      try {
        const INTERACTION_SERVICE_URL = process.env.INTERACTION_SERVICE_URL || "http://localhost:8080";

        // Find all segments with daily_refresh enabled
        const { rows: segments } = await pool.query(`
          SELECT id, company_id, segment_type, metadata
          FROM app.segments
          WHERE daily_refresh = true AND status = 'active'
        `);

        for (const seg of segments) {
          try {
            // Resolve the segment to fresh capsuite_apid list (reuse existing helper logic)
            const filterCriteria = seg.metadata?.filter_criteria || null;
            const { buildSegmentWhere } = await import("./routes/popup.js");

            // Find all active popups using this segment
            const { rows: popups } = await pool.query(`
              SELECT p.*, c.settings AS company_settings
              FROM app.popups p
              JOIN app.companies c ON c.id = p.company_id
              WHERE p.is_active = true
                AND p.company_id = $1
                AND (
                  p.rules->>'anonymous_segment_id' = $2
                  OR p.rules->>'customer_segment_id' = $2
                )
            `, [seg.company_id, seg.id]);

            if (!popups.length) continue;

            // Get interaction service company ID (dedicated column in the new schema)
            const { rows: companyRows } = await pool.query(
              `SELECT interaction_service_company_id FROM app.companies WHERE id = $1`, [seg.company_id]
            );
            const isCompanyId = companyRows[0]?.interaction_service_company_id;
            if (!isCompanyId) continue;

            for (const popup of popups) {
              try {
                // Re-resolve both segment types for this popup
                const rules = popup.rules || {};
                let resolvedApids = [];

                // Simple inline resolution - mirrors buildInteractionPayload logic
                const resolveSegment = async (segId) => {
                  if (!segId) return [];
                  const { rows } = await pool.query(
                    `SELECT segment_type, metadata FROM app.segments WHERE id = $1`, [segId]
                  );
                  if (!rows.length) return [];
                  const { segment_type } = rows[0];
                  let sql;
                  if (segment_type === "customer") {
                    // Known customers' anonymous web ids live on the unified profile.
                    sql = `SELECT DISTINCT vid AS capsuite_apid
                           FROM app.customer_profiles cp
                           CROSS JOIN LATERAL unnest(COALESCE(cp.ga_visitor_ids, '{}')) AS vid
                           WHERE cp.company_id = $1 AND vid IS NOT NULL AND vid != '' LIMIT 5000`;
                  } else {
                    // Unresolved visitors: GA apids not linked to any customer in this company.
                    sql = `SELECT DISTINCT pe.capsuite_apid FROM ga_landing.path_exploration pe
                           WHERE pe.company_id = $1 AND pe.capsuite_apid IS NOT NULL AND pe.capsuite_apid != ''
                             AND NOT EXISTS (SELECT 1 FROM app.profile_identities pi
                               WHERE pi.company_id = $1 AND pi.identity_type = 'anonymous_id' AND pi.identity_value = pe.capsuite_apid)
                           LIMIT 5000`;
                  }
                  const result = await pool.query(sql, [seg.company_id]);
                  return result.rows.map(r => r.capsuite_apid).filter(Boolean);
                };

                const anonApids = await resolveSegment(rules.anonymous_segment_id);
                const custApids = await resolveSegment(rules.customer_segment_id);
                resolvedApids = [...new Set([...anonApids, ...custApids])];

                const updatedRules = {
                  ...rules,
                  ...(resolvedApids.length ? { list_capsuite_apid: resolvedApids } : {}),
                };

                // Push to interaction service
                await fetch(`${INTERACTION_SERVICE_URL}/interaction/update`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: popup.name,
                    companyId: isCompanyId,
                    interactionType: popup.interaction_type,
                    cdpReferenceId: popup.cdp_reference_id,
                    rules: updatedRules,
                    content: popup.content || "",
                    defaultRecommendation: popup.default_recommendation || {},
                    isActive: popup.is_active,
                    isDefault: popup.is_default,
                    startTime: popup.start_time ? new Date(popup.start_time).toISOString() : new Date().toISOString(),
                    endTime: popup.end_time ? new Date(popup.end_time).toISOString() : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
                    customer: {},
                  }),
                });
              } catch (popupErr) {
                console.error(`[Segment cron] Failed to re-sync popup ${popup.id}:`, popupErr.message);
              }
            }

            // Mark segment as refreshed
            await pool.query(
              `UPDATE app.segments SET last_refreshed = NOW() WHERE id = $1`, [seg.id]
            );
            console.log(`[Segment cron] Re-synced segment ${seg.id}`);
          } catch (segErr) {
            console.error(`[Segment cron] Failed for segment ${seg.id}:`, segErr.message);
          }
        }
        console.log(`[Segment cron] Done. Processed ${segments.length} segment(s).`);
      } catch (e) {
        console.error("[Segment cron] Fatal error:", e.message);
      }
    });
    console.log("  Segment: Nightly re-sync cron scheduled (2:00 AM daily)");
  }

  // ── Nightly rule-attribute daily refresh (2:30 AM) ───────────────────────
  // Re-derives every active rule attribute with daily_refresh on (add + drop).
  // Rule attributes with daily refresh off stay frozen until a manual reapply.
  if (pool) {
    cron.schedule("30 2 * * *", async () => {
      try {
        const r = await runDailyRuleRefresh(pool);
        if (r.total) console.log(`[Rule refresh] Re-derived ${r.refreshed}/${r.total} daily-refresh rule attribute(s).`);
      } catch (e) {
        console.error("[Rule refresh] Fatal error:", e.message);
      }
    });
    console.log("  Attributes: Nightly rule daily-refresh cron scheduled (2:30 AM daily)");
  }

  // ── Nightly test-link rollup + daily refresh (2:45 AM) ───────────────────
  // Rebuilds the page-rank rollup (the expensive GA aggregation, once/night) for
  // every GA-connected company, then re-syncs the GA test links for companies in
  // 'daily' mode. 'static' companies keep their frozen set and read the fresh
  // rollup only when they click "Load top 50".
  if (pool) {
    cron.schedule("45 2 * * *", async () => {
      try {
        const r = await runDailyTestLinkRefresh(pool);
        if (r.ranked) console.log(`[Test-links refresh] Rebuilt rollup for ${r.ranked} company(ies); synced ${r.synced} daily-mode set(s).`);
      } catch (e) {
        console.error("[Test-links refresh] Fatal error:", e.message);
      }
    });
    console.log("  Attributes: Nightly test-link rollup cron scheduled (2:45 AM daily)");
  }

  // ── Nightly dashboard-chart refresh (3:00 AM) ────────────────────────────
  // Re-runs the stored SELECT for every pinned chart with auto-refresh on, so the
  // dashboard is fresh even when nobody opens it (the client-side refresh only
  // fires on a Dashboard visit). Charts with auto_refresh:false or no stored query
  // are skipped and keep their snapshot. Failures are recorded on the chart
  // (metadata.last_refresh_error, surfaced in the UI) and logged, not swallowed.
  if (pool) {
    cron.schedule("0 3 * * *", async () => {
      try {
        const { rows: charts } = await pool.query(
          `SELECT * FROM app.pinned_charts
            WHERE query IS NOT NULL AND btrim(query) <> ''
              AND COALESCE(metadata->>'auto_refresh', 'true') <> 'false'`
        );
        let ok = 0, failed = 0;
        for (const c of charts) {
          const r = await refreshChartData(pool, c, c.company_id);
          if (r.status === "refreshed") ok++;
          else if (r.status === "failed" || r.status === "invalid") {
            failed++;
            console.error(`[Chart refresh] Chart ${c.id} failed: ${r.error}`);
          }
        }
        if (charts.length) console.log(`[Chart refresh] Refreshed ${ok}/${charts.length} chart(s); ${failed} failed.`);
      } catch (e) {
        console.error("[Chart refresh] Fatal error:", e.message);
      }
    });
    console.log("  Dashboard: Nightly chart refresh cron scheduled (3:00 AM daily)");
  }

  // ── No nightly profile cron (intentionally) ────────────────────────────────
  // Profile data is rebuilt event-driven, never on a timer: the GA orchestrator
  // triggers build_profile_mapping (incremental) after every daily GA sync (which
  // also recomputes ALL customer roll-ups + prunes aged-out visitors), the commerce
  // webhook calls refreshCommerceProfiles() after a store sync, and popup
  // email-collection links visitors in real time. Between those events the GA tables
  // are static, so
  // a nightly rebuild would only re-do identical work. A manual "Sync Data" run does
  // a full 90d rebuild on demand if a from-scratch refresh is ever wanted.

  // ── Integration sync queue worker ─────────────────────────────────────────
  if (pool) {
    startIntegrationQueueWorker(pool);
  }

  // ── Attribute reconstruct queue worker ────────────────────────────────────
  if (pool) {
    startAttributeQueueWorker(pool);
  }

  // ── Notification scan worker (new-leads polling + weekly summary) ──────────
  if (pool) {
    startNotificationScanWorker(pool);
  }
}

start().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});
