// ── Shared demo workspace ────────────────────────────────────────────────────
// A single, platform-wide, read-only "demo" workspace (app.companies.is_demo)
// that every user can explore without being a member. This module resolves and
// caches its id so the hot paths (auth middleware, /auth/me) don't hit the DB on
// every request. The demo is created/reseeded/deleted only by a platform admin
// via Studio; those paths call clearDemoCache() so the next lookup re-resolves.

// The demo workspace is resolved purely by the app.companies.is_demo flag; the
// fixed id/slug/ref used when SEEDING it live in scripts/_demo_constants.cjs.
let _cache = { id: undefined, at: 0 };
const TTL_MS = 30_000;

// Drop the cached demo id (call after provisioning/deleting the demo workspace).
export function clearDemoCache() {
  _cache = { id: undefined, at: 0 };
}

// Resolve the demo workspace's company id (or null if none exists yet). Cached
// for TTL_MS. Fails open to null on DB error so a lookup blip never blocks auth.
export async function getDemoCompanyId(pool) {
  const now = Date.now();
  if (_cache.id !== undefined && now - _cache.at < TTL_MS) return _cache.id;
  try {
    const { rows } = await pool.query(
      "SELECT id FROM app.companies WHERE is_demo = true LIMIT 1"
    );
    _cache = { id: rows[0]?.id ?? null, at: now };
  } catch {
    return null; // don't cache failures
  }
  return _cache.id;
}

// True when the given company id is the demo workspace.
export async function isDemoCompany(pool, companyId) {
  if (!companyId) return false;
  const demoId = await getDemoCompanyId(pool);
  return demoId != null && String(companyId) === String(demoId);
}

// Whether a user's account is opted in to the demo workspace. Platform admins
// toggle app.accounts.demo_enabled per account from Studio. Fails open to false
// (no demo) on error. Not cached: it's only read on the demo access path.
export async function isDemoEnabledForUser(pool, userId) {
  if (!userId) return false;
  try {
    const { rows } = await pool.query(
      `SELECT a.demo_enabled
         FROM app.users u JOIN app.accounts a ON a.id = u.account_id
        WHERE u.id = $1`,
      [userId]
    );
    return !!rows[0]?.demo_enabled;
  } catch {
    return false;
  }
}
