import { Router } from "express";
import crypto from "crypto";
import { authenticate, resolveCompanyId } from "../middleware/auth.js";
import { runConnectionTest } from "../lib/integrationConnectors.js";
import { processNextJob } from "../lib/integrationQueue.js";
import { notifyCompany } from "../lib/notifications.js";
import { encryptConfig, decryptConfig, redactConfig } from "../lib/configCrypto.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// Stable hash of the *secret/identity* part of a connection's plaintext config.
// Two workspaces in the same account may not connect the same underlying data
// source (GA property, GSC site, Shopify store), so we fingerprint that identity
// and enforce uniqueness per account. Computed from PLAINTEXT config (before
// encryption) so the same source always yields the same fingerprint.
//
// MUST match the DB function app.credential_fingerprint(secret) = sha256(lower(trim(secret)))
// and the seed's prefix convention (ga|… / gsc|… / shopify|…) so every path agrees.
function credentialSecret(type, config) {
  if (type === "googleAnalytics")    return config?.propertyId ? `ga|${config.propertyId}` : null;
  if (type === "googleSearchConsole") return config?.siteUrl    ? `gsc|${config.siteUrl}`   : null;
  if (type === "shopify" || type === "shopifyCustomApp") return config?.storeName ? `shopify|${config.storeName}` : null;
  return null;
}
function credentialFingerprint(type, config) {
  const secret = credentialSecret(type, config);
  if (!secret) return null;
  // identical transform to app.credential_fingerprint(): sha256(lower(trim(secret)))
  return crypto.createHash("sha256").update(secret.trim().toLowerCase()).digest("hex");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Pure-JS ZIP builder (no external dependencies) ───────────────────────────
// Builds a ZIP archive with STORED method (no compression).
// Returns a Buffer containing a valid .zip file.

function crc32(buf) {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files) {
  // files: [{ name: string, data: Buffer }]
  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf  = Buffer.from(file.name, "utf8");
    const data     = file.data;
    const crc      = crc32(data);
    const size     = data.length;

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);  // signature
    localHeader.writeUInt16LE(20, 4);           // version needed
    localHeader.writeUInt16LE(0, 6);            // flags
    localHeader.writeUInt16LE(0, 8);            // compression: STORED
    localHeader.writeUInt16LE(0, 10);           // mod time
    localHeader.writeUInt16LE(0, 12);           // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);        // compressed size
    localHeader.writeUInt32LE(size, 22);        // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);           // extra length
    nameBuf.copy(localHeader, 30);

    // Central directory entry
    const cdEntry = Buffer.alloc(46 + nameBuf.length);
    cdEntry.writeUInt32LE(0x02014b50, 0);  // signature
    cdEntry.writeUInt16LE(20, 4);          // version made by
    cdEntry.writeUInt16LE(20, 6);          // version needed
    cdEntry.writeUInt16LE(0, 8);           // flags
    cdEntry.writeUInt16LE(0, 10);          // compression
    cdEntry.writeUInt16LE(0, 12);          // mod time
    cdEntry.writeUInt16LE(0, 14);          // mod date
    cdEntry.writeUInt32LE(crc, 16);
    cdEntry.writeUInt32LE(size, 20);       // compressed
    cdEntry.writeUInt32LE(size, 24);       // uncompressed
    cdEntry.writeUInt16LE(nameBuf.length, 28);
    cdEntry.writeUInt16LE(0, 30);          // extra length
    cdEntry.writeUInt16LE(0, 32);          // comment length
    cdEntry.writeUInt16LE(0, 34);          // disk start
    cdEntry.writeUInt16LE(0, 36);          // internal attr
    cdEntry.writeUInt32LE(0, 38);          // external attr
    cdEntry.writeUInt32LE(offset, 42);     // local header offset
    nameBuf.copy(cdEntry, 46);

    parts.push(localHeader, data);
    centralDir.push(cdEntry);
    offset += localHeader.length + size;
  }

  const cdBuf   = Buffer.concat(centralDir);
  const eocd    = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);          // signature
  eocd.writeUInt16LE(0, 4);                    // disk number
  eocd.writeUInt16LE(0, 6);                    // disk with cd
  eocd.writeUInt16LE(files.length, 8);         // entries on disk
  eocd.writeUInt16LE(files.length, 10);        // total entries
  eocd.writeUInt32LE(cdBuf.length, 12);        // cd size
  eocd.writeUInt32LE(offset, 16);             // cd offset
  eocd.writeUInt16LE(0, 20);                   // comment length

  return Buffer.concat([...parts, cdBuf, eocd]);
}

const VALID_TYPES = [
  "googleAnalytics",
  "googleSearchConsole",
  "shopify",
  "shopifyCustomApp",
  "wordpress",
];

// Types that support connection testing (others are manual/OAuth)
const TESTABLE = new Set(["googleAnalytics", "googleSearchConsole", "shopify"]);

// Types that support Airflow-driven data sync
const SYNCABLE = new Set(["googleAnalytics", "googleSearchConsole", "shopify"]);

// ``refreshProfiles`` (optional) is index.js's profile rebuild - called after a
// successful commerce sync so newly synced members appear on the Profiles page
// without waiting for a manual refresh.
export function createIntegrationsRouter(pool, { refreshProfiles } = {}) {
  const router = Router();

  const ok  = (res, data, status = 200) => res.status(status).json(data);
  const err = (res, msg, status = 400) => res.status(status).json({ error: msg });

  // Verify the caller is an active member of the x-company-id workspace; viewers
  // are read-only. (Without this any logged-in user could touch any tenant.)
  const getCompanyId = (req, res) => resolveCompanyId(pool, req, res);

  function normalizeTs(row) {
    if (!row) return null;
    const r = { ...row };
    const cols = [
      "created_date", "updated_date", "last_connected_date",
      "last_synced_date", "last_tested_date",
      "latest_job_date", "started_at", "completed_at", "occurred_at",
    ];
    for (const k of cols) {
      if (r[k] instanceof Date) r[k] = r[k].toISOString();
    }
    // Always redact sensitive config fields before sending to the client.
    // Decryption only happens server-side when the value is actually needed.
    if (r.config && r.integration_type) {
      r.config = redactConfig(r.integration_type, r.config);
    }
    return r;
  }

  async function getAccountId(companyId) {
    const { rows } = await pool.query(
      "SELECT account_id FROM app.companies WHERE id = $1",
      [companyId]
    );
    return rows[0]?.account_id || null;
  }

  // Returns the conflicting { company_id, name } if another workspace in the same
  // account already uses these credentials, else null.
  async function findCredentialConflict(accountId, type, fingerprint, companyId) {
    if (!fingerprint) return null;
    const { rows } = await pool.query(
      `SELECT di.company_id, c.name
         FROM app.data_integrations di
         JOIN app.companies c ON c.id = di.company_id
        WHERE di.account_id = $1
          AND di.integration_type = $2
          AND di.credential_fingerprint = $3
          AND di.company_id <> $4
        LIMIT 1`,
      [accountId, type, fingerprint, companyId]
    );
    return rows[0] || null;
  }

  async function auditLog(companyId, integrationType, action, detail = null, actor = "system") {
    try {
      await pool.query(
        `INSERT INTO app.integration_audit_log
           (company_id, integration_type, action, actor, detail)
         VALUES ($1,$2,$3,$4,$5)`,
        [companyId, integrationType, action, actor, detail]
      );
    } catch (e) {
      console.error("[audit]", e.message);
    }
  }

  function extractUrlPattern(propertyName) {
    try {
      const raw = propertyName.startsWith("http") ? propertyName : `https://${propertyName}`;
      const hostname = new URL(raw).hostname.replace(/^www\./, "");
      return hostname.split(".")[0] || "";
    } catch {
      return "";
    }
  }

  // Scoped to ONE workspace: connecting/disconnecting GA for a company must only
  // touch that company's config rows, never every tenant's.
  async function syncGaConfigTables(companyId, propertyName) {
    if (!companyId) return;
    const urlDomain  = propertyName || "";
    const urlPattern = propertyName ? extractUrlPattern(propertyName) : "";
    await Promise.all([
      pool.query(
        `UPDATE app.company_report_config SET url_domain=$1, updated_date=NOW() WHERE company_id=$2`,
        [urlDomain, companyId]
      ),
      pool.query(
        `UPDATE app.web_content_html_elements SET url_pattern=$1, updated_date=NOW() WHERE company_id=$2`,
        [urlPattern, companyId]
      ),
    ]);
  }

  // Landing tables wiped when a source is disconnected (per workspace). Fixed
  // allowlist - never user input - so the schema-qualified names are safe to
  // interpolate. GA = everything its DAGs produce; GSC = the keyword report.
  const PURGE_TABLES = {
    googleAnalytics: [
      "ga_landing.path_exploration", "ga_landing.path_exploration_duration", "ga_landing.funnel_report",
      "ga_landing.utm_performance", "ga_landing.utm_daily_performance", "ga_landing.utm_daily_full_param_performance",
      "ga_landing.utm_daily_utm_id_performance", "ga_landing.utm_ad_performance", "ga_landing.country_performance",
      "ga_landing.page_metrics", "ga_landing.page_utm_metrics", "ga_landing.website_metrics",
      "ga_landing.event_list", "ga_landing.purchase_list",
      // Anonymous visitor profiles are derived from path_exploration, so they go
      // stale the moment GA data is removed. Content attributes / tagged pages
      // (app.web_pages, app.attributes*) are deliberately NOT purged.
      "app.anonymous_profiles",
    ],
    googleSearchConsole: ["ga_landing.keyword_performance"],
    shopify: [
      // Raw Shopify landing (DAG-written, Shopify-native shape).
      'shopify.refund_line', 'shopify.refund', 'shopify.order_line', 'shopify."order"',
      "shopify.inventory_level", "shopify.product_image", "shopify.product_detail",
      "shopify.product", "shopify.customer",
    ],
  };
  // Neutral commerce.* rows are shared across platforms, so they are purged by
  // (company_id, source_platform) - never the whole company - when the matching
  // platform integration is disconnected.
  const COMMERCE_TABLES = [
    "commerce.refund_line", "commerce.refund", "commerce.order_line", 'commerce."order"',
    "commerce.inventory_level", "commerce.product_image", "commerce.product_detail",
    "commerce.product", "commerce.customer",
  ];
  const PURGE_COMMERCE_PLATFORM = { shopify: "shopify" };
  // ga_sync_control rows (the incremental watermark) to clear so a future
  // reconnect re-runs the full plan-based backfill cleanly.
  const PURGE_REPORTS = {
    googleAnalytics: [
      "path_exploration", "path_exploration_duration", "funnel_report", "utm_performance",
      "utm_daily_performance", "utm_daily_full_param_performance", "utm_daily_utm_id_performance",
      "utm_ad_performance", "country_performance", "page_metrics", "page_utm_metrics",
      "website_metrics", "event_list", "purchase_list",
    ],
    googleSearchConsole: ["keyword_performance"],
  };
  // Platform watermark control tables (cleared whole-client on disconnect so a
  // reconnect re-runs the full first-sync backfill).
  const PURGE_CONTROL_TABLES = { shopify: "shopify.shopify_sync_control" };
  // Unified golden-record rows (app.customer_profiles) contributed purely by this
  // source. Removing them on disconnect prevents orphaned profiles that can no
  // longer be backed by source data nor deleted in the UI (is_manual=false → 403).
  // 'mixed' profiles (also stitched from manual / another source) are deliberately
  // kept so we don't lose the manually-imported side of a stitched record.
  const PURGE_PROFILE_SOURCES = {
    shopify: "shopify",
  };

  async function purgeIntegrationData(companyId, type) {
    const tables = PURGE_TABLES[type];
    if (!tables || !companyId) return 0;
    for (const t of tables) {
      await pool.query(`DELETE FROM ${t} WHERE company_id = $1`, [companyId]);
    }
    // Neutral commerce rows contributed by this platform (other platforms' rows
    // for the same workspace are kept).
    const platform = PURGE_COMMERCE_PLATFORM[type];
    if (platform) {
      for (const t of COMMERCE_TABLES) {
        await pool.query(
          `DELETE FROM ${t} WHERE company_id = $1 AND source_platform = $2`,
          [companyId, platform]
        );
      }
    }
    // Drop the unified profiles that came solely from this source (identities
    // cascade off app.customer_profiles via FK).
    const profileSource = PURGE_PROFILE_SOURCES[type];
    if (profileSource) {
      await pool.query(
        "DELETE FROM app.customer_profiles WHERE company_id = $1 AND member_source = $2",
        [companyId, profileSource]
      );
    }
    const reports = PURGE_REPORTS[type];
    if (reports) {
      await pool.query(
        `DELETE FROM ga_landing.ga_sync_control
         WHERE report = ANY($1)
           AND capsuite_ref = (SELECT capsuite_ref FROM app.companies WHERE id = $2)`,
        [reports, companyId]
      );
    }
    // Platform sync-control watermarks (whole client, so reconnect = fresh backfill).
    const controlTable = PURGE_CONTROL_TABLES[type];
    if (controlTable) {
      await pool.query(
        `DELETE FROM ${controlTable}
         WHERE capsuite_ref = (SELECT capsuite_ref FROM app.companies WHERE id = $1)`,
        [companyId]
      );
    }
    return tables.length;
  }

  // Builds an empty stub so the frontend always receives all 5 integration types
  function emptyStub(type) {
    return {
      integration_type: type,
      config: {},
      is_connected: false,
      last_connected_date: null,
      last_tested_date: null,
      is_connection_error: false,
      connection_error: null,
      is_synced: false,
      last_synced_date: null,
      is_sync_error: false,
      sync_error: null,
      latest_job_id: null,
      latest_job_status: null,
      latest_job_date: null,
      latest_job_error: null,
    };
  }

  // ── GET all integrations ────────────────────────────────────────────────────
  // Returns all 5 types, enriched with the latest sync job status.
  router.get("/", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT
           di.*,
           lj.id           AS latest_job_id,
           lj.status       AS latest_job_status,
           lj.created_date AS latest_job_date,
           lj.error_message AS latest_job_error
         FROM app.data_integrations di
         LEFT JOIN LATERAL (
           SELECT id, status, created_date, error_message
           FROM app.integration_sync_jobs
           WHERE company_id = di.company_id
             AND integration_type = di.integration_type
           ORDER BY created_date DESC
           LIMIT 1
         ) lj ON true
         WHERE di.company_id = $1
         ORDER BY di.integration_type`,
        [companyId]
      );
      const map = Object.fromEntries(rows.map((r) => [r.integration_type, normalizeTs(r)]));
      ok(res, VALID_TYPES.map((t) => map[t] ?? emptyStub(t)));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── GET single integration ──────────────────────────────────────────────────
  router.get("/:type", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) return err(res, "Invalid integration type");
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT
           di.*,
           lj.id           AS latest_job_id,
           lj.status       AS latest_job_status,
           lj.created_date AS latest_job_date,
           lj.error_message AS latest_job_error
         FROM app.data_integrations di
         LEFT JOIN LATERAL (
           SELECT id, status, created_date, error_message
           FROM app.integration_sync_jobs
           WHERE company_id = di.company_id
             AND integration_type = di.integration_type
           ORDER BY created_date DESC
           LIMIT 1
         ) lj ON true
         WHERE di.integration_type=$1 AND di.company_id=$2`,
        [type, companyId]
      );
      ok(res, rows.length ? normalizeTs(rows[0]) : emptyStub(type));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── POST connect ────────────────────────────────────────────────────────────
  // Tests credentials inline (2-5 s), writes result synchronously.
  // No Airflow roundtrip needed for connection testing.
  router.post("/:type/connect", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) return err(res, "Invalid integration type");
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;

    const accountId = await getAccountId(companyId);
    if (!accountId) return err(res, "Company not found", 404);

    // ── WordPress: no credentials, just mark installed ──
    if (type === "wordpress") {
      const { rows } = await pool.query(
        `INSERT INTO app.data_integrations
           (account_id, company_id, integration_type, config, is_connected, last_connected_date, last_tested_date, is_connection_error)
         VALUES ($1,$2,$3,'{}',true,NOW(),NOW(),false)
         ON CONFLICT (company_id, integration_type) WHERE company_id IS NOT NULL
         DO UPDATE SET
           is_connected=true, last_connected_date=NOW(), last_tested_date=NOW(),
           is_connection_error=false, connection_error=null, updated_date=NOW()
         RETURNING *`,
        [accountId, companyId, type]
      );
      await auditLog(companyId, type, "connected", "WordPress plugin marked as installed");
      return ok(res, normalizeTs(rows[0]));
    }

    // ── Shopify Custom App: OAuth redirect ──
    if (type === "shopifyCustomApp") {
      const { storeName } = req.body;
      if (!storeName) return err(res, "storeName is required");
      const cleanStore  = storeName.trim().replace(/\.myshopify\.com$/, "");
      const config      = { storeName: cleanStore };
      const fingerprint = credentialFingerprint(type, config);

      const conflict = await findCredentialConflict(accountId, type, fingerprint, companyId);
      if (conflict) {
        return err(res, `This Shopify store is already connected in workspace "${conflict.name}". A data source can only be connected to one workspace per account.`, 409);
      }

      const clientId    = process.env.SHOPIFY_CLIENT_ID || "";
      const redirectUri = process.env.SHOPIFY_REDIRECT_URI ||
        `${req.protocol}://${req.get("host")}/api/data-integrations/shopifyCustomApp/oauth/callback`;
      const scope = "write_script_tags,read_script_tags,read_customers";
      const state = `${process.env.CLIENT_NAME || "default"}|${companyId}`;

      await pool.query(
        `INSERT INTO app.data_integrations
           (account_id, company_id, integration_type, config, credential_fingerprint, is_connected, is_connection_error)
         VALUES ($1,$2,$3,$4::jsonb,$5,false,false)
         ON CONFLICT (company_id, integration_type) WHERE company_id IS NOT NULL
         DO UPDATE SET config=$4::jsonb, credential_fingerprint=$5, updated_date=NOW()`,
        [accountId, companyId, type, JSON.stringify(config), fingerprint]
      );

      if (!clientId) {
        return ok(res, { oauthUrl: null, message: "SHOPIFY_CLIENT_ID not configured- config saved for dev.", config });
      }

      const oauthUrl = `https://${cleanStore}.myshopify.com/admin/oauth/authorize` +
        `?client_id=${clientId}&scope=${encodeURIComponent(scope)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
      return ok(res, { oauthUrl });
    }

    // ── Testable types: GA, GSC, Shopify ──
    if (!TESTABLE.has(type)) return err(res, "Connect not supported for this integration type");

    let config = {};
    try {
      if (type === "googleAnalytics") {
        const { propertyId, propertyName } = req.body;
        if (!propertyId || !propertyName) return err(res, "propertyId and propertyName are required");
        config = { propertyId: propertyId.trim(), propertyName: propertyName.trim() };
      } else if (type === "googleSearchConsole") {
        const { siteUrl } = req.body;
        if (!siteUrl) return err(res, "siteUrl is required");
        config = { siteUrl: siteUrl.trim() };
      } else if (type === "shopify") {
        const { storeName, accessToken } = req.body;
        if (!storeName || !accessToken) return err(res, "storeName and accessToken are required");
        config = {
          storeName: storeName.trim().replace(/\.myshopify\.com$/, ""),
          accessToken: accessToken.trim(),
        };
      }
    } catch (e) { return err(res, e.message); }

    // Enforce per-account credential uniqueness BEFORE spending time on the
    // connection test: a data source may live in only one workspace per account.
    const fingerprint = credentialFingerprint(type, config);
    const conflict = await findCredentialConflict(accountId, type, fingerprint, companyId);
    if (conflict) {
      const label = type === "googleAnalytics" ? "GA property"
        : type === "googleSearchConsole" ? "GSC site" : "Shopify store";
      return err(res, `This ${label} is already connected in workspace "${conflict.name}". A data source can only be connected to one workspace per account.`, 409);
    }

    try {
      // Test with the plaintext config (connection test runs server-side only)
      await runConnectionTest(type, config);

      // Encrypt sensitive fields before persisting
      const safeConfig = encryptConfig(type, config);

      const { rows } = await pool.query(
        `INSERT INTO app.data_integrations
           (account_id, company_id, integration_type, config, credential_fingerprint,
            is_connected, last_connected_date, last_tested_date,
            is_connection_error, connection_error)
         VALUES ($1,$2,$3,$4::jsonb,$5,true,NOW(),NOW(),false,null)
         ON CONFLICT (company_id, integration_type) WHERE company_id IS NOT NULL
         DO UPDATE SET
           config=$4::jsonb, credential_fingerprint=$5,
           is_connected=true, last_connected_date=NOW(), last_tested_date=NOW(),
           is_connection_error=false, connection_error=null, updated_date=NOW()
         RETURNING *`,
        [accountId, companyId, type, JSON.stringify(safeConfig), fingerprint]
      );

      if (type === "googleAnalytics") {
        await syncGaConfigTables(companyId, config.propertyName).catch((e) =>
          console.warn("[GA config sync]", e.message)
        );
      }

      await auditLog(companyId, type, "connected", null, req.user?.id || "user");
      return ok(res, normalizeTs(rows[0]));

    } catch (e) {
      // Save error state (encrypt any partial config that was built before the error).
      // Leave credential_fingerprint NULL: a failed connection must not reserve the
      // credentials against the per-account uniqueness rule.
      const safeConfig = encryptConfig(type, config);
      const { rows } = await pool.query(
        `INSERT INTO app.data_integrations
           (account_id, company_id, integration_type, config, credential_fingerprint,
            is_connected, last_tested_date, is_connection_error, connection_error)
         VALUES ($1,$2,$3,$4::jsonb,null,false,NOW(),true,$5)
         ON CONFLICT (company_id, integration_type) WHERE company_id IS NOT NULL
         DO UPDATE SET
           config=$4::jsonb, credential_fingerprint=null, is_connected=false, last_tested_date=NOW(),
           is_connection_error=true, connection_error=$5, updated_date=NOW()
         RETURNING *`,
        [accountId, companyId, type, JSON.stringify(safeConfig), e.message]
      );
      await auditLog(companyId, type, "connection_failed", e.message, req.user?.id || "user");
      // 200 with error state- frontend reads is_connection_error to show the error inline
      return ok(res, normalizeTs(rows[0]));
    }
  });

  // ── POST check (re-test with saved credentials) ─────────────────────────────
  // Lets users re-verify without re-entering credentials.
  // Like "Test connection" in Zapier / HubSpot integrations.
  router.post("/:type/check", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!TESTABLE.has(type)) return err(res, "Health check not available for this type");
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;

    try {
      const { rows: existing } = await pool.query(
        `SELECT * FROM app.data_integrations WHERE integration_type=$1 AND company_id=$2`,
        [type, companyId]
      );
      if (!existing.length || !existing[0].config || !Object.keys(existing[0].config).length) {
        return err(res, "No saved configuration found. Connect this integration first.");
      }

      // Decrypt before testing- connection test needs the real token
      const config = decryptConfig(type, existing[0].config);

      try {
        await runConnectionTest(type, config);

        const { rows } = await pool.query(
          `UPDATE app.data_integrations
           SET is_connected=true, last_tested_date=NOW(),
               is_connection_error=false, connection_error=null, updated_date=NOW()
           WHERE integration_type=$1 AND company_id=$2
           RETURNING *`,
          [type, companyId]
        );
        await auditLog(companyId, type, "health_passed", null, req.user?.id || "user");
        return ok(res, normalizeTs(rows[0]));

      } catch (e) {
        const { rows } = await pool.query(
          `UPDATE app.data_integrations
           SET is_connected=false, last_tested_date=NOW(),
               is_connection_error=true, connection_error=$1, updated_date=NOW()
           WHERE integration_type=$2 AND company_id=$3
           RETURNING *`,
          [e.message, type, companyId]
        );
        await auditLog(companyId, type, "health_failed", e.message, req.user?.id || "user");
        return ok(res, normalizeTs(rows[0]));
      }
    } catch (e) { err(res, e.message, 500); }
  });

  // ── POST sync ───────────────────────────────────────────────────────────────
  // Creates a persisted job record, then immediately hands it to the queue worker.
  // The queue triggers Airflow; Airflow calls /webhook/dag-complete when done.
  router.post("/:type/sync", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!SYNCABLE.has(type)) return err(res, "Sync is not available for this integration type");
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;

    try {
      const { rows: existing } = await pool.query(
        `SELECT is_connected FROM app.data_integrations WHERE integration_type=$1 AND company_id=$2`,
        [type, companyId]
      );
      if (!existing.length || !existing[0].is_connected) {
        return err(res, "Integration must be connected before syncing");
      }

      // Prevent duplicate: if a job is already queued or running, return it
      const { rows: active } = await pool.query(
        `SELECT * FROM app.integration_sync_jobs
         WHERE company_id=$1 AND integration_type=$2 AND status IN ('queued','running')
         ORDER BY created_date DESC LIMIT 1`,
        [companyId, type]
      );
      if (active.length) {
        return ok(res, { job: normalizeTs(active[0]), alreadyQueued: true });
      }

      // The DAG resolves its per-workspace config by capsuite_ref (= str_client_name),
      // so the job must carry THIS workspace's capsuite_ref- not a global env value.
      const { rows: [co] } = await pool.query(
        `SELECT capsuite_ref FROM app.companies WHERE id=$1`,
        [companyId]
      );
      const clientName = co?.capsuite_ref || process.env.CLIENT_NAME || "default";

      const { rows: [job] } = await pool.query(
        `INSERT INTO app.integration_sync_jobs
           (company_id, integration_type, triggered_by, metadata)
         VALUES ($1,$2,'manual',$3::jsonb)
         RETURNING *`,
        [companyId, type, JSON.stringify({ client_name: clientName })]
      );

      await auditLog(companyId, type, "sync_queued", null, req.user?.id || "user");

      // Attempt to run immediately (non-blocking)
      processNextJob(pool).catch((e) => console.error("[Queue] processNextJob error:", e.message));

      ok(res, { job: normalizeTs(job) });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── GET sync job history ────────────────────────────────────────────────────
  router.get("/:type/sync/jobs", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) return err(res, "Invalid integration type");
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.integration_sync_jobs
         WHERE company_id=$1 AND integration_type=$2
         ORDER BY created_date DESC LIMIT 20`,
        [companyId, type]
      );
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── GET audit log ───────────────────────────────────────────────────────────
  router.get("/:type/audit", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) return err(res, "Invalid integration type");
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.integration_audit_log
         WHERE company_id=$1 AND integration_type=$2
         ORDER BY occurred_at DESC LIMIT 50`,
        [companyId, type]
      );
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── POST cancel sync job ────────────────────────────────────────────────────
  router.post("/:type/sync/cancel", authenticate, async (req, res) => {
    const { type } = req.params;
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `UPDATE app.integration_sync_jobs
         SET status='cancelled', completed_at=NOW(), updated_date=NOW()
         WHERE company_id=$1 AND integration_type=$2 AND status='queued'
         RETURNING *`,
        [companyId, type]
      );
      if (!rows.length) return err(res, "No queued job to cancel");
      await auditLog(companyId, type, "sync_cancelled", null, req.user?.id || "user");
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── DELETE disconnect ───────────────────────────────────────────────────────
  // Resets the record immediately- user sees it as disconnected right away.
  // Background cleanup DAG is triggered fire-and-forget (failure doesn't block the response).
  router.delete("/:type", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) return err(res, "Invalid integration type");
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;

    try {
      const { rows: existing } = await pool.query(
        `SELECT config FROM app.data_integrations WHERE integration_type=$1 AND company_id=$2`,
        [type, companyId]
      );
      if (!existing.length) return err(res, "Integration not found", 404);

      // Reset the record immediately
      const { rows } = await pool.query(
        `UPDATE app.data_integrations
         SET config='{}', is_connected=false, last_connected_date=null,
             last_tested_date=null, is_connection_error=false, connection_error=null,
             is_synced=false, last_synced_date=null, is_sync_error=false, sync_error=null,
             updated_date=NOW()
         WHERE integration_type=$1 AND company_id=$2
         RETURNING *`,
        [type, companyId]
      );

      // Cancel any queued/running sync jobs
      await pool.query(
        `UPDATE app.integration_sync_jobs
         SET status='cancelled', completed_at=NOW(), updated_date=NOW()
         WHERE company_id=$1 AND integration_type=$2 AND status IN ('queued','running')`,
        [companyId, type]
      );

      if (type === "googleAnalytics") {
        await syncGaConfigTables(companyId, "").catch((e) => console.warn("[GA config sync clear]", e.message));
      }

      await auditLog(companyId, type, "disconnected", null, req.user?.id || "user");

      // Purge this workspace's landing data directly in Postgres (same DB the app
      // uses) - no Airflow roundtrip. Fire-and-forget so a large delete doesn't
      // block the response; the integration already reads as disconnected.
      purgeIntegrationData(companyId, type)
        .then((n) => { if (n) auditLog(companyId, type, "data_purged", `${n} table(s)`, "system").catch(() => {}); })
        .catch((e) => console.error("[disconnect purge]", e.message));

      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── POST Shopify Custom App OAuth callback ──────────────────────────────────
  // No authenticate middleware- this is an OAuth redirect from Shopify.
  // company_id is encoded in `state` as `${clientName}|${companyId}`.
  router.get("/shopifyCustomApp/oauth/callback", async (req, res) => {
    const { code, shop, state } = req.query;
    if (!code || !shop) return err(res, "Missing OAuth params");

    const companyId = state?.split("|")[1] || null;
    if (!companyId) return err(res, "Missing company context in OAuth state", 400);

    try {
      const clientId     = process.env.SHOPIFY_CLIENT_ID || "";
      const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || "";
      if (!clientId || !clientSecret) return err(res, "Shopify credentials not configured", 500);

      const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      if (!tokenRes.ok) return err(res, "Failed to exchange OAuth token", 500);
      const { access_token } = await tokenRes.json();

      const storeName    = shop.replace(".myshopify.com", "");
      const scriptTagBase = process.env.CDP_SCRIPT_TAG_URL || "";
      let scriptTagId = null;

      if (scriptTagBase && access_token) {
        const stRes = await fetch(`https://${shop}/admin/api/2024-01/script_tags.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access_token },
          body: JSON.stringify({ script_tag: { event: "onload", src: scriptTagBase } }),
        });
        if (stRes.ok) {
          const { script_tag } = await stRes.json();
          scriptTagId = script_tag?.id?.toString();
        }
      }

      // Encrypt access token before storing
      const oauthConfig = encryptConfig("shopifyCustomApp", {
        storeName, scriptTagId, accessToken: access_token,
      });
      const accountId   = await getAccountId(companyId);
      const fingerprint = credentialFingerprint("shopifyCustomApp", { storeName });

      await pool.query(
        `INSERT INTO app.data_integrations
           (account_id, company_id, integration_type, config, credential_fingerprint, is_connected, last_connected_date, last_tested_date, is_connection_error)
         VALUES ($1,$2,'shopifyCustomApp',$3::jsonb,$4,true,NOW(),NOW(),false)
         ON CONFLICT (company_id, integration_type) WHERE company_id IS NOT NULL
         DO UPDATE SET
           config=$3::jsonb, credential_fingerprint=$4, is_connected=true,
           last_connected_date=NOW(), last_tested_date=NOW(),
           is_connection_error=false, updated_date=NOW()`,
        [accountId, companyId, JSON.stringify(oauthConfig), fingerprint]
      );

      await auditLog(companyId, "shopifyCustomApp", "connected", "OAuth install completed");
      res.redirect("/#/integrations?connected=shopifyCustomApp");
    } catch (e) { err(res, e.message, 500); }
  });

  // ── POST webhook- Airflow calls this when a sync DAG completes ─────────────
  // No authenticate middleware- called by Airflow with company_id in the body.
  router.post("/webhook/dag-complete", async (req, res) => {
    const { integration_type, company_id, job_id, is_connected, connection_error,
            is_synced, sync_error, records_synced } = req.body;

    if (!integration_type || !VALID_TYPES.includes(integration_type))
      return err(res, "Invalid integration_type");
    if (!company_id) return err(res, "company_id is required");

    try {
      // Update the sync job if a job_id was provided
      if (job_id) {
        const jobStatus = is_synced ? "completed" : "failed";
        await pool.query(
          `UPDATE app.integration_sync_jobs
           SET status=$1, completed_at=NOW(), error_message=$2,
               records_synced=$3, updated_date=NOW()
           WHERE id=$4`,
          [jobStatus, sync_error || null, records_synced || null, job_id]
        );
        await auditLog(
          company_id, integration_type,
          is_synced ? "sync_completed" : "sync_failed",
          sync_error || null, "airflow"
        );

        // In-app notification for the sync result (best-effort).
        const label = { googleAnalytics: "Google Analytics", googleSearchConsole: "Google Search Console", shopify: "Shopify" }[integration_type] || integration_type;
        await notifyCompany(pool, {
          companyId: company_id,
          type: "sync_status",
          title: is_synced ? `${label} sync completed` : `${label} sync failed`,
          body: is_synced
            ? (records_synced != null ? `${Number(records_synced).toLocaleString()} records synced.` : "Your latest data has finished syncing.")
            : "We couldn't complete the sync. Open Integrations to retry.",
          link: "/integrations",
          metadata: { integration_type, status: is_synced ? "completed" : "failed", job_id, records_synced: records_synced ?? null },
        });
      }

      // Update the integration record
      const sets = [];
      const vals = [integration_type, company_id];
      let i = 3;

      if (is_connected !== undefined) {
        sets.push(`is_connected=$${i++}`); vals.push(is_connected);
        if (is_connected) sets.push(`last_connected_date=NOW()`);
      }
      if (connection_error !== undefined) {
        sets.push(`connection_error=$${i++}`); vals.push(connection_error);
        sets.push(`is_connection_error=$${i++}`); vals.push(!!connection_error);
      }
      if (is_synced !== undefined) {
        sets.push(`is_synced=$${i++}`); vals.push(is_synced);
        if (is_synced) sets.push(`last_synced_date=NOW()`);
      }
      if (sync_error !== undefined) {
        sets.push(`sync_error=$${i++}`); vals.push(sync_error);
        sets.push(`is_sync_error=$${i++}`); vals.push(!!sync_error);
      }

      if (sets.length) {
        sets.push("updated_date=NOW()");
        await pool.query(
          `UPDATE app.data_integrations SET ${sets.join(",")}
           WHERE integration_type=$1 AND company_id=$2`,
          vals
        );
      }

      // A successful commerce-platform sync just refreshed commerce.* - rebuild
      // this workspace's unified profiles so the new members/orders show up on
      // the Profiles page immediately. Fire-and-forget: a profile-build hiccup
      // must not make Airflow retry the webhook.
      const COMMERCE_PLATFORM_TYPES = new Set(["shopify", "shopline", "odoo"]);
      if (is_synced && COMMERCE_PLATFORM_TYPES.has(integration_type) && typeof refreshProfiles === "function") {
        refreshProfiles(pool, company_id).catch((e) =>
          console.error(`[Integrations] profile refresh after ${integration_type} sync failed:`, e.message)
        );
      }

      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  // Ensure the current workspace has a config row, creating it from column
  // defaults if missing (a config-less workspace is silently skipped by the DAGs).
  async function ensureReportConfig(companyId) {
    const { rows } = await pool.query(
      `INSERT INTO app.company_report_config (company_id, capsuite_ref, is_trial)
       SELECT c.id, c.capsuite_ref, (a.plan = 'free')
       FROM app.companies c JOIN app.accounts a ON a.id = c.account_id
       WHERE c.id = $1
       ON CONFLICT (company_id) DO NOTHING
       RETURNING *`,
      [companyId]
    );
    if (rows[0]) return rows[0];
    const { rows: existing } = await pool.query(
      `SELECT * FROM app.company_report_config WHERE company_id = $1`, [companyId]
    );
    return existing[0] || null;
  }

  // ── GET / PATCH company_report_config (scoped to the current workspace) ──────
  router.get("/config/report", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;
    try {
      ok(res, normalizeTs(await ensureReportConfig(companyId)));
    } catch (e) { err(res, e.message, 500); }
  });

  router.patch("/config/report", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;
    const allowed = [
      "capsuite_ref", "is_trial", "url_domain",
      "supporting_capsuite_param", "cdp_reports", "ga_reports", "gsc_reports",
    ];
    const keys = Object.keys(req.body).filter((k) => allowed.includes(k));
    if (!keys.length) return err(res, "No valid fields to update");
    try {
      await ensureReportConfig(companyId);
      const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(", ");
      const vals = keys.map((k) => req.body[k]);
      vals.push(companyId);
      const { rows } = await pool.query(
        `UPDATE app.company_report_config SET ${sets}, updated_date=NOW()
         WHERE company_id=$${keys.length + 1} RETURNING *`,
        vals
      );
      ok(res, normalizeTs(rows[0] || null));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── GET / PATCH web_content_html_elements (scoped to the current workspace) ──
  router.get("/config/web-content", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.web_content_html_elements WHERE company_id=$1`, [companyId]
      );
      ok(res, normalizeTs(rows[0] || null));
    } catch (e) { err(res, e.message, 500); }
  });

  router.patch("/config/web-content", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res);
    if (!companyId) return;
    const allowed = [
      "capsuite_ref", "cut_off_point_after", "cut_off_point_before",
      "update_time_elements", "error_strings", "valid_content_min_length", "url_pattern",
    ];
    const keys = Object.keys(req.body).filter((k) => allowed.includes(k));
    if (!keys.length) return err(res, "No valid fields to update");
    try {
      const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(", ");
      const vals = keys.map((k) => req.body[k]);
      vals.push(companyId);
      const { rows } = await pool.query(
        `UPDATE app.web_content_html_elements SET ${sets}, updated_date=NOW()
         WHERE company_id=$${keys.length + 1} RETURNING *`,
        vals
      );
      ok(res, normalizeTs(rows[0] || null));
    } catch (e) { err(res, e.message, 500); }
  });

  // GET /api/integrations/wordpress/plugin-download
  // Serves the WordPress plugin as a .zip ready to upload via WP admin.
  router.get("/wordpress/plugin-download", authenticate, (req, res) => {
    try {
      const pluginPath = path.resolve(__dirname, "../../popup-plugin/capsuite-cdp-popup.php");
      const phpContent = readFileSync(pluginPath);

      // WordPress expects: plugin-folder/plugin-file.php inside the zip
      const zip = buildZip([
        { name: "capsuite-cdp-popup/capsuite-cdp-popup.php", data: phpContent },
      ]);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", "attachment; filename=\"capsuite-cdp-popup.zip\"");
      res.setHeader("Content-Length", zip.length);
      res.end(zip);
    } catch (e) {
      res.status(500).json({ error: "Plugin file not found: " + e.message });
    }
  });

  return router;
}
