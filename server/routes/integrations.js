import { Router } from "express";
import { authenticate } from "../middleware/auth.js";

const VALID_TYPES = [
  "googleAnalytics",
  "googleSearchConsole",
  "shopify",
  "shopifyCustomApp",
  "wordpress",
];

export function createIntegrationsRouter(pool) {
  const router = Router();

  function ok(res, data, status = 200) { res.status(status).json(data); }
  function err(res, msg, status = 400) { res.status(status).json({ error: msg }); }

  function getCompanyId(req, res) {
    const id = req.headers["x-company-id"];
    if (!id) { err(res, "x-company-id header required", 400); return null; }
    return id;
  }

  function normalizeTs(row) {
    if (!row) return null;
    const r = { ...row };
    ["created_date", "updated_date", "last_connected_date", "last_synced_date"].forEach((k) => {
      if (r[k] instanceof Date) r[k] = r[k].toISOString();
    });
    return r;
  }

  function nowRunId(prefix) {
    return `${prefix}_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 20)}`;
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

  async function syncGaConfigTables(propertyName) {
    const urlDomain = propertyName || "";
    const urlPattern = propertyName ? extractUrlPattern(propertyName) : "";
    await Promise.all([
      pool.query(
        `UPDATE app.company_report_config SET url_domain = $1, updated_date = NOW()`,
        [urlDomain]
      ),
      pool.query(
        `UPDATE app.web_content_html_elements SET url_pattern = $1, updated_date = NOW()`,
        [urlPattern]
      ),
    ]);
  }

  async function triggerDag(dagId, payload) {
    const airflowUrl = (process.env.AIRFLOW_BASE_URL || "").replace(/\/$/, "");
    const airflowUser = process.env.AIRFLOW_USER || "admin";
    const airflowPass = process.env.AIRFLOW_PASS || "";

    if (!airflowUrl) {
      console.log(`[DAG] Dev mode - would trigger ${dagId}:`, JSON.stringify(payload));
      return { dag_run_id: payload.dag_run_id || `dev_${Date.now()}`, state: "queued" };
    }

    const response = await fetch(`${airflowUrl}/api/v1/dags/${dagId}/dagRuns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${airflowUser}:${airflowPass}`).toString("base64")}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Airflow error ${response.status}: ${text}`);
    }

    return response.json();
  }

  // ── GET all integrations ────────────────────────────────────────────────────
  router.get("/", authenticate, async (req, res) => {
    const companyId = getCompanyId(req, res);
    if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.data_integrations WHERE company_id = $1 ORDER BY integration_type`,
        [companyId]
      );
      const map = Object.fromEntries(rows.map((r) => [r.integration_type, normalizeTs(r)]));
      const result = VALID_TYPES.map((type) => map[type] || {
        integration_type: type,
        config: {},
        is_connected: false,
        is_connection_error: false,
        connection_error: null,
        is_synced: false,
        is_sync_error: false,
        sync_error: null,
        last_connected_date: null,
        last_synced_date: null,
      });
      ok(res, result);
    } catch (e) { err(res, e.message, 500); }
  });

  // ── GET single integration ────────────────────────────────────────────────────
  router.get("/:type", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) return err(res, "Invalid integration type");
    const companyId = getCompanyId(req, res);
    if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.data_integrations WHERE integration_type = $1 AND company_id = $2`,
        [type, companyId]
      );
      if (!rows.length) {
        return ok(res, { integration_type: type, config: {}, is_connected: false, is_connection_error: false, is_synced: false, is_sync_error: false });
      }
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── POST connect ──────────────────────────────────────────────────────────────
  router.post("/:type/connect", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) return err(res, "Invalid integration type");
    const companyId = getCompanyId(req, res);
    if (!companyId) return;

    const isDev = !process.env.AIRFLOW_BASE_URL;
    const clientName = process.env.CLIENT_NAME || "default";

    try {
      let config = {};
      let dagId = "trigger_test_data_connection";
      let dagPayload = null;
      const runId = nowRunId("test_data_connection");

      if (type === "googleAnalytics") {
        const { propertyId, propertyName } = req.body;
        if (!propertyId || !propertyName) return err(res, "propertyId and propertyName are required");
        config = { propertyId: propertyId.trim(), propertyName: propertyName.trim() };
        dagPayload = {
          conf: {
            str_client_name: clientName,
            company_id: companyId,
            test_ga_connection: true,
            test_ga_property_list: [{ propertyName: config.propertyName, propertyId: config.propertyId }],
            dag_run_id: runId,
          },
          dag_run_id: runId,
        };
      } else if (type === "googleSearchConsole") {
        const { siteUrl } = req.body;
        if (!siteUrl) return err(res, "siteUrl is required");
        config = { siteUrl: siteUrl.trim() };
        dagPayload = {
          conf: {
            str_client_name: clientName,
            company_id: companyId,
            test_gsc_connection: true,
            test_gsc_site_list: [{ siteUrl: config.siteUrl }],
            dag_run_id: runId,
          },
          dag_run_id: runId,
        };
      } else if (type === "shopify") {
        const { storeName, accessToken } = req.body;
        if (!storeName || !accessToken) return err(res, "storeName and accessToken are required");
        config = { storeName: storeName.trim().replace(/\.myshopify\.com$/, ""), accessToken: accessToken.trim() };
        dagPayload = {
          conf: {
            str_client_name: clientName,
            company_id: companyId,
            test_shopify_connection: true,
            test_shopify_store_list: [{ storeName: config.storeName, accessToken: config.accessToken }],
            dag_run_id: runId,
          },
          dag_run_id: runId,
        };
      } else if (type === "shopifyCustomApp") {
        const { storeName } = req.body;
        if (!storeName) return err(res, "storeName is required");
        const cleanStore = storeName.trim().replace(/\.myshopify\.com$/, "");
        config = { storeName: cleanStore };

        const shopifyClientId = process.env.SHOPIFY_CLIENT_ID || "";
        const redirectUri = process.env.SHOPIFY_REDIRECT_URI ||
          `${req.protocol}://${req.get("host")}/api/data-integrations/shopifyCustomApp/oauth/callback`;
        const scope = "write_script_tags,read_script_tags,read_customers";
        // Encode company_id in state so the OAuth callback can scope the DB write
        const state = `${clientName}|${companyId}`;

        if (!shopifyClientId) {
          await pool.query(
            `INSERT INTO app.data_integrations (company_id, integration_type, config, is_connected, is_connection_error)
             VALUES ($1, $2, $3::jsonb, false, false)
             ON CONFLICT (company_id, integration_type) WHERE company_id IS NOT NULL
             DO UPDATE SET config = $3::jsonb, updated_date = NOW()`,
            [companyId, type, JSON.stringify(config)]
          );
          return ok(res, { oauthUrl: null, message: "SHOPIFY_CLIENT_ID not configured - config saved for dev.", config });
        }

        const oauthUrl = `https://${cleanStore}.myshopify.com/admin/oauth/authorize?client_id=${shopifyClientId}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
        await pool.query(
          `INSERT INTO app.data_integrations (company_id, integration_type, config, is_connected, is_connection_error)
           VALUES ($1, $2, $3::jsonb, false, false)
           ON CONFLICT (company_id, integration_type) WHERE company_id IS NOT NULL
           DO UPDATE SET config = $3::jsonb, updated_date = NOW()`,
          [companyId, type, JSON.stringify(config)]
        );
        return ok(res, { oauthUrl });
      } else if (type === "wordpress") {
        config = { ...req.body };
        const { rows } = await pool.query(
          `INSERT INTO app.data_integrations (company_id, integration_type, config, is_connected, last_connected_date, is_connection_error)
           VALUES ($1, $2, $3::jsonb, true, NOW(), false)
           ON CONFLICT (company_id, integration_type) WHERE company_id IS NOT NULL
           DO UPDATE SET
             config = $3::jsonb, is_connected = true,
             last_connected_date = NOW(), is_connection_error = false, updated_date = NOW()
           RETURNING *`,
          [companyId, type, JSON.stringify(config)]
        );
        return ok(res, normalizeTs(rows[0]));
      }

      let isConnected = isDev;
      let isConnectionError = false;
      let connectionError = null;

      try {
        await triggerDag(dagId, dagPayload);
      } catch (dagErr) {
        console.error(`[DAG] trigger error for ${type}:`, dagErr.message);
        if (!isDev) {
          isConnectionError = true;
          connectionError = dagErr.message;
          isConnected = false;
        }
      }

      const { rows } = await pool.query(
        `INSERT INTO app.data_integrations
           (company_id, integration_type, config, is_connected, last_connected_date, is_connection_error, connection_error)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
         ON CONFLICT (company_id, integration_type) WHERE company_id IS NOT NULL
         DO UPDATE SET
           config = $3::jsonb,
           is_connected = $4,
           last_connected_date = CASE WHEN $4 THEN NOW() ELSE app.data_integrations.last_connected_date END,
           is_connection_error = $6,
           connection_error = $7,
           updated_date = NOW()
         RETURNING *`,
        [companyId, type, JSON.stringify(config), isConnected, isConnected ? new Date() : null, isConnectionError, connectionError]
      );

      if (type === "googleAnalytics" && isConnected) {
        await syncGaConfigTables(config.propertyName).catch((e) =>
          console.warn("[GA config sync] error:", e.message)
        );
      }

      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── POST sync ─────────────────────────────────────────────────────────────────
  router.post("/:type/sync", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) return err(res, "Invalid integration type");
    const companyId = getCompanyId(req, res);
    if (!companyId) return;

    const DAG_MAP = {
      googleAnalytics: "trial_flow_sync_ga_data",
      googleSearchConsole: "trial_flow_sync_gsc_data",
      shopify: "trial_flow_sync_shopify_data",
    };
    const dagId = DAG_MAP[type];
    if (!dagId) return err(res, "Sync is not available for this integration type");

    const isDev = !process.env.AIRFLOW_BASE_URL;
    const clientName = process.env.CLIENT_NAME || "default";

    try {
      const { rows: existing } = await pool.query(
        `SELECT * FROM app.data_integrations WHERE integration_type = $1 AND company_id = $2`,
        [type, companyId]
      );
      if (!existing.length || !existing[0].is_connected) {
        return err(res, "Integration must be connected before syncing");
      }

      const runId = nowRunId("trial_flow_sync_data");
      const dagPayload = {
        conf: { str_client_name: clientName, company_id: companyId, is_debugging: true, dag_run_id: runId },
        dag_run_id: runId,
      };

      let isSynced = isDev;
      let isSyncError = false;
      let syncError = null;

      try {
        await triggerDag(dagId, dagPayload);
      } catch (dagErr) {
        console.error(`[DAG] sync error for ${type}:`, dagErr.message);
        if (!isDev) { isSyncError = true; syncError = dagErr.message; isSynced = false; }
      }

      const { rows } = await pool.query(
        `UPDATE app.data_integrations
         SET is_synced = $3,
             last_synced_date = CASE WHEN $3 THEN NOW() ELSE last_synced_date END,
             is_sync_error = $4,
             sync_error = $5,
             updated_date = NOW()
         WHERE integration_type = $1 AND company_id = $2
         RETURNING *`,
        [type, companyId, isSynced, isSyncError, syncError]
      );
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── DELETE disconnect ──────────────────────────────────────────────────────────
  router.delete("/:type", authenticate, async (req, res) => {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) return err(res, "Invalid integration type");
    const companyId = getCompanyId(req, res);
    if (!companyId) return;

    const isDev = !process.env.AIRFLOW_BASE_URL;
    const clientName = process.env.CLIENT_NAME || "default";

    try {
      const { rows: existing } = await pool.query(
        `SELECT * FROM app.data_integrations WHERE integration_type = $1 AND company_id = $2`,
        [type, companyId]
      );
      if (!existing.length) return err(res, "Integration not found", 404);

      const config = existing[0].config || {};
      const runId = nowRunId("disconnect_data_connection");
      const dagPayload = {
        conf: { str_client_name: clientName, company_id: companyId, dag_run_id: runId },
        dag_run_id: runId,
      };

      if (type === "googleAnalytics") {
        dagPayload.conf.disconnect_ga_connection = true;
        dagPayload.conf.disconnect_ga_property_list = [{ propertyName: config.propertyName, propertyId: config.propertyId }];
      } else if (type === "googleSearchConsole") {
        dagPayload.conf.disconnect_gsc_connection = true;
        dagPayload.conf.disconnect_gsc_site_list = [{ siteUrl: config.siteUrl }];
      } else if (type === "shopify") {
        dagPayload.conf.disconnect_shopify_connection = true;
        dagPayload.conf.disconnect_shopify_store_list = [{ storeName: config.storeName, accessToken: config.accessToken }];
      }

      try {
        if (!isDev) await triggerDag("trigger_disconnect_data_connection", dagPayload);
        else console.log(`[DAG] Dev mode - would trigger disconnect for ${type}`);
      } catch (dagErr) {
        console.warn(`[DAG] Disconnect DAG warning for ${type}:`, dagErr.message);
      }

      const { rows } = await pool.query(
        `UPDATE app.data_integrations
         SET config = '{}', is_connected = false, last_connected_date = NULL,
             is_connection_error = false, connection_error = NULL,
             is_synced = false, last_synced_date = NULL,
             is_sync_error = false, sync_error = NULL,
             updated_date = NOW()
         WHERE integration_type = $1 AND company_id = $2
         RETURNING *`,
        [type, companyId]
      );

      if (type === "googleAnalytics") {
        await syncGaConfigTables("").catch((e) =>
          console.warn("[GA config sync] clear error:", e.message)
        );
      }

      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── POST Shopify Custom App check connection ───────────────────────────────────
  router.post("/shopifyCustomApp/check", authenticate, async (req, res) => {
    const companyId = getCompanyId(req, res);
    if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.data_integrations WHERE integration_type = 'shopifyCustomApp' AND company_id = $1`,
        [companyId]
      );
      if (!rows.length) return err(res, "Shopify Custom App not configured", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── GET Shopify Custom App OAuth callback ─────────────────────────────────────
  // No authenticate middleware - this is an OAuth redirect from Shopify.
  // company_id is encoded in `state` as `${clientName}|${companyId}`.
  router.get("/shopifyCustomApp/oauth/callback", async (req, res) => {
    const { code, shop, state } = req.query;
    if (!code || !shop) return err(res, "Missing OAuth params");

    const companyId = state?.split("|")[1] || null;
    if (!companyId) return err(res, "Missing company context in OAuth state", 400);

    try {
      const shopifyClientId = process.env.SHOPIFY_CLIENT_ID || "";
      const shopifyClientSecret = process.env.SHOPIFY_CLIENT_SECRET || "";

      if (!shopifyClientId || !shopifyClientSecret) {
        return err(res, "Shopify credentials not configured", 500);
      }

      const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: shopifyClientId, client_secret: shopifyClientSecret, code }),
      });

      if (!tokenRes.ok) return err(res, "Failed to exchange OAuth token", 500);
      const { access_token } = await tokenRes.json();

      const storeName = shop.replace(".myshopify.com", "");
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

      await pool.query(
        `INSERT INTO app.data_integrations
           (company_id, integration_type, config, is_connected, last_connected_date, is_connection_error)
         VALUES ($1, 'shopifyCustomApp', $2::jsonb, true, NOW(), false)
         ON CONFLICT (company_id, integration_type) WHERE company_id IS NOT NULL
         DO UPDATE SET
           config = $2::jsonb, is_connected = true,
           last_connected_date = NOW(), is_connection_error = false, updated_date = NOW()`,
        [companyId, JSON.stringify({ storeName, scriptTagId, accessToken: access_token })]
      );

      res.redirect("/#/integrations?connected=shopifyCustomApp");
    } catch (e) { err(res, e.message, 500); }
  });

  // ── POST webhook - receive DAG completion from Airflow ────────────────────────
  // No authenticate middleware - called by Airflow. company_id must be in the body
  // (passed via conf.company_id when the DAG run is triggered).
  router.post("/webhook/dag-complete", async (req, res) => {
    const { integration_type, company_id, is_connected, connection_error, is_synced, sync_error } = req.body;
    if (!integration_type || !VALID_TYPES.includes(integration_type)) {
      return err(res, "Invalid integration_type");
    }
    if (!company_id) return err(res, "company_id is required");
    try {
      const sets = [];
      const vals = [integration_type, company_id];
      let i = 3;

      if (is_connected !== undefined) {
        sets.push(`is_connected = $${i++}`); vals.push(is_connected);
        if (is_connected) sets.push(`last_connected_date = NOW()`);
      }
      if (connection_error !== undefined) {
        sets.push(`connection_error = $${i++}`); vals.push(connection_error);
        sets.push(`is_connection_error = $${i++}`); vals.push(!!connection_error);
      }
      if (is_synced !== undefined) {
        sets.push(`is_synced = $${i++}`); vals.push(is_synced);
        if (is_synced) sets.push(`last_synced_date = NOW()`);
      }
      if (sync_error !== undefined) {
        sets.push(`sync_error = $${i++}`); vals.push(sync_error);
        sets.push(`is_sync_error = $${i++}`); vals.push(!!sync_error);
      }
      if (!sets.length) return err(res, "No updates provided");
      sets.push("updated_date = NOW()");

      await pool.query(
        `UPDATE app.data_integrations SET ${sets.join(", ")} WHERE integration_type = $1 AND company_id = $2`,
        vals
      );
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── GET company_report_config ─────────────────────────────────────────────────
  router.get("/config/report", async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.company_report_config ORDER BY created_date LIMIT 1`
      );
      ok(res, rows[0] || null);
    } catch (e) { err(res, e.message, 500); }
  });

  // ── PATCH company_report_config ───────────────────────────────────────────────
  router.patch("/config/report", async (req, res) => {
    const allowed = ["capsuite_ref", "is_trial", "url_domain", "supporting_capsuite_param", "cdp_reports", "ga_reports"];
    const keys = Object.keys(req.body).filter((k) => allowed.includes(k));
    if (!keys.length) return err(res, "No valid fields to update");
    try {
      const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      const vals = keys.map((k) => req.body[k]);
      const { rows } = await pool.query(
        `UPDATE app.company_report_config SET ${sets}, updated_date = NOW() RETURNING *`,
        vals
      );
      ok(res, rows[0] || null);
    } catch (e) { err(res, e.message, 500); }
  });

  // ── GET web_content_html_elements ─────────────────────────────────────────────
  router.get("/config/web-content", async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.web_content_html_elements ORDER BY created_date LIMIT 1`
      );
      ok(res, rows[0] || null);
    } catch (e) { err(res, e.message, 500); }
  });

  // ── PATCH web_content_html_elements ───────────────────────────────────────────
  router.patch("/config/web-content", async (req, res) => {
    const allowed = ["capsuite_ref", "cut_off_point_after", "cut_off_point_before", "update_time_elements", "error_strings", "valid_content_min_length", "url_pattern"];
    const keys = Object.keys(req.body).filter((k) => allowed.includes(k));
    if (!keys.length) return err(res, "No valid fields to update");
    try {
      const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      const vals = keys.map((k) => req.body[k]);
      const { rows } = await pool.query(
        `UPDATE app.web_content_html_elements SET ${sets}, updated_date = NOW() RETURNING *`,
        vals
      );
      ok(res, rows[0] || null);
    } catch (e) { err(res, e.message, 500); }
  });

  return router;
}
