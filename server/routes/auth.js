import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { createToken, setAuthCookie, clearAuthCookie, authenticate } from "../middleware/auth.js";

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function uniqueSlug(pool, base) {
  const slug = slugify(base) || "company";
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i}`;
    const { rows } = await pool.query(
      "SELECT id FROM app.companies WHERE LOWER(slug) = LOWER($1)",
      [candidate]
    );
    if (!rows.length) return candidate;
  }
}

export function createAuthRouter(pool) {
  const router = Router();

  // POST /api/auth/register - create user + first company
  router.post("/register", async (req, res) => {
    const { email, password, full_name, company_name } = req.body;
    if (!email || !password || !full_name || !company_name) {
      return res.status(400).json({ error: "email, password, full_name, company_name are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: existing } = await client.query(
        "SELECT id FROM app.users WHERE LOWER(email) = LOWER($1)",
        [email]
      );
      if (existing.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Email is already registered" });
      }

      const password_hash = await bcrypt.hash(password, 12);
      const { rows: [user] } = await client.query(
        `INSERT INTO app.users (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, full_name, avatar_url, is_email_verified, created_date`,
        [email.toLowerCase(), password_hash, full_name]
      );

      const slug = await uniqueSlug(client, company_name);
      const { rows: [company] } = await client.query(
        `INSERT INTO app.companies (name, slug) VALUES ($1, $2)
         RETURNING id, name, slug, plan, logo_url`,
        [company_name, slug]
      );

      await client.query(
        `INSERT INTO app.company_members (company_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')`,
        [company.id, user.id]
      );

      await client.query(
        `INSERT INTO app.user_preferences (user_id, company_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [user.id, company.id]
      );

      await client.query(
        `INSERT INTO app.audit_log (company_id, user_id, action, resource_type, resource_id)
         VALUES ($1, $2, 'register', 'user', $3)`,
        [company.id, user.id, user.id]
      );

      await client.query("COMMIT");

      const token = createToken({ id: user.id, email: user.email });
      setAuthCookie(res, token);

      res.status(201).json({
        user: { ...user, companies: [{ ...company, role: "owner" }] },
        token,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // POST /api/auth/login
  router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    try {
      const { rows } = await pool.query(
        `SELECT u.*,
           COALESCE(
             json_agg(
               json_build_object('id', c.id, 'name', c.name, 'slug', c.slug,
                 'plan', c.plan, 'logo_url', c.logo_url, 'role', cm.role)
               ORDER BY cm.joined_at
             ) FILTER (WHERE c.id IS NOT NULL),
             '[]'
           ) AS companies
         FROM app.users u
         LEFT JOIN app.company_members cm ON cm.user_id = u.id AND cm.status = 'active'
         LEFT JOIN app.companies c ON c.id = cm.company_id AND c.is_active = true
         WHERE LOWER(u.email) = LOWER($1) AND u.is_active = true
         GROUP BY u.id`,
        [email]
      );

      if (!rows.length) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const user = rows[0];
      if (!user.password_hash) {
        return res.status(401).json({ error: "No password set - use your login provider" });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      await pool.query(
        "UPDATE app.users SET last_login_at = NOW() WHERE id = $1",
        [user.id]
      );

      await pool.query(
        `INSERT INTO app.audit_log (user_id, action, resource_type, resource_id, ip_address, user_agent)
         VALUES ($1, 'login', 'user', $2, $3, $4)`,
        [user.id, user.id, req.ip, req.headers["user-agent"]]
      );

      const token = createToken({ id: user.id, email: user.email });
      setAuthCookie(res, token);

      const { password_hash, email_verify_token, ...safeUser } = user;
      res.json({ user: safeUser, token });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/logout
  router.post("/logout", authenticate, async (req, res) => {
    await pool.query(
      `INSERT INTO app.audit_log (user_id, action, resource_type, resource_id)
       VALUES ($1, 'logout', 'user', $2)`,
      [req.user.id, req.user.id]
    ).catch(() => {});
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  // GET /api/auth/me
  router.get("/me", authenticate, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.id, u.email, u.full_name, u.avatar_url,
                u.is_email_verified, u.last_login_at, u.created_date,
           COALESCE(
             json_agg(
               json_build_object('id', c.id, 'name', c.name, 'slug', c.slug,
                 'plan', c.plan, 'logo_url', c.logo_url, 'role', cm.role,
                 'created_date', c.created_date)
               ORDER BY cm.joined_at
             ) FILTER (WHERE c.id IS NOT NULL),
             '[]'
           ) AS companies
         FROM app.users u
         LEFT JOIN app.company_members cm ON cm.user_id = u.id AND cm.status = 'active'
         LEFT JOIN app.companies c ON c.id = cm.company_id AND c.is_active = true
         WHERE u.id = $1 AND u.is_active = true
         GROUP BY u.id`,
        [req.user.id]
      );
      if (!rows.length) return res.status(401).json({ error: "User not found" });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/auth/me - update profile
  router.patch("/me", authenticate, async (req, res) => {
    const { full_name, avatar_url } = req.body;
    const sets = [];
    const vals = [];
    if (full_name !== undefined) { sets.push(`full_name = $${sets.length + 1}`); vals.push(full_name); }
    if (avatar_url !== undefined) { sets.push(`avatar_url = $${sets.length + 1}`); vals.push(avatar_url); }
    if (!sets.length) return res.status(400).json({ error: "No fields to update" });

    try {
      vals.push(req.user.id);
      const { rows } = await pool.query(
        `UPDATE app.users SET ${sets.join(", ")} WHERE id = $${vals.length}
         RETURNING id, email, full_name, avatar_url, is_email_verified`,
        vals
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/auth/me/password - change password
  router.patch("/me/password", authenticate, async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "current_password and new_password are required" });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    try {
      const { rows } = await pool.query(
        "SELECT password_hash FROM app.users WHERE id = $1",
        [req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "User not found" });

      const valid = await bcrypt.compare(current_password, rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

      const hash = await bcrypt.hash(new_password, 12);
      await pool.query("UPDATE app.users SET password_hash = $1 WHERE id = $2", [hash, req.user.id]);

      await pool.query(
        `INSERT INTO app.audit_log (user_id, action, resource_type, resource_id)
         VALUES ($1, 'password_changed', 'user', $2)`,
        [req.user.id, req.user.id]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/forgot-password
  router.post("/forgot-password", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });

    try {
      const { rows } = await pool.query(
        "SELECT id FROM app.users WHERE LOWER(email) = LOWER($1) AND is_active = true",
        [email]
      );

      if (rows.length) {
        const token = crypto.randomBytes(32).toString("hex");
        const token_hash = crypto.createHash("sha256").update(token).digest("hex");

        await pool.query(
          `INSERT INTO app.password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
          [rows[0].id, token_hash]
        );

        if (process.env.NODE_ENV !== "production") {
          return res.json({ ok: true, debug_reset_token: token });
        }
        // TODO: send email with reset link
      }

      res.json({ ok: true, message: "If that email exists, a reset link has been sent." });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/reset-password
  router.post("/reset-password", async (req, res) => {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return res.status(400).json({ error: "token and new_password are required" });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    try {
      const token_hash = crypto.createHash("sha256").update(token).digest("hex");
      const { rows } = await pool.query(
        `SELECT * FROM app.password_reset_tokens
         WHERE token_hash = $1 AND expires_at > NOW() AND used_at IS NULL`,
        [token_hash]
      );
      if (!rows.length) {
        return res.status(400).json({ error: "Invalid or expired reset token" });
      }

      const hash = await bcrypt.hash(new_password, 12);
      await pool.query("UPDATE app.users SET password_hash = $1 WHERE id = $2", [hash, rows[0].user_id]);
      await pool.query(
        "UPDATE app.password_reset_tokens SET used_at = NOW() WHERE id = $1",
        [rows[0].id]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Google OAuth 2.0 ─────────────────────────────────────────────────────────

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/auth/google/callback";
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

  // GET /api/auth/google - redirect to consent screen
  router.get("/google", (req, res) => {
    if (!GOOGLE_CLIENT_ID) {
      return res.redirect(`${FRONTEND_URL}/login?error=google_not_configured`);
    }
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  // GET /api/auth/google/callback - exchange code, upsert user, set cookie
  router.get("/google/callback", async (req, res) => {
    const { code, error: oauthError } = req.query;
    if (oauthError || !code) {
      return res.redirect(`${FRONTEND_URL}/login?error=google_cancelled`);
    }

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });
      const tokens = await tokenRes.json();
      if (tokens.error) {
        return res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
      }

      const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const gUser = await profileRes.json();
      if (!gUser.email) {
        return res.redirect(`${FRONTEND_URL}/login?error=google_no_email`);
      }

      const { rows: existing } = await pool.query(
        "SELECT id FROM app.users WHERE LOWER(email) = LOWER($1)",
        [gUser.email]
      );

      let userId;
      if (existing.length) {
        userId = existing[0].id;
        await pool.query(
          `UPDATE app.users
           SET avatar_url = COALESCE(NULLIF(avatar_url,''), $1),
               is_email_verified = true, last_login_at = NOW()
           WHERE id = $2`,
          [gUser.picture || null, userId]
        );
      } else {
        const { rows: [newUser] } = await pool.query(
          `INSERT INTO app.users (email, full_name, avatar_url, is_email_verified, last_login_at)
           VALUES ($1, $2, $3, true, NOW()) RETURNING id`,
          [gUser.email.toLowerCase(), gUser.name || gUser.email, gUser.picture || null]
        );
        userId = newUser.id;
      }

      await pool.query(
        `INSERT INTO app.audit_log (user_id, action, resource_type, resource_id, ip_address)
         VALUES ($1, $2, 'user', $3, $4)`,
        [userId, existing.length ? "login_google" : "register_google", userId, req.ip]
      );

      const jwtToken = createToken({ id: userId, email: gUser.email });
      setAuthCookie(res, jwtToken);
      res.redirect(`${FRONTEND_URL}/`);
    } catch (err) {
      console.error("Google OAuth error:", err.message);
      res.redirect(`${FRONTEND_URL}/login?error=server_error`);
    }
  });

  // GET /api/auth/google/status - check if Google OAuth is configured (for UI)
  router.get("/google/status", (_req, res) => {
    res.json({ configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
  });

  return router;
}
