// In-app notification fan-out (the bell). No emails are ever sent here.
//
// A producer reports a workspace event (campaign sent, sync finished, leads
// captured) and this fans it out to every ACTIVE member of the
// workspace whose per-workspace preference for that `type` is enabled
// (app.user_preferences.notifications->>type, default ON when absent).
//
// Best-effort by design: a notification failure must never break the underlying
// action (a campaign still "sends" even if the bell insert fails), so the helper
// swallows and logs its own errors and returns the number of rows created.

export const NOTIFICATION_TYPES = [
  "campaign_completed",
  "sync_status",
  "new_leads",
];

/**
 * Fan an event out to a workspace's members, respecting their preferences.
 *
 * @param {import('pg').Pool} pool
 * @param {object} n
 * @param {string} n.companyId            target workspace
 * @param {string} n.type                 one of NOTIFICATION_TYPES
 * @param {string} n.title                short headline
 * @param {string} [n.body]               supporting line
 * @param {string} [n.link]               in-app route to open on click (e.g. "/edm")
 * @param {object} [n.metadata]           arbitrary structured payload
 * @param {string} [n.dedupeKey]          idempotency key; non-null = unique per (user,type)
 * @returns {Promise<number>} rows inserted (0 on dedupe hit or error)
 */
export async function notifyCompany(pool, { companyId, type, title, body = "", link = null, metadata = {}, dedupeKey = null }) {
  if (!pool || !companyId || !type || !title) return 0;
  if (!NOTIFICATION_TYPES.includes(type)) {
    console.warn(`[notify] unknown notification type "${type}" - skipping`);
    return 0;
  }
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO app.notifications
         (user_id, company_id, type, title, body, link, metadata, dedupe_key)
       SELECT cm.user_id, $1, $2, $3, $4, $5, $6::jsonb, $7
         FROM app.company_members cm
         LEFT JOIN app.user_preferences up
           ON up.user_id = cm.user_id AND up.company_id = $1
        WHERE cm.company_id = $1
          AND cm.status = 'active'
          AND COALESCE((up.notifications->>$2)::boolean, true) = true
       ON CONFLICT (user_id, type, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [companyId, type, title, body, link, JSON.stringify(metadata || {}), dedupeKey]
    );
    return rowCount || 0;
  } catch (e) {
    console.error(`[notify] failed to create "${type}" notifications for company ${companyId}:`, e.message);
    return 0;
  }
}
