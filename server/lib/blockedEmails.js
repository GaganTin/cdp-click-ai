// Emails that previously owned (or belonged to) an account that was deleted.
// Once blocked, the email can never sign up or sign in again - on ANY provider
// (password, Google, Microsoft). Kept in its own table with NO foreign key so the
// record survives the account-deletion cascade that removes the original user row.

// Thrown by the shared OAuth provisioning path when a blocked email tries to come
// back in. Carries a stable `code` so the OAuth callbacks can redirect with a
// meaningful error instead of a generic failure.
export class BlockedEmailError extends Error {
  constructor(message = "This email was used for an account that has been deleted and can no longer be used.") {
    super(message);
    this.name = "BlockedEmailError";
    this.code = "account_deleted";
  }
}

// True if the email is on the deleted-account blocklist (case-insensitive).
export async function isEmailBlocked(pool, email) {
  if (!email) return false;
  const { rows } = await pool.query(
    "SELECT 1 FROM app.blocked_emails WHERE email = LOWER($1)",
    [String(email).trim()]
  );
  return rows.length > 0;
}

// Record one or more emails on the blocklist. Idempotent (re-blocking refreshes
// the row). `db` may be a pool or a transaction client.
export async function blockEmails(db, emails, { accountId = null, reason = "account_deleted" } = {}) {
  const list = [...new Set(
    (Array.isArray(emails) ? emails : [emails])
      .filter(Boolean)
      .map((e) => String(e).trim().toLowerCase())
  )];
  for (const email of list) {
    await db.query(
      `INSERT INTO app.blocked_emails (email, reason, account_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET reason = EXCLUDED.reason, account_id = EXCLUDED.account_id, blocked_at = NOW()`,
      [email, reason, accountId]
    );
  }
  return list;
}
