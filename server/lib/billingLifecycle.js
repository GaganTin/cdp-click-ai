// Trial / plan lifecycle worker (reminder emails + end-of-life data purge).
//
// Runs once a day (wired in server/index.js, mirroring the nightly chart-refresh
// cron). Every account is driven off app.accounts.plan_expires_at, which is the
// existing "in trial / expiring" marker: non-NULL means the account has an access
// deadline; NULL means it was converted to a paid plan by sales (so it is exempt).
//
// Stages, all keyed off E = plan_expires_at (W = plans.warning_days, default 7;
// D = E + RETENTION_MONTHS). Each fires exactly once per expiry cycle via the
// app.account_lifecycle_events ledger:
//
//   trial_ending   E-W  .. E     -> "your trial ends soon, upgrade to Lite/Standard"
//   trial_ended    E    .. E+30d -> "ended; read-only; data deleted on D"
//   purge_warning  D-1d .. D     -> "data deleted tomorrow unless you subscribe"
//   purged         >= D          -> delete ALL data, keep account + owner shell
//
// The purge deletes every workspace (the schema cascades wipe all company-scoped
// rows across app.* and the source schemas) and every non-owner user, but KEEPS
// the account row + the owner user so the email stays registered and can never
// start a fresh trial. It will not run until the purge_warning has been sent, so
// there is always at least ~a day of notice even if the cron skips a day.

import {
  sendTrialEndingEmail,
  sendTrialEndedEmail,
  sendDataDeletionWarningEmail,
  sendDataDeletedEmail,
} from "../services/email.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Retention window between trial/plan end and permanent deletion.
export const RETENTION_MONTHS = 6;

// Don't send a late "your trial just ended" notice to accounts that expired long
// before this feature existed (they'd find it confusing). The purge_warning /
// purged stages still handle those accounts when their retention window elapses.
const ENDED_EMAIL_GRACE_DAYS = 30;

// Pull every account that still has an access deadline (not sales-converted) and
// hasn't already been purged. Platform-owner accounts are never touched.
// warn_at / purge_at are computed in SQL so month math stays on the DB clock.
const CANDIDATES_SQL = `
  SELECT a.id,
         a.name                                                   AS account_name,
         a.plan_expires_at                                        AS expires_at,
         a.owner_user_id,
         (a.plan_expires_at - make_interval(days => COALESCE(p.warning_days, 7))) AS warn_at,
         (a.plan_expires_at + make_interval(months => ${RETENTION_MONTHS}))       AS purge_at,
         u.email     AS owner_email,
         u.full_name AS owner_name
    FROM app.accounts a
    JOIN app.plans p       ON p.id = a.plan
    LEFT JOIN app.users u  ON u.id = a.owner_user_id
   WHERE a.plan_expires_at IS NOT NULL
     AND COALESCE(u.is_platform_admin, false) = false
     AND NOT (a.is_active = false AND a.metadata ? 'purged_at')`;

// Atomically claim a stage: true only the FIRST time (so the caller sends the
// email / runs the purge exactly once). expires_at makes the key cycle-specific.
async function claimStage(pool, accountId, stage, expiresAt, metadata = {}) {
  const { rows } = await pool.query(
    `INSERT INTO app.account_lifecycle_events (account_id, stage, expires_at, metadata)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, stage, expires_at) DO NOTHING
     RETURNING id`,
    [accountId, stage, expiresAt, JSON.stringify(metadata)]
  );
  return rows.length > 0;
}

// Has a given stage already been recorded for this expiry cycle?
async function stageDone(pool, accountId, stage, expiresAt) {
  const { rows } = await pool.query(
    `SELECT 1 FROM app.account_lifecycle_events
      WHERE account_id = $1 AND stage = $2 AND expires_at = $3`,
    [accountId, stage, expiresAt]
  );
  return rows.length > 0;
}

// Release a claimed stage so it retries next run (used when the action failed).
async function releaseStage(pool, accountId, stage, expiresAt) {
  await pool.query(
    `DELETE FROM app.account_lifecycle_events
      WHERE account_id = $1 AND stage = $2 AND expires_at = $3`,
    [accountId, stage, expiresAt]
  ).catch(() => {});
}

// Permanently delete all of an account's data while keeping the account + its
// owner user (so the email stays registered and cannot start a new trial).
async function purgeAccountData(pool, accountId) {
  const client = await pool.connect();
  let refs = [];
  try {
    await client.query("BEGIN");

    // Which user to keep: the billing owner, or the earliest-created user as a
    // fallback if the owner was already removed.
    const { rows: [keep] } = await client.query(
      `SELECT COALESCE(
                a.owner_user_id,
                (SELECT id FROM app.users
                  WHERE account_id = a.id ORDER BY created_date, id LIMIT 1)
              ) AS keep_user_id
         FROM app.accounts a WHERE a.id = $1`,
      [accountId]
    );
    const keepUserId = keep?.keep_user_id || null;

    // capsuite_refs drive the non-FK sync-control cleanup below.
    ({ rows: refs } = await client.query(
      "SELECT capsuite_ref FROM app.companies WHERE account_id = $1",
      [accountId]
    ));

    // Delete every workspace -> ON DELETE CASCADE wipes all company-scoped rows in
    // app.* AND the source schemas (manual/ga_landing/shopify/interaction). This is
    // the schema's designed data-wipe path, so no table needs to be enumerated.
    await client.query("DELETE FROM app.companies WHERE account_id = $1", [accountId]);

    // Account-scoped tables that would otherwise survive on the kept shell because
    // they key off account_id (not company_id) and don't cascade with the
    // workspaces. Deleting the account itself would remove them, but we keep the
    // account, so wipe them explicitly to fully honour "delete all their data".
    //   - prepaid add-ons + their ledger (buckets froze when the plan lapsed)
    //   - AI usage/cost history, audit trail, and support tickets
    await client.query("DELETE FROM app.account_addons  WHERE account_id = $1", [accountId]);
    await client.query("DELETE FROM app.addon_ledger    WHERE account_id = $1", [accountId]);
    await client.query("DELETE FROM app.ai_usage        WHERE account_id = $1", [accountId]);
    await client.query("DELETE FROM app.audit_log       WHERE account_id = $1", [accountId]);
    await client.query("DELETE FROM app.support_tickets WHERE account_id = $1", [accountId]);

    // Delete every user except the one we keep (their memberships are already gone
    // with the workspaces). Keeping the owner preserves the email registration.
    if (keepUserId) {
      await client.query(
        "DELETE FROM app.users WHERE account_id = $1 AND id <> $2",
        [accountId, keepUserId]
      );
    }

    // Deactivate + stamp the dormant shell. is_active=false + metadata.purged_at is
    // what excludes it from future lifecycle runs (see CANDIDATES_SQL).
    await client.query(
      `UPDATE app.accounts
          SET is_active = false,
              metadata  = COALESCE(metadata, '{}'::jsonb)
                          || jsonb_build_object('purged_at', to_jsonb(NOW()),
                                                'purge_reason', 'trial_expired_retention')
        WHERE id = $1`,
      [accountId]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // Best-effort cleanup of capsuite_ref-keyed sync watermarks (no FK cascade),
  // mirroring the account-delete route.
  for (const { capsuite_ref } of refs) {
    if (!capsuite_ref) continue;
    await pool.query("DELETE FROM ga_landing.ga_sync_control WHERE capsuite_ref = $1", [capsuite_ref]).catch(() => {});
    await pool.query("DELETE FROM shopify.shopify_sync_control WHERE capsuite_ref = $1", [capsuite_ref]).catch(() => {});
  }
}

/**
 * Run one pass of the trial/plan lifecycle. Idempotent and safe to re-run.
 *
 * @param {import('pg').Pool} pool
 * @param {{ now?: Date, dryRun?: boolean }} [opts]
 *   dryRun logs the action it WOULD take without sending email, purging, or
 *   writing the ledger.
 * @returns {Promise<{ending:number, ended:number, warned:number, purged:number, skipped:number}>}
 */
export async function runBillingLifecycle(pool, { now = new Date(), dryRun = false } = {}) {
  const counts = { ending: 0, ended: 0, warned: 0, purged: 0, skipped: 0 };
  const { rows: accounts } = await pool.query(CANDIDATES_SQL);

  for (const a of accounts) {
    const E = new Date(a.expires_at);
    const W = new Date(a.warn_at);
    const D = new Date(a.purge_at);
    const warnAt = new Date(D.getTime() - DAY_MS); // "deleted tomorrow" threshold
    const ownerName = a.owner_name || null;
    const email = a.owner_email || null;

    try {
      // ── Purge (>= D) ───────────────────────────────────────────────────────
      if (now >= D) {
        // Never purge without a prior warning: if the warning was skipped (cron
        // gap), send it now and defer the purge to the next run.
        if (!(await stageDone(pool, a.id, "purge_warning", E))) {
          if (dryRun) { console.log(`[lifecycle] DRY would warn (pre-purge) ${a.id} <${email}>`); counts.warned++; continue; }
          if (email && await claimStage(pool, a.id, "purge_warning", E, { deletionDate: D })) {
            try { await sendDataDeletionWarningEmail(email, { ownerName, deletionDate: D }); counts.warned++; }
            catch (e) { await releaseStage(pool, a.id, "purge_warning", E); throw e; }
          }
          continue; // hold the purge until the next daily run
        }

        if (dryRun) { console.log(`[lifecycle] DRY would PURGE account ${a.id} <${email}> (expired ${E.toISOString()})`); counts.purged++; continue; }
        // Purge first, then record it - a failed purge stays unrecorded and retries.
        await purgeAccountData(pool, a.id);
        await claimStage(pool, a.id, "purged", E, { purgedAt: now });
        if (email) { try { await sendDataDeletedEmail(email, { ownerName }); } catch (e) { console.error(`[lifecycle] deleted-email failed ${a.id}:`, e.message); } }
        counts.purged++;
        continue;
      }

      // ── Purge warning (D-1day .. D) ────────────────────────────────────────
      if (now >= warnAt) {
        if (dryRun) { if (!(await stageDone(pool, a.id, "purge_warning", E))) { console.log(`[lifecycle] DRY would warn ${a.id} <${email}>`); counts.warned++; } else counts.skipped++; continue; }
        if (email && await claimStage(pool, a.id, "purge_warning", E, { deletionDate: D })) {
          try { await sendDataDeletionWarningEmail(email, { ownerName, deletionDate: D }); counts.warned++; }
          catch (e) { await releaseStage(pool, a.id, "purge_warning", E); throw e; }
        } else counts.skipped++;
        continue;
      }

      // ── Trial ended (E .. E+grace) ─────────────────────────────────────────
      if (now >= E) {
        // Skip the "just ended" notice for accounts that expired long ago (e.g.
        // before this feature shipped); they still get purge_warning/purged later.
        if (now.getTime() - E.getTime() > ENDED_EMAIL_GRACE_DAYS * DAY_MS) { counts.skipped++; continue; }
        if (dryRun) { if (!(await stageDone(pool, a.id, "trial_ended", E))) { console.log(`[lifecycle] DRY would send ENDED ${a.id} <${email}>`); counts.ended++; } else counts.skipped++; continue; }
        if (email && await claimStage(pool, a.id, "trial_ended", E, { deletionDate: D })) {
          try { await sendTrialEndedEmail(email, { ownerName, deletionDate: D }); counts.ended++; }
          catch (e) { await releaseStage(pool, a.id, "trial_ended", E); throw e; }
        } else counts.skipped++;
        continue;
      }

      // ── Trial ending (E-W .. E) ────────────────────────────────────────────
      if (now >= W) {
        const daysLeft = Math.max(0, Math.ceil((E.getTime() - now.getTime()) / DAY_MS));
        if (dryRun) { if (!(await stageDone(pool, a.id, "trial_ending", E))) { console.log(`[lifecycle] DRY would send ENDING ${a.id} <${email}> (${daysLeft}d)`); counts.ending++; } else counts.skipped++; continue; }
        if (email && await claimStage(pool, a.id, "trial_ending", E, { daysLeft })) {
          try { await sendTrialEndingEmail(email, { ownerName, daysLeft, expiresAt: E }); counts.ending++; }
          catch (e) { await releaseStage(pool, a.id, "trial_ending", E); throw e; }
        } else counts.skipped++;
        continue;
      }

      counts.skipped++;
    } catch (e) {
      console.error(`[lifecycle] account ${a.id} failed:`, e.message);
    }
  }

  return counts;
}
