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

  // A run with this (deterministic) run id already exists- almost always a slow
  // run we re-triggered, not a real error. Signal "already running" so the caller
  // can leave the job alone instead of recording a false failure.
  if (resp.status === 409) {
    return { alreadyExists: true, dag_run_id: payload.dag_run_id };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Airflow ${resp.status}: ${text}`);
  }
  return resp.json();
}

// Read the current state of a specific DAG run (queued|running|success|failed),
// or "not_found" if Airflow has no such run, or null if Airflow is unreachable /
// returns something unexpected (caller should treat null as "don't assume").
async function getAirflowDagRunState(dagId, runId) {
  const base = (process.env.AIRFLOW_BASE_URL || "").replace(/\/$/, "");
  if (!base || !dagId || !runId) return null;
  const user = process.env.AIRFLOW_USER || "admin";
  const pass = process.env.AIRFLOW_PASS || "";

  try {
    const resp = await fetch(
      `${base}/api/v1/dags/${dagId}/dagRuns/${encodeURIComponent(runId)}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
        },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (resp.status === 404) return "not_found";
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.state || null;
  } catch (e) {
    console.error(`[Queue] getAirflowDagRunState ${runId}:`, e.message);
    return null;
  }
}

// Mark a job (and its integration row) completed, mirroring the dag-complete
// webhook so reconciliation and dev-mode share one code path.
async function markJobCompleted(pool, job, { detail = "Sync completed" } = {}) {
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
     VALUES ($1,$2,'sync_completed','system',$3)`,
    [job.company_id, job.integration_type, detail]
  );
  // Job-backed syncs are user-triggered ("manual"); the daily all-workspace run
  // posts its own "daily sync" notification from the scheduled webhook path.
  const trigger = job.triggered_by || "manual";
  await notifyCompany(pool, {
    companyId: job.company_id,
    type: "sync_status",
    title: `${integrationLabel(job.integration_type)} manual sync completed`,
    body: "Your manually triggered sync has finished.",
    link: "/integrations",
    metadata: { integration_type: job.integration_type, status: "completed", job_id: job.id, trigger },
  });
}

// Mark a job (and its integration row) failed, mirroring the dag-complete webhook.
async function markJobFailed(pool, job, message) {
  await pool.query(
    `UPDATE app.integration_sync_jobs
     SET status='failed', error_message=$1, completed_at=NOW(), updated_date=NOW()
     WHERE id=$2`,
    [message, job.id]
  );
  await pool.query(
    `UPDATE app.data_integrations
     SET is_sync_error=true, sync_error=$1, updated_date=NOW()
     WHERE integration_type=$2 AND company_id=$3`,
    [message, job.integration_type, job.company_id]
  );
  await pool.query(
    `INSERT INTO app.integration_audit_log
       (company_id, integration_type, action, actor, detail)
     VALUES ($1,$2,'sync_failed','system',$3)`,
    [job.company_id, job.integration_type, message]
  );
  const trigger = job.triggered_by || "manual";
  await notifyCompany(pool, {
    companyId: job.company_id,
    type: "sync_status",
    title: `${integrationLabel(job.integration_type)} manual sync failed`,
    body: "We couldn't complete your manually triggered sync. Open Integrations to retry.",
    link: "/integrations",
    metadata: { integration_type: job.integration_type, status: "failed", job_id: job.id, trigger },
  });
}

// Recover jobs stuck in 'running'. A job is only "stuck" if the server crashed
// mid-run- NOT just because it has been running a while (a GA initial backfill is
// 3-5 years of data across 4 child DAGs and routinely exceeds 15 min). So before
// touching anything we ask Airflow what the run is actually doing, and only
// re-queue runs that are genuinely gone. Re-queuing a live run would re-trigger
// it, collide on the deterministic run id (409) and surface a false "Sync failed".
async function resetStaleJobs(pool) {
  try {
    const { rows: stale } = await pool.query(`
      SELECT * FROM app.integration_sync_jobs
      WHERE status = 'running'
        AND started_at < NOW() - INTERVAL '15 minutes'
    `);
    if (!stale.length) return;

    const isDev = !process.env.AIRFLOW_BASE_URL;

    for (const job of stale) {
      const dagId = DAG_MAP[job.integration_type];
      const runId = job.airflow_run_id;

      // No Airflow to consult (dev mode), or no run id recorded yet: fall back to
      // the original crash-recovery behaviour and re-queue.
      if (isDev || !dagId || !runId) {
        await pool.query(
          `UPDATE app.integration_sync_jobs SET status='queued', updated_date=NOW() WHERE id=$1`,
          [job.id]
        );
        console.log(`[Queue] Reset stale job ${job.id} → queued (no Airflow state to check)`);
        continue;
      }

      const state = await getAirflowDagRunState(dagId, runId);

      if (state === "running" || state === "queued") {
        // Alive and still working- leave it. Do NOT re-queue.
        console.log(`[Queue] Stale job ${job.id} still ${state} in Airflow; leaving as running`);
      } else if (state === "success") {
        // Finished, but the dag-complete webhook never landed- reconcile.
        console.log(`[Queue] Stale job ${job.id} succeeded in Airflow; reconciling → completed`);
        await markJobCompleted(pool, job, { detail: "Reconciled from Airflow (completion webhook missed)" });
      } else if (state === "failed") {
        console.log(`[Queue] Stale job ${job.id} failed in Airflow; reconciling → failed`);
        await markJobFailed(pool, job, "DAG run failed (reconciled from Airflow; no completion webhook received)");
      } else if (state === "not_found") {
        // No such run- the trigger was lost (e.g. crash around trigger time).
        // Safe to re-queue: the retry creates a fresh run with no collision.
        await pool.query(
          `UPDATE app.integration_sync_jobs SET status='queued', updated_date=NOW() WHERE id=$1`,
          [job.id]
        );
        console.log(`[Queue] Stale job ${job.id} has no Airflow run; reset → queued`);
      } else {
        // state === null: Airflow unreachable / unexpected. Be conservative- leave
        // the job running and re-check next poll rather than risk a false failure.
        console.log(`[Queue] Stale job ${job.id}: Airflow state unknown; will re-check next poll`);
      }
    }
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
    const trigger = await triggerAirflowDag(dagId, {
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

    // The run already exists (we re-triggered a still-running sync). Leave the job
    // 'running' so the dag-complete webhook can resolve it- recording a failure
    // here would be wrong, the DAG is fine.
    if (trigger?.alreadyExists) {
      console.log(`[Queue] DAG run ${runId} already exists- job ${job.id} left running`);
    } else if (isDev) {
      // In dev mode (no Airflow), resolve immediately so the UI doesn't hang.
      await markJobCompleted(pool, job, { detail: "Dev mode auto-complete" });
    } else {
      console.log(`[Queue] Triggered ${dagId}- job ${job.id} (${job.integration_type})`);
    }
  } catch (e) {
    console.error(`[Queue] DAG trigger failed for job ${job.id}:`, e.message);
    await markJobFailed(pool, job, e.message);
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
