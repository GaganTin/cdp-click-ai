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

export function authenticate(req, res, next) {
  const token =
    req.cookies?.[COOKIE_NAME] ||
    req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
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
