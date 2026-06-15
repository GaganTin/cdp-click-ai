// Scan-based notification producer (in-app only).
//
// new_leads isn't tied to an in-process action: pop-up leads are captured by the
// external interaction service and land in app.popup_email_collected via ETL, so
// there's no request to hook. We poll for fresh rows instead.
//
// Uses dedupe_key so the worker can run as often as it likes (and be re-run
// manually) without producing duplicates - see notifyCompany().

import { notifyCompany } from "./notifications.js";

const MINUTE = 60 * 1000;

/**
 * Notify workspaces about pop-up leads captured since the start of the current
 * time-bucket. Bucketing the window to `windowMinutes` makes the dedupe_key
 * stable within a tick, so repeated calls in the same window are no-ops while
 * consecutive windows each emit once. No checkpoint table required.
 */
export async function scanNewLeads(pool, { windowMinutes = 30, now = new Date() } = {}) {
  const windowMs = windowMinutes * MINUTE;
  const bucketStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
  const since = new Date(bucketStartMs).toISOString();
  const bucketKey = since; // bucket boundary identifies this window

  let created = 0;
  try {
    const { rows } = await pool.query(
      `SELECT company_id, COUNT(*)::int AS n
         FROM app.popup_email_collected
        WHERE collected_at >= $1
        GROUP BY company_id`,
      [since]
    );
    for (const { company_id, n } of rows) {
      if (!n) continue;
      created += await notifyCompany(pool, {
        companyId: company_id,
        type: "new_leads",
        title: `${n} new lead${n === 1 ? "" : "s"} captured`,
        body: `Your pop-ups collected ${n} new contact${n === 1 ? "" : "s"}.`,
        link: "/popup",
        metadata: { count: n, since },
        dedupeKey: `new_leads:${company_id}:${bucketKey}`,
      });
    }
  } catch (e) {
    console.error("[notify-scan] scanNewLeads failed:", e.message);
  }
  return created;
}

/**
 * Background worker: polls for new leads on an interval.
 * Mirrors startIntegrationQueueWorker's lifecycle.
 */
export function startNotificationScanWorker(pool, { intervalMinutes = 30 } = {}) {
  console.log("  Queue: Notification scan worker starting");
  const tick = () => scanNewLeads(pool, { windowMinutes: intervalMinutes });
  // Small startup delay so it doesn't pile onto boot.
  setTimeout(tick, 10_000);
  setInterval(tick, intervalMinutes * MINUTE);
}
