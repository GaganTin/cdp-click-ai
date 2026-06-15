// Phase-2 bridge: trigger the Selenium content-scrape Airflow DAG for a company.
// Opt-in via AIRFLOW_BASE_URL. When unset, callers fall back to the in-process
// Node crawler, so the Content tab works without Airflow.

// dag_id is a code constant (defined by the DAG in
// dags/click_cdp_ai_dags/attributes/attributes_content_scrape.py), mirroring the
// integration DAG map in integrationQueue.js - kept out of .env so config stays in
// code/DB. An env override is honoured if the deployed dag_id ever differs.
const CONTENT_SCRAPE_DAG_ID = process.env.CONTENT_SCRAPE_DAG_ID || "cdp_click_ai_attributes_content_scrape";

export async function triggerContentScrape(pool, companyId, { pageUrls = null, jobId = null } = {}) {
  const dagId = CONTENT_SCRAPE_DAG_ID;
  const base = (process.env.AIRFLOW_BASE_URL || "").replace(/\/$/, "");
  if (!base) return { triggered: false };

  const { rows } = await pool.query(`SELECT capsuite_ref FROM app.companies WHERE id = $1`, [companyId]);
  const capsuiteRef = rows[0]?.capsuite_ref;
  if (!capsuiteRef) return { triggered: false };

  const user = process.env.AIRFLOW_USER || "admin";
  const pass = process.env.AIRFLOW_PASS || "";
  const runId = `content_scrape_${companyId}_${jobId || "run"}`;
  const resp = await fetch(`${base}/api/v1/dags/${dagId}/dagRuns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
    },
    body: JSON.stringify({
      dag_run_id: runId,
      conf: { str_client_name: capsuiteRef, company_id: companyId, job_id: jobId, page_urls: pageUrls },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Airflow ${resp.status}: ${text}`);
  }
  return { triggered: true, runId };
}
