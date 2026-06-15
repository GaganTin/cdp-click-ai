// DB-backed sync job queue.
// Jobs are rows in app.integration_sync_jobs with status='queued'.
// Claims use FOR UPDATE SKIP LOCKED so multiple server instances are safe.
// On startup, orphaned 'running' jobs older than 15 min are reset to 'queued',
// recovering from server crashes mid-run.

import { notifyCompany } from "./notifications.js";

// Friendly labels for the integration types we notify about.
const INTEGRATION_LABELS = {
  googleAnalytics:     "Google Analytics",
  googleSearchConsole: "Google Search Console",
  shopify:             "Shopify",
};
const integrationLabel = (t) => INTEGRATION_LABELS[t] || t;

const DAG_MAP = {
  // Every type runs the SAME consolidated click_cdp_ai pattern: one DAG family
  // per source, conf-driven (str_client_name = this workspace), mapped one task
  // per client, reporting back via the dag-complete webhook. No trial/landing
  // split. The commerce DAGs run their raw datasets in series per store then
  // refresh the neutral commerce.* layer inline before reporting success.
  googleAnalytics:      "click_cdp_ai_integration_ga_reports",
  googleSearchConsole:  "click_cdp_ai_gsc_keyword_performance",
  shopify:              "click_cdp_ai_integration_shopify",
  shopline:             "click_cdp_ai_integration_shopline",
  odoo:                 "click_cdp_ai_integration_odoo",
};

async function triggerAirflowDag(dagId, payload) {
  const base = (process.env.AIRFLOW_BASE_URL || "").replace(/\/$/, "");
  const user = process.env.AIRFLOW_USER || "admin";
  const pass = process.env.AIRFLOW_PASS || "";

  if (!base) {
    console.log(`[Queue] Dev mode- skipping DAG trigger for ${dagId}`);
    return { dag_run_id: payload.dag_run_id };
  }

  const resp = await fetch(`${base}/api/v1/dags/${dagId}/dagRuns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Airflow ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function resetStaleJobs(pool) {
  try {
    const { rowCount } = await pool.query(`
      UPDATE app.integration_sync_jobs
      SET status = 'queued', updated_date = NOW()
      WHERE status = 'running'
        AND started_at < NOW() - INTERVAL '15 minutes'
    `);
    if (rowCount > 0) console.log(`[Queue] Reset ${rowCount} stale job(s) → queued`);
  } catch (e) {
    console.error("[Queue] resetStaleJobs:", e.message);
  }
}

async function processNextJob(pool) {
  let job;
  try {
    // Atomically claim the oldest queued job; other instances skip it (SKIP LOCKED)
    const { rows } = await pool.query(`
      UPDATE app.integration_sync_jobs
      SET status = 'running', started_at = NOW(), updated_date = NOW()
      WHERE id = (
        SELECT id FROM app.integration_sync_jobs
        WHERE status = 'queued'
        ORDER BY created_date ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `);
    job = rows[0];
  } catch (e) {
    console.error("[Queue] job claim error:", e.message);
    return;
  }

  if (!job) return; // Queue empty

  const dagId = DAG_MAP[job.integration_type];
  if (!dagId) {
    await pool.query(
      `UPDATE app.integration_sync_jobs
       SET status='failed', error_message=$1, completed_at=NOW(), updated_date=NOW()
       WHERE id=$2`,
      [`No sync DAG configured for integration type "${job.integration_type}"`, job.id]
    );
    return;
  }

  const runId = `sync_${job.integration_type}_${job.id}`;
  const meta  = job.metadata || {};
  const isDev = !process.env.AIRFLOW_BASE_URL;

  try {
    await triggerAirflowDag(dagId, {
      dag_run_id: runId,
      conf: {
        str_client_name:  meta.client_name || process.env.CLIENT_NAME || "default",
        company_id:       job.company_id,
        integration_type: job.integration_type,
        job_id:           job.id,
        // The first sync backfills the full plan window (3y free / 5y paid) and
        // every later run is incremental - both handled by ga_sync_control in
        // pg_state, so we never force a debug window here.
        is_debugging:     false,
      },
    });

    await pool.query(
      `UPDATE app.integration_sync_jobs SET airflow_run_id=$1, updated_date=NOW() WHERE id=$2`,
      [runId, job.id]
    );

    // In dev mode (no Airflow), resolve immediately so the UI doesn't hang
    if (isDev) {
      await pool.query(
        `UPDATE app.integration_sync_jobs
         SET status='completed', completed_at=NOW(), updated_date=NOW()
         WHERE id=$1`,
        [job.id]
      );
      await pool.query(
        `UPDATE app.data_integrations
         SET is_synced=true, last_synced_date=NOW(),
             is_sync_error=false, sync_error=null, updated_date=NOW()
         WHERE integration_type=$1 AND company_id=$2`,
        [job.integration_type, job.company_id]
      );
      await pool.query(
        `INSERT INTO app.integration_audit_log
           (company_id, integration_type, action, actor, detail)
         VALUES ($1,$2,'sync_completed','system','Dev mode auto-complete')`,
        [job.company_id, job.integration_type]
      );
      await notifyCompany(pool, {
        companyId: job.company_id,
        type: "sync_status",
        title: `${integrationLabel(job.integration_type)} sync completed`,
        body: "Your latest data has finished syncing.",
        link: "/integrations",
        metadata: { integration_type: job.integration_type, status: "completed", job_id: job.id },
      });
    }

    console.log(`[Queue] Triggered ${dagId}- job ${job.id} (${job.integration_type})`);
  } catch (e) {
    console.error(`[Queue] DAG trigger failed for job ${job.id}:`, e.message);
    await pool.query(
      `UPDATE app.integration_sync_jobs
       SET status='failed', error_message=$1, completed_at=NOW(), updated_date=NOW()
       WHERE id=$2`,
      [e.message, job.id]
    );
    await pool.query(
      `UPDATE app.data_integrations
       SET is_sync_error=true, sync_error=$1, updated_date=NOW()
       WHERE integration_type=$2 AND company_id=$3`,
      [e.message, job.integration_type, job.company_id]
    );
    await pool.query(
      `INSERT INTO app.integration_audit_log
         (company_id, integration_type, action, actor, detail)
       VALUES ($1,$2,'sync_failed','system',$3)`,
      [job.company_id, job.integration_type, e.message]
    );
    await notifyCompany(pool, {
      companyId: job.company_id,
      type: "sync_status",
      title: `${integrationLabel(job.integration_type)} sync failed`,
      body: "We couldn't complete the sync. Open Integrations to retry.",
      link: "/integrations",
      metadata: { integration_type: job.integration_type, status: "failed", job_id: job.id },
    });
  }

  // Drain: keep processing until the queue is empty
  await processNextJob(pool);
}

export function startIntegrationQueueWorker(pool) {
  console.log("  Queue: Integration sync worker starting");

  // Startup pass: reset stale jobs then drain (handles server restarts)
  setTimeout(async () => {
    await resetStaleJobs(pool);
    await processNextJob(pool);
  }, 3_000);

  // Periodic poll every 30 s (catches jobs queued between polls)
  setInterval(async () => {
    await resetStaleJobs(pool);
    await processNextJob(pool);
  }, 30_000);
}

// Exported so the routes can enqueue a job and then immediately attempt to run it
export { processNextJob };
