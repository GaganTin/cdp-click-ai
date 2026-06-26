import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { createToken, setAuthCookie, clearAuthCookie, authenticate } from "../middleware/auth.js";
import { sendPasswordResetEmail, sendVerificationEmail, sendVerificationCodeEmail, sendLoginCodeEmail } from "../services/email.js";
import { registerCompanyWithInteractionService } from "../lib/interactionService.js";
import { slugify, uniqueSlug } from "../lib/slug.js";

// Simple in-memory per-IP rate limiter for sensitive auth endpoints (brute-force /
// enumeration protection). Resets on restart; for multi-instance use a shared store.
const _rl = new Map();
function rateLimit({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const e = _rl.get(key);
    if (!e || now > e.reset) { _rl.set(key, { count: 1, reset: now + windowMs }); return next(); }
    if (++e.count > max) return res.status(429).json({ error: "Too many attempts. Please try again later." });
    next();
  };
}

// Hash a verification code before storing it (never store the raw code).
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
// 6-digit numeric code, zero-padded (cryptographically random).
const genCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

// app.companies.capsuite_ref is GLOBALLY unique and is the key the external ETL
// uses to map a workspace → company_id. Generate a readable, underscore-cased
// root from the company name plus a short random suffix, retrying on collision.
async function uniqueCapsuiteRef(pool, base) {
  const root = (slugify(base) || "workspace").replace(/-/g, "_").slice(0, 40);
  for (;;) {
    const candidate = `${root}_${crypto.randomBytes(3).toString("hex")}`;
    const { rows } = await pool.query(
      "SELECT 1 FROM app.companies WHERE capsuite_ref = $1",
      [candidate]
    );
    if (!rows.length) return candidate;
  }
}

// Derive a sensible default company name for sign-ups that don't supply one
// (e.g. OAuth providers). Falls back from the person's name → email domain.
function deriveCompanyName(full_name, email) {
  const name = (full_name || "").trim();
  if (name) return `${name}'s Workspace`;
  const domain = (String(email).split("@")[1] || "").split(".")[0];
  return domain ? `${domain}'s Workspace` : "My Workspace";
}

// Provisions a brand-new signup as the full tenancy chain:
//   account (org/billing root) → user (account owner) → first company (workspace,
//   with its own capsuite_ref) → admin membership → preferences → audit row.
// All within the provided transaction client. The single source of truth for
// provisioning so email and every OAuth provider share one identical flow.
// Caller owns BEGIN/COMMIT and the (non-fatal) interaction-service registration.
async function provisionUserWithCompany(client, {
  email,
  full_name,
  company_name,
  password_hash = null,
  avatar_url = null,
  is_email_verified = false,
  action = "register",
  ip_address = null,
}) {
  // 1. Account - the org / billing root. Starts on the free plan with its trial
  //    window taken from the plan catalog (falls back to 30 days).
  const accountSlug = await uniqueSlug(client, company_name, { table: "app.accounts", fallback: "account" });
  const { rows: [account] } = await client.query(
    `INSERT INTO app.accounts (name, slug, plan, plan_expires_at)
     VALUES ($1, $2, 'free',
       NOW() + (COALESCE((SELECT trial_days FROM app.plans WHERE id = 'free'), 30)::text || ' days')::interval)
     RETURNING id, plan`,
    [company_name, accountSlug]
  );

  // 2. User - belongs to the account (NOT NULL account_id).
  const { rows: [user] } = await client.query(
    `INSERT INTO app.users (account_id, email, password_hash, full_name, avatar_url, is_email_verified, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, email, full_name, avatar_url, is_email_verified, created_date`,
    [account.id, email.toLowerCase(), password_hash, full_name, avatar_url, is_email_verified]
  );

  // 3. The first user is the account owner (always an admin on every workspace).
  await client.query(
    `UPDATE app.accounts SET owner_user_id = $1 WHERE id = $2`,
    [user.id, account.id]
  );

  // 3b. Consume any pending platform-owner invite for this email (Studio > Owners
  //     "invite by email" for someone who hadn't signed up yet).
  const { rowCount: invited } = await client.query(
    `DELETE FROM app.platform_owner_invites WHERE email = LOWER($1)`,
    [email]
  );
  if (invited) {
    await client.query(
      `UPDATE app.users SET is_platform_admin = true WHERE id = $1`,
      [user.id]
    );
  }

  // 4. First company (workspace) - account-scoped, with its own unique capsuite_ref
  //    and a denormalised copy of the account plan.
  const slug = await uniqueSlug(client, company_name);
  const capsuite_ref = await uniqueCapsuiteRef(client, company_name);
  const { rows: [company] } = await client.query(
    `INSERT INTO app.companies (account_id, name, slug, capsuite_ref, plan)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, slug, plan, logo_url, capsuite_ref`,
    [account.id, company_name, slug, capsuite_ref, account.plan]
  );

  // 5. Owner membership - role 'admin' (admin | contributor | viewer).
  await client.query(
    `INSERT INTO app.company_members (account_id, company_id, user_id, role, status)
     VALUES ($1, $2, $3, 'admin', 'active')`,
    [account.id, company.id, user.id]
  );

  await client.query(
    `INSERT INTO app.user_preferences (user_id, company_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [user.id, company.id]
  );

  await client.query(
    `INSERT INTO app.audit_log (account_id, company_id, user_id, action, resource_type, resource_id, ip_address)
     VALUES ($1, $2, $3, $4, 'account', $5, $6)`,
    [account.id, company.id, user.id, action, account.id, ip_address]
  );

  return { account, user, company };
}

// Shared OAuth landing logic. Existing users are logged in (last_login bumped);
// brand-new users get the full register flow - user + company + membership +
// preferences + interaction-service registration - so every sign-up path is
// identical. Returns the user id.
async function loginOrProvisionOAuthUser(pool, { email, full_name, avatar_url = null, provider, ip = null }) {
  const { rows: existing } = await pool.query(
    "SELECT id FROM app.users WHERE LOWER(email) = LOWER($1)",
    [email]
  );

  if (existing.length) {
    const userId = existing[0].id;
    await pool.query(
      `UPDATE app.users
       SET avatar_url = COALESCE(NULLIF(avatar_url, ''), $1),
           is_email_verified = true, last_login_at = NOW()
       WHERE id = $2`,
      [avatar_url, userId]
    );
    await pool.query(
      `INSERT INTO app.audit_log (user_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, $2, 'user', $3, $4)`,
      [userId, `login_${provider}`, userId, ip]
    );
    return userId;
  }

  // New user - provision exactly like POST /register
  const client = await pool.connect();
  let user, company;
  try {
    await client.query("BEGIN");
    ({ user, company } = await provisionUserWithCompany(client, {
      email,
      full_name,
      company_name: deriveCompanyName(full_name, email),
      avatar_url,
      is_email_verified: true,
      action: `register_${provider}`,
      ip_address: ip,
    }));
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Non-fatal: back-filled on first popup use if the service is down.
  registerCompanyWithInteractionService(pool, company.id, company.name).catch(() => {});

  return user.id;
}

// Load a login identity together with its active workspaces, shaped exactly like
// the POST /login success payload. Shared by password login and MFA verify so the
// client gets an identical user object no matter which path completed sign-in.
async function fetchUserWithCompanies(pool, userId) {
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
     WHERE u.id = $1 AND u.is_active = true
     GROUP BY u.id`,
    [userId]
  );
  return rows[0] || null;
}

export function createAuthRouter(pool) {
  const router = Router();

  // POST /api/auth/register - create user + first company
  router.post("/register", rateLimit({ max: 5 }), async (req, res) => {
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
      const { account, user, company } = await provisionUserWithCompany(client, {
        email,
        full_name,
        company_name,
        password_hash,
        is_email_verified: false,
        action: "register",
        ip_address: req.ip,
      });

      await client.query("COMMIT");

      // Register company with the interaction service after the DB transaction commits.
      // Non-fatal - if the service is down the company gets back-filled on first popup use.
      registerCompanyWithInteractionService(pool, company.id, company.name).catch(() => {});

      // Issue an email-verification token + send the email (non-blocking: login still
      // works; the app surfaces an "unverified" state rather than locking the user out).
      // The send RESULT is reported back to the client so the UI can warn when delivery
      // fails (e.g. an unverified Resend sender domain) instead of failing silently.
      let email_verification = { sent: false, simulated: false, error: null };
      try {
        const vtoken = crypto.randomBytes(32).toString("hex");
        await pool.query(
          `UPDATE app.users SET email_verify_token = $1, email_verify_expires = NOW() + INTERVAL '24 hours' WHERE id = $2`,
          [vtoken, user.id]
        );
        const r = await sendVerificationEmail(user.email, vtoken);
        email_verification = { sent: !r?.simulated, simulated: !!r?.simulated, error: null };
        if (r?.simulated) console.warn("[auth] verification email simulated (RESEND_API_KEY unset) for", user.email);
      } catch (e) {
        console.error("[auth] verification email FAILED for", user.email, "-", e.message);
        email_verification = { sent: false, simulated: false, error: e.message };
      }

      const token = createToken({ id: user.id, email: user.email });
      setAuthCookie(res, token);

      res.status(201).json({
        user: {
          ...user,
          account_id: account.id,
          account: { id: account.id, plan: account.plan },
          companies: [{ ...company, role: "admin" }],
        },
        token,
        email_verification,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // ── Code-based sign-up: verify the email BEFORE the account is created ───────
  // Flow: /register/start (park pending + email a code) → /register/verify
  // (check code → provision account + log in). /register/resend re-sends a code.

  // POST /api/auth/register/start - validate, store pending signup, email a code
  router.post("/register/start", rateLimit({ max: 5 }), async (req, res) => {
    const { email, password, full_name, company_name } = req.body;
    if (!email || !password || !full_name || !company_name) {
      return res.status(400).json({ error: "email, password, full_name, company_name are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    try {
      // Reject if a real account already exists (the pending table is separate).
      const { rows: existing } = await pool.query(
        "SELECT id FROM app.users WHERE LOWER(email) = LOWER($1)",
        [email]
      );
      if (existing.length) {
        return res.status(409).json({ error: "Email is already registered", code: "email_taken" });
      }

      const password_hash = await bcrypt.hash(password, 12);
      const code = genCode();
      // Upsert the pending row (one per email); replacing any prior attempt.
      await pool.query(
        `INSERT INTO app.email_verifications
           (email, password_hash, full_name, company_name, code_hash, attempts, expires_at, created_at)
         VALUES (LOWER($1), $2, $3, $4, $5, 0, NOW() + INTERVAL '15 minutes', NOW())
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           full_name     = EXCLUDED.full_name,
           company_name  = EXCLUDED.company_name,
           code_hash     = EXCLUDED.code_hash,
           attempts      = 0,
           expires_at    = EXCLUDED.expires_at,
           created_at    = NOW()`,
        [email, password_hash, full_name, company_name, sha256(code)]
      );

      // Send the code. Report delivery status so the UI can warn / offer resend.
      let sent = false, error = null, simulated = false;
      try {
        const r = await sendVerificationCodeEmail(email.toLowerCase(), code);
        sent = !r?.simulated; simulated = !!r?.simulated;
        if (simulated) console.warn(`[auth] sign-up code for ${email} simulated (RESEND_API_KEY unset): ${code}`);
      } catch (e) {
        console.error("[auth] sign-up code email FAILED for", email, "-", e.message);
        error = e.message;
      }
      res.status(200).json({ ok: true, email: email.toLowerCase(), sent, simulated, error });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/register/verify - confirm the code, THEN create the account
  router.post("/register/verify", rateLimit({ max: 10 }), async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "email and code are required" });
    const lower = String(email).toLowerCase();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM app.email_verifications WHERE email = $1 FOR UPDATE",
        [lower]
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "No pending verification for this email. Please sign up again.", code: "no_pending" });
      }
      const pending = rows[0];

      if (new Date(pending.expires_at) < new Date()) {
        await client.query("DELETE FROM app.email_verifications WHERE email = $1", [lower]);
        await client.query("COMMIT");
        return res.status(400).json({ error: "Your code has expired. Please sign up again.", code: "expired" });
      }
      if (pending.attempts >= 5) {
        await client.query("DELETE FROM app.email_verifications WHERE email = $1", [lower]);
        await client.query("COMMIT");
        return res.status(429).json({ error: "Too many incorrect attempts. Please sign up again.", code: "too_many_attempts" });
      }
      if (sha256(code) !== pending.code_hash) {
        await client.query("UPDATE app.email_verifications SET attempts = attempts + 1 WHERE email = $1", [lower]);
        await client.query("COMMIT");
        const left = 5 - (pending.attempts + 1);
        return res.status(400).json({ error: `Incorrect code.${left > 0 ? ` ${left} attempt${left === 1 ? "" : "s"} left.` : ""}`, code: "invalid_code" });
      }

      // Code is correct. Guard against a race where the email got taken meanwhile.
      const { rows: taken } = await client.query(
        "SELECT id FROM app.users WHERE LOWER(email) = LOWER($1)",
        [lower]
      );
      if (taken.length) {
        await client.query("DELETE FROM app.email_verifications WHERE email = $1", [lower]);
        await client.query("COMMIT");
        return res.status(409).json({ error: "Email is already registered", code: "email_taken" });
      }

      const { account, user, company } = await provisionUserWithCompany(client, {
        email: lower,
        full_name: pending.full_name,
        company_name: pending.company_name,
        password_hash: pending.password_hash,
        is_email_verified: true, // verified by the code before we ever got here
        action: "register",
        ip_address: req.ip,
      });
      await client.query("DELETE FROM app.email_verifications WHERE email = $1", [lower]);
      await client.query("COMMIT");

      // Non-fatal external registration (back-filled on first popup use if down).
      registerCompanyWithInteractionService(pool, company.id, company.name).catch(() => {});

      const token = createToken({ id: user.id, email: user.email });
      setAuthCookie(res, token);
      res.status(201).json({
        user: {
          ...user,
          account_id: account.id,
          account: { id: account.id, plan: account.plan },
          companies: [{ ...company, role: "admin" }],
        },
        token,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // POST /api/auth/register/resend - regenerate + re-send the code for a pending signup
  router.post("/register/resend", rateLimit({ max: 5 }), async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });
    const lower = String(email).toLowerCase();
    try {
      const { rows } = await pool.query(
        "SELECT email FROM app.email_verifications WHERE email = $1",
        [lower]
      );
      if (!rows.length) {
        return res.status(400).json({ error: "No pending verification for this email. Please sign up again.", code: "no_pending" });
      }
      const code = genCode();
      await pool.query(
        `UPDATE app.email_verifications
           SET code_hash = $1, attempts = 0, expires_at = NOW() + INTERVAL '15 minutes', created_at = NOW()
         WHERE email = $2`,
        [sha256(code), lower]
      );
      let sent = false, error = null;
      try {
        const r = await sendVerificationCodeEmail(lower, code);
        sent = !r?.simulated;
        if (r?.simulated) console.warn(`[auth] resend sign-up code for ${lower} simulated (RESEND_API_KEY unset): ${code}`);
      } catch (e) {
        console.error("[auth] resend sign-up code FAILED for", lower, "-", e.message);
        error = e.message;
      }
      res.json({ ok: true, sent, error });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/login
  router.post("/login", rateLimit({ max: 10 }), async (req, res) => {
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
        // Distinct from a wrong password so the UI can route the user to sign-up
        // with their email pre-filled. (Note: this intentionally allows email
        // enumeration on the login form, traded for the better onboarding UX.)
        return res.status(404).json({ error: "No account is associated with this email", code: "no_account" });
      }

      const user = rows[0];
      if (!user.password_hash) {
        return res.status(401).json({ error: "No password set - use your login provider" });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Two-factor: when the user has email MFA enabled, the password is only the
      // FIRST factor. Don't issue a session yet - park a challenge, email a code,
      // and make the client complete POST /login/mfa. The challenge id is an
      // unguessable UUID and is the only thing tying the two requests together.
      if (user.mfa_enabled) {
        const code = genCode();
        const { rows: [challenge] } = await pool.query(
          `INSERT INTO app.mfa_challenges (user_id, purpose, code_hash, expires_at)
           VALUES ($1, 'login', $2, NOW() + INTERVAL '10 minutes')
           RETURNING id`,
          [user.id, sha256(code)]
        );
        let sent = false, error = null;
        try {
          const r = await sendLoginCodeEmail(user.email, code);
          sent = !r?.simulated;
          if (r?.simulated) console.warn(`[auth] login MFA code for ${user.email} simulated (RESEND_API_KEY unset): ${code}`);
        } catch (e) {
          console.error("[auth] login MFA code email FAILED for", user.email, "-", e.message);
          error = e.message;
        }
        return res.json({ mfa_required: true, challenge_id: challenge.id, sent, error });
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

  // POST /api/auth/login/mfa - complete a two-factor sign-in (second factor)
  // Body: { challenge_id, code }. On success issues the session cookie + returns
  // the same user payload as a non-MFA login.
  router.post("/login/mfa", rateLimit({ max: 10 }), async (req, res) => {
    const { challenge_id, code } = req.body;
    if (!challenge_id || !code) {
      return res.status(400).json({ error: "challenge_id and code are required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT * FROM app.mfa_challenges
          WHERE id = $1 AND purpose = 'login' AND consumed_at IS NULL FOR UPDATE`,
        [challenge_id]
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "This sign-in request is no longer valid. Please sign in again.", code: "invalid_challenge" });
      }
      const ch = rows[0];

      if (new Date(ch.expires_at) < new Date()) {
        await client.query("DELETE FROM app.mfa_challenges WHERE id = $1", [challenge_id]);
        await client.query("COMMIT");
        return res.status(400).json({ error: "Your code has expired. Please sign in again.", code: "expired" });
      }
      if (ch.attempts >= 5) {
        await client.query("DELETE FROM app.mfa_challenges WHERE id = $1", [challenge_id]);
        await client.query("COMMIT");
        return res.status(429).json({ error: "Too many incorrect attempts. Please sign in again.", code: "too_many_attempts" });
      }
      if (sha256(code) !== ch.code_hash) {
        await client.query("UPDATE app.mfa_challenges SET attempts = attempts + 1 WHERE id = $1", [challenge_id]);
        await client.query("COMMIT");
        const left = 5 - (ch.attempts + 1);
        return res.status(400).json({ error: `Incorrect code.${left > 0 ? ` ${left} attempt${left === 1 ? "" : "s"} left.` : ""}`, code: "invalid_code" });
      }

      // Correct - consume the challenge and complete sign-in.
      await client.query("UPDATE app.mfa_challenges SET consumed_at = NOW() WHERE id = $1", [challenge_id]);
      await client.query("UPDATE app.users SET last_login_at = NOW() WHERE id = $1", [ch.user_id]);
      await client.query(
        `INSERT INTO app.audit_log (user_id, action, resource_type, resource_id, ip_address, user_agent)
         VALUES ($1, 'login_mfa', 'user', $2, $3, $4)`,
        [ch.user_id, ch.user_id, req.ip, req.headers["user-agent"]]
      );
      await client.query("COMMIT");

      const user = await fetchUserWithCompanies(pool, ch.user_id);
      if (!user) return res.status(404).json({ error: "User not found" });
      const token = createToken({ id: user.id, email: user.email });
      setAuthCookie(res, token);
      const { password_hash, email_verify_token, ...safeUser } = user;
      res.json({ user: safeUser, token });
    } catch (err) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // POST /api/auth/login/mfa/resend - re-send the sign-in code for a pending
  // challenge (regenerates the code and resets the attempt counter).
  router.post("/login/mfa/resend", rateLimit({ max: 5 }), async (req, res) => {
    const { challenge_id } = req.body;
    if (!challenge_id) return res.status(400).json({ error: "challenge_id is required" });
    try {
      const { rows } = await pool.query(
        `SELECT c.id, u.email FROM app.mfa_challenges c
           JOIN app.users u ON u.id = c.user_id
          WHERE c.id = $1 AND c.purpose = 'login' AND c.consumed_at IS NULL`,
        [challenge_id]
      );
      if (!rows.length) {
        return res.status(400).json({ error: "This sign-in request is no longer valid. Please sign in again.", code: "invalid_challenge" });
      }
      const code = genCode();
      await pool.query(
        `UPDATE app.mfa_challenges
            SET code_hash = $1, attempts = 0, expires_at = NOW() + INTERVAL '10 minutes'
          WHERE id = $2`,
        [sha256(code), challenge_id]
      );
      let sent = false, error = null;
      try {
        const r = await sendLoginCodeEmail(rows[0].email, code);
        sent = !r?.simulated;
        if (r?.simulated) console.warn(`[auth] resend login MFA code for ${rows[0].email} simulated: ${code}`);
      } catch (e) {
        console.error("[auth] resend login MFA code FAILED for", rows[0].email, "-", e.message);
        error = e.message;
      }
      res.json({ ok: true, sent, error });
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
                u.account_id, u.is_platform_admin, u.mfa_enabled,
                (u.password_hash IS NOT NULL) AS has_password,
                a.plan AS account_plan, a.plan_expires_at AS account_plan_expires_at,
                a.plan_upgraded_at AS account_plan_upgraded_at,
                (a.owner_user_id = u.id) AS is_account_owner,
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
         JOIN app.accounts a ON a.id = u.account_id
         LEFT JOIN app.company_members cm ON cm.user_id = u.id AND cm.status = 'active'
         LEFT JOIN app.companies c ON c.id = cm.company_id AND c.is_active = true
         WHERE u.id = $1 AND u.is_active = true
         GROUP BY u.id, a.id`,
        [req.user.id]
      );
      if (!rows.length) return res.status(401).json({ error: "User not found" });
      // Surface impersonation context (set when a platform owner is acting as this
      // user) so the UI can show an "exit impersonation" banner.
      res.json({ ...rows[0], impersonated_by: req.user.impersonated_by || null });
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
      // OAuth-only accounts have no password to change - sign-in is handled by
      // their identity provider (Google/Microsoft).
      if (!rows[0].password_hash) {
        return res.status(400).json({ error: "This account signs in with Google or Microsoft and has no password.", code: "no_password" });
      }

      const valid = await bcrypt.compare(current_password, rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

      const hash = await bcrypt.hash(new_password, 12);
      // Stamp password_changed_at so all OTHER existing sessions are invalidated
      // (authenticate rejects tokens issued before this time).
      await pool.query(
        "UPDATE app.users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2",
        [hash, req.user.id]
      );

      await pool.query(
        `INSERT INTO app.audit_log (user_id, action, resource_type, resource_id)
         VALUES ($1, 'password_changed', 'user', $2)`,
        [req.user.id, req.user.id]
      );

      // Re-issue THIS session's token so the user who just changed their password
      // isn't logged out (the new token's iat is after password_changed_at).
      setAuthCookie(res, createToken({ id: req.user.id, email: req.user.email }));

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Two-factor (email OTP) management ────────────────────────────────────────
  // Opt-in: a user turns 2FA on from Settings → Security. Turning it on requires
  // confirming a code emailed to them (proves they can receive codes); turning it
  // off requires the current password (when one is set).

  // POST /api/auth/mfa/setup - email a confirmation code to start enabling 2FA
  router.post("/mfa/setup", authenticate, rateLimit({ max: 5 }), async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT email, mfa_enabled FROM app.users WHERE id = $1",
        [req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "User not found" });
      if (rows[0].mfa_enabled) return res.status(400).json({ error: "Two-factor is already enabled", code: "already_enabled" });

      // One pending 'enable' challenge per user: clear any prior attempt first.
      await pool.query("DELETE FROM app.mfa_challenges WHERE user_id = $1 AND purpose = 'enable'", [req.user.id]);
      const code = genCode();
      await pool.query(
        `INSERT INTO app.mfa_challenges (user_id, purpose, code_hash, expires_at)
         VALUES ($1, 'enable', $2, NOW() + INTERVAL '10 minutes')`,
        [req.user.id, sha256(code)]
      );
      let sent = false, error = null;
      try {
        const r = await sendLoginCodeEmail(rows[0].email, code, { purpose: "enable" });
        sent = !r?.simulated;
        if (r?.simulated) console.warn(`[auth] MFA enable code for ${rows[0].email} simulated: ${code}`);
      } catch (e) {
        console.error("[auth] MFA enable code email FAILED for", rows[0].email, "-", e.message);
        error = e.message;
      }
      res.json({ ok: true, sent, error });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/mfa/enable - confirm the code and turn 2FA on
  router.post("/mfa/enable", authenticate, rateLimit({ max: 10 }), async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "code is required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT * FROM app.mfa_challenges
          WHERE user_id = $1 AND purpose = 'enable' AND consumed_at IS NULL FOR UPDATE`,
        [req.user.id]
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "No pending setup. Start again from Settings.", code: "no_pending" });
      }
      const ch = rows[0];
      if (new Date(ch.expires_at) < new Date()) {
        await client.query("DELETE FROM app.mfa_challenges WHERE id = $1", [ch.id]);
        await client.query("COMMIT");
        return res.status(400).json({ error: "Your code has expired. Start again.", code: "expired" });
      }
      if (ch.attempts >= 5) {
        await client.query("DELETE FROM app.mfa_challenges WHERE id = $1", [ch.id]);
        await client.query("COMMIT");
        return res.status(429).json({ error: "Too many incorrect attempts. Start again.", code: "too_many_attempts" });
      }
      if (sha256(code) !== ch.code_hash) {
        await client.query("UPDATE app.mfa_challenges SET attempts = attempts + 1 WHERE id = $1", [ch.id]);
        await client.query("COMMIT");
        const left = 5 - (ch.attempts + 1);
        return res.status(400).json({ error: `Incorrect code.${left > 0 ? ` ${left} attempt${left === 1 ? "" : "s"} left.` : ""}`, code: "invalid_code" });
      }

      await client.query("UPDATE app.users SET mfa_enabled = true WHERE id = $1", [req.user.id]);
      await client.query("DELETE FROM app.mfa_challenges WHERE user_id = $1 AND purpose = 'enable'", [req.user.id]);
      await client.query(
        `INSERT INTO app.audit_log (user_id, action, resource_type, resource_id, ip_address)
         VALUES ($1, 'mfa_enabled', 'user', $2, $3)`,
        [req.user.id, req.user.id, req.ip]
      );
      await client.query("COMMIT");
      res.json({ ok: true, mfa_enabled: true });
    } catch (err) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // POST /api/auth/mfa/disable - turn 2FA off (requires current password if set)
  router.post("/mfa/disable", authenticate, rateLimit({ max: 10 }), async (req, res) => {
    const { password } = req.body;
    try {
      const { rows } = await pool.query(
        "SELECT password_hash, mfa_enabled FROM app.users WHERE id = $1",
        [req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "User not found" });
      if (!rows[0].mfa_enabled) return res.json({ ok: true, mfa_enabled: false });

      // When the account has a password, require it to disable 2FA. OAuth-only
      // accounts (no password) can disable while authenticated.
      if (rows[0].password_hash) {
        if (!password) return res.status(400).json({ error: "Current password is required", code: "password_required" });
        const valid = await bcrypt.compare(password, rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
      }

      await pool.query("UPDATE app.users SET mfa_enabled = false WHERE id = $1", [req.user.id]);
      await pool.query("DELETE FROM app.mfa_challenges WHERE user_id = $1", [req.user.id]);
      await pool.query(
        `INSERT INTO app.audit_log (user_id, action, resource_type, resource_id, ip_address)
         VALUES ($1, 'mfa_disabled', 'user', $2, $3)`,
        [req.user.id, req.user.id, req.ip]
      );
      res.json({ ok: true, mfa_enabled: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/auth/preferences - user-level preferences
  router.get("/preferences", authenticate, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT metadata FROM app.users WHERE id = $1",
        [req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "User not found" });
      res.json(rows[0].metadata?.preferences || {});
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/auth/preferences - save user-level preferences
  router.patch("/preferences", authenticate, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE app.users
         SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{preferences}', $1::jsonb)
         WHERE id = $2
         RETURNING metadata`,
        [JSON.stringify(req.body), req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "User not found" });
      res.json(rows[0].metadata?.preferences || {});
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/forgot-password
  router.post("/forgot-password", rateLimit({ max: 5 }), async (req, res) => {
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

        // Send the reset link (simulated/logged if RESEND_API_KEY is unset).
        await sendPasswordResetEmail(email, token).catch((e) =>
          console.warn("[auth] reset email failed:", e.message)
        );
        if (process.env.NODE_ENV !== "production") {
          return res.json({ ok: true, debug_reset_token: token });
        }
      }

      res.json({ ok: true, message: "If that email exists, a reset link has been sent." });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/verify-email - confirm an email-verification token
  router.post("/verify-email", async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "token is required" });
    try {
      const { rows } = await pool.query(
        `UPDATE app.users
            SET is_email_verified = true, email_verify_token = NULL, email_verify_expires = NULL
          WHERE email_verify_token = $1 AND email_verify_expires > NOW()
          RETURNING id`,
        [token]
      );
      if (!rows.length) return res.status(400).json({ error: "Invalid or expired verification link" });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/resend-verification - regenerate + resend (authenticated)
  router.post("/resend-verification", authenticate, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT email, is_email_verified FROM app.users WHERE id = $1",
        [req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "User not found" });
      if (rows[0].is_email_verified) return res.json({ ok: true, already_verified: true });
      const vtoken = crypto.randomBytes(32).toString("hex");
      await pool.query(
        `UPDATE app.users SET email_verify_token = $1, email_verify_expires = NOW() + INTERVAL '24 hours' WHERE id = $2`,
        [vtoken, req.user.id]
      );
      let sent = false, error = null;
      try {
        const r = await sendVerificationEmail(rows[0].email, vtoken);
        sent = !r?.simulated;
      } catch (e) {
        console.error("[auth] resend verification FAILED for", rows[0].email, "-", e.message);
        error = e.message;
      }
      res.json({ ok: true, sent, error });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/reset-password
  router.post("/reset-password", rateLimit({ max: 10 }), async (req, res) => {
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
      // password_changed_at invalidates all existing sessions for this user.
      await pool.query(
        "UPDATE app.users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2",
        [hash, rows[0].user_id]
      );
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
  // Accept BOTH our native env names and the NextAuth-style names (AUTH_GOOGLE_ID /
  // AUTH_AZURE_AD_*) so a single .env works regardless of which convention is used.

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET;

  // The post-login app URL and the OAuth callback URL are derived at REQUEST time
  // so the same build works on localhost and on the production domain (meritma.com)
  // with no per-env redirect-uri config. Explicit *_REDIRECT_URI / FRONTEND_URL
  // env vars still override when set.
  const frontendUrl = () =>
    (process.env.FRONTEND_URL || process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:5173")
      .replace(/\/$/, "");
  const callbackUrl = (req, provider) => {
    const explicit = process.env[`${provider.toUpperCase()}_REDIRECT_URI`];
    if (explicit) return explicit;
    const base = (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || `${req.protocol}://${req.get("host")}`)
      .replace(/\/$/, "");
    return `${base}/api/auth/${provider}/callback`;
  };

  // GET /api/auth/google - redirect to consent screen
  router.get("/google", (req, res) => {
    if (!GOOGLE_CLIENT_ID) {
      return res.redirect(`${frontendUrl()}/login?error=google_not_configured`);
    }
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie("oauth_state", state, {
      httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000,
      secure: process.env.NODE_ENV === "production",
    });
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: callbackUrl(req, "google"),
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
      state,
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  // GET /api/auth/google/callback - exchange code, upsert user, set cookie
  router.get("/google/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    if (oauthError || !code) {
      return res.redirect(`${frontendUrl()}/login?error=google_cancelled`);
    }
    // CSRF: the state must match the cookie set when the flow started.
    if (!state || state !== req.cookies?.oauth_state) {
      return res.redirect(`${frontendUrl()}/login?error=oauth_state`);
    }
    res.clearCookie("oauth_state");

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: callbackUrl(req, "google"),
          grant_type: "authorization_code",
        }),
      });
      const tokens = await tokenRes.json();
      if (tokens.error) {
        return res.redirect(`${frontendUrl()}/login?error=oauth_failed`);
      }

      const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const gUser = await profileRes.json();
      if (!gUser.email) {
        return res.redirect(`${frontendUrl()}/login?error=google_no_email`);
      }

      const userId = await loginOrProvisionOAuthUser(pool, {
        email: gUser.email,
        full_name: gUser.name || gUser.email,
        avatar_url: gUser.picture || null,
        provider: "google",
        ip: req.ip,
      });

      const jwtToken = createToken({ id: userId, email: gUser.email });
      setAuthCookie(res, jwtToken);
      res.redirect(`${frontendUrl()}/`);
    } catch (err) {
      console.error("Google OAuth error:", err.message);
      res.redirect(`${frontendUrl()}/login?error=server_error`);
    }
  });

  // GET /api/auth/google/status - check if Google OAuth is configured (for UI)
  router.get("/google/status", (_req, res) => {
    res.json({ configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
  });

  // ── Microsoft OAuth 2.0 ──────────────────────────────────────────────────────

  const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || process.env.AUTH_AZURE_AD_CLIENT_ID;
  const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || process.env.AUTH_AZURE_AD_CLIENT_SECRET;
  // A specific tenant id locks sign-in to that org. "common" allows both
  // work/school (Azure AD) and personal Microsoft accounts.
  const MICROSOFT_TENANT = process.env.MICROSOFT_TENANT || process.env.AUTH_AZURE_AD_TENANT_ID || "common";
  const MS_AUTHORITY = `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0`;

  // GET /api/auth/microsoft - redirect to consent screen
  router.get("/microsoft", (req, res) => {
    if (!MICROSOFT_CLIENT_ID) {
      return res.redirect(`${frontendUrl()}/login?error=microsoft_not_configured`);
    }
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie("oauth_state", state, {
      httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000,
      secure: process.env.NODE_ENV === "production",
    });
    const params = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      redirect_uri: callbackUrl(req, "microsoft"),
      response_type: "code",
      response_mode: "query",
      scope: "openid email profile User.Read",
      prompt: "select_account",
      state,
    });
    res.redirect(`${MS_AUTHORITY}/authorize?${params}`);
  });

  // GET /api/auth/microsoft/callback - exchange code, upsert user, set cookie
  router.get("/microsoft/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    if (oauthError || !code) {
      return res.redirect(`${frontendUrl()}/login?error=microsoft_cancelled`);
    }
    if (!state || state !== req.cookies?.oauth_state) {
      return res.redirect(`${frontendUrl()}/login?error=oauth_state`);
    }
    res.clearCookie("oauth_state");

    try {
      const tokenRes = await fetch(`${MS_AUTHORITY}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: MICROSOFT_CLIENT_ID,
          client_secret: MICROSOFT_CLIENT_SECRET,
          redirect_uri: callbackUrl(req, "microsoft"),
          grant_type: "authorization_code",
          scope: "openid email profile User.Read",
        }),
      });
      const tokens = await tokenRes.json();
      if (tokens.error) {
        return res.redirect(`${frontendUrl()}/login?error=oauth_failed`);
      }

      const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const msUser = await profileRes.json();
      const email = msUser.mail || msUser.userPrincipalName;
      if (!email) {
        return res.redirect(`${frontendUrl()}/login?error=microsoft_no_email`);
      }

      const userId = await loginOrProvisionOAuthUser(pool, {
        email,
        full_name: msUser.displayName || email,
        provider: "microsoft",
        ip: req.ip,
      });

      const jwtToken = createToken({ id: userId, email });
      setAuthCookie(res, jwtToken);
      res.redirect(`${frontendUrl()}/`);
    } catch (err) {
      console.error("Microsoft OAuth error:", err.message);
      res.redirect(`${frontendUrl()}/login?error=server_error`);
    }
  });

  // GET /api/auth/microsoft/status - check if Microsoft OAuth is configured (for UI)
  router.get("/microsoft/status", (_req, res) => {
    res.json({ configured: !!(MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET) });
  });

  return router;
}
