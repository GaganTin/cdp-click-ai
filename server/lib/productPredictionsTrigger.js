// Trigger the product-replenishment predictions Airflow DAG for one workspace.
// Called right AFTER refreshCommerceProfiles() at every commerce-change site
// (platform-sync webhook + manual CSV import), so it runs once commerce.* is
// fresh AND app.customer_profiles exist for the roll-up to write onto.
//
// Opt-in via AIRFLOW_BASE_URL: when unset (dev), this is a no-op so the commerce
// flow works without Airflow. Mirrors server/lib/contentScrapeTrigger.js.

// dag_id is a code constant (the DAG in
// dags/click_cdp_ai_dags/commerce/build_product_predictions.py), with an env
// override honoured if the deployed dag_id ever differs.
const PRODUCT_PREDICTIONS_DAG_ID = process.env.PRODUCT_PREDICTIONS_DAG_ID || "click_cdp_ai_build_product_predictions";

export async function triggerProductPredictions(pool, companyId, { jobId = null } = {}) {
  const dagId = PRODUCT_PREDICTIONS_DAG_ID;
  const base = (process.env.AIRFLOW_BASE_URL || "").replace(/\/$/, "");
  if (!base) return { triggered: false };

  // The DAG scopes to one workspace by capsuite_ref (str_client_name).
  const { rows } = await pool.query(`SELECT capsuite_ref FROM app.companies WHERE id = $1`, [companyId]);
  const capsuiteRef = rows[0]?.capsuite_ref;
  if (!capsuiteRef) return { triggered: false };

  const user = process.env.AIRFLOW_USER || "admin";
  const pass = process.env.AIRFLOW_PASS || "";
  // jobId (manual import batch id) makes the run id unique; otherwise a timestamp
  // avoids a 409 collision when two syncs finish close together.
  const runId = `predictions_${companyId}_${jobId || Date.now()}`;
  const resp = await fetch(`${base}/api/v1/dags/${dagId}/dagRuns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
    },
    body: JSON.stringify({
      dag_run_id: runId,
      conf: { str_client_name: capsuiteRef, company_id: companyId, job_id: jobId },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  // 409 = a run with this id already exists; treat as already-queued, not an error.
  if (resp.status === 409) return { triggered: false, alreadyExists: true };
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Airflow ${resp.status}: ${text}`);
  }
  return { triggered: true, runId };
}
