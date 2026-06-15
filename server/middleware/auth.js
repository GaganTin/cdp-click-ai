import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "cdp-dev-secret-change-in-production";
const COOKIE_NAME = "cdp_token";

export function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Optional DB handle so authenticate can invalidate tokens issued before the
// user's last password change. Set once at startup (setAuthPool). If unset, the
// password-change check is skipped (auth still works).
let _authPool = null;
export function setAuthPool(pool) { _authPool = pool; }

export async function authenticate(req, res, next) {
  const token =
    req.cookies?.[COOKIE_NAME] ||
    req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // Reject tokens minted before the account's last password change/reset, so a
  // password change signs out other sessions. Fail open on DB error (no lockout).
  if (_authPool && payload.id && payload.iat) {
    try {
      const { rows } = await _authPool.query(
        "SELECT password_changed_at FROM app.users WHERE id = $1",
        [payload.id]
      );
      const changedAt = rows[0]?.password_changed_at;
      if (changedAt && payload.iat * 1000 < new Date(changedAt).getTime()) {
        return res.status(401).json({ error: "Session expired, please sign in again" });
      }
    } catch { /* fail open */ }
  }

  req.user = payload;
  next();
}

export function withCompany(pool) {
  return async (req, res, next) => {
    const companyId = req.headers["x-company-id"];
    if (!companyId) {
      return res.status(400).json({ error: "x-company-id header required" });
    }

    try {
      const { rows } = await pool.query(
        `SELECT cm.id AS member_id, cm.role, cm.status,
                c.name AS company_name, c.slug, c.plan, c.settings, c.logo_url
         FROM app.company_members cm
         JOIN app.companies c ON c.id = cm.company_id
         WHERE cm.company_id = $1 AND cm.user_id = $2
           AND cm.status = 'active' AND c.is_active = true`,
        [companyId, req.user.id]
      );

      if (!rows.length) {
        return res.status(403).json({ error: "Access denied to this company" });
      }

      req.companyId = companyId;
      req.companyMember = rows[0];
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Resolve a numeric plan limit for a company's account plan. Returns null for
// "unlimited" (null/absent in the plan catalog). Used to gate create endpoints.
// A per-account override (accounts.settings.limit_overrides.<key>, set from the
// Studio account panel) takes precedence over the plan catalog value.
export async function planLimit(pool, companyId, key) {
  const { rows } = await pool.query(
    `SELECT p.limits->>$2 AS lim,
            a.settings->'limit_overrides'->>$2 AS ovr
       FROM app.companies c
       JOIN app.accounts a ON a.id = c.account_id
       JOIN app.plans p    ON p.id = a.plan
      WHERE c.id = $1`,
    [companyId, key]
  );
  const ovr = rows[0]?.ovr;
  const lim = ovr != null && ovr !== "" ? ovr : rows[0]?.lim;
  return lim == null || lim === "" ? null : parseInt(lim, 10);
}

// Platform-owner guard. Sits ABOVE the per-workspace roles: only users with
// app.users.is_platform_admin = true may reach the Studio admin API (/api/admin/*).
// The JWT only carries id/email, so the flag is read from the DB per request.
// Stashes req.isPlatformAdmin for downstream handlers. Use after authenticate.
export function requirePlatformAdmin(pool) {
  return async (req, res, next) => {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }
    try {
      const { rows } = await pool.query(
        "SELECT is_platform_admin FROM app.users WHERE id = $1 AND is_active = true",
        [req.user.id]
      );
      if (!rows.length || !rows[0].is_platform_admin) {
        return res.status(403).json({ error: "Platform owner access required" });
      }
      req.isPlatformAdmin = true;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.companyMember) {
      return res.status(403).json({ error: "No company context" });
    }
    if (!roles.includes(req.companyMember.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

// Shared guard for routers that resolve the active workspace inline (instead of
// the withCompany middleware). VERIFIES the caller is an active member of the
// x-company-id workspace - without this, any logged-in user could pass any
// company id and read/write another tenant's data (cross-tenant IDOR).
//
// Returns the company_id string, or null AFTER sending the error response (so
// callers do `const cid = await resolveCompanyId(...); if (!cid) return;`).
// Also sets req.companyRole and, by default, blocks `viewer` from any mutating
// request. Pass { blockViewerOnPost:false } for routers whose POST endpoints are
// read-style (e.g. the analyst), where only PATCH/PUT/DELETE should be blocked.
export async function resolveCompanyId(pool, req, res, { blockViewerOnPost = true } = {}) {
  const id = req.headers["x-company-id"];
  if (!id) { res.status(400).json({ error: "x-company-id header required" }); return null; }
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT cm.role, a.plan AS account_plan, a.plan_expires_at
         FROM app.company_members cm
         JOIN app.companies c ON c.id = cm.company_id
         JOIN app.accounts a ON a.id = c.account_id
        WHERE cm.company_id = $1 AND cm.user_id = $2
          AND cm.status = 'active' AND c.is_active = true`,
      [id, req.user.id]
    ));
  } catch (e) {
    res.status(500).json({ error: e.message }); return null;
  }
  if (!rows.length) { res.status(403).json({ error: "Access denied to this company" }); return null; }
  req.companyRole = rows[0].role;

  // Trial gate: an expired free account is fully read-only (any non-GET blocked),
  // regardless of role. GET/HEAD always allowed so they can still view their data.
  const isWrite = !["GET", "HEAD"].includes(req.method);
  if (isWrite && rows[0].account_plan === "free" && rows[0].plan_expires_at
      && new Date(rows[0].plan_expires_at).getTime() < Date.now()) {
    res.status(402).json({ error: "Your free trial has ended. Upgrade to keep making changes." });
    return null;
  }

  // Viewer write block (role-based; per-router POST policy via blockViewerOnPost).
  const mutating = blockViewerOnPost
    ? isWrite
    : ["PATCH", "PUT", "DELETE"].includes(req.method);
  if (mutating && rows[0].role === "viewer") {
    res.status(403).json({ error: "Viewers have read-only access" }); return null;
  }
  return id;
}
