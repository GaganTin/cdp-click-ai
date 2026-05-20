import { Router } from "express";
import crypto from "crypto";
import { authenticate } from "../middleware/auth.js";

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function uniqueSlug(pool, base, excludeId = null) {
  const slug = slugify(base) || "company";
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i}`;
    const { rows } = await pool.query(
      "SELECT id FROM app.companies WHERE LOWER(slug) = LOWER($1) AND ($2::uuid IS NULL OR id != $2::uuid)",
      [candidate, excludeId]
    );
    if (!rows.length) return candidate;
  }
}

async function getMembership(pool, companyId, userId) {
  const { rows } = await pool.query(
    "SELECT role, status FROM app.company_members WHERE company_id = $1 AND user_id = $2",
    [companyId, userId]
  );
  return rows[0] || null;
}

function isAdmin(member) {
  return member && ["owner", "admin"].includes(member.role) && member.status === "active";
}

function isActive(member) {
  return member && member.status === "active";
}

export function createCompanyRouter(pool) {
  const router = Router();

  // POST /api/companies - create a new company
  router.post("/", authenticate, async (req, res) => {
    const { name, website, industry, company_size } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    try {
      const slug = await uniqueSlug(pool, name);
      const { rows: [company] } = await pool.query(
        `INSERT INTO app.companies (name, slug, website, industry, company_size)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name, slug, website || null, industry || null, company_size || null]
      );

      await pool.query(
        `INSERT INTO app.company_members (company_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')`,
        [company.id, req.user.id]
      );

      await pool.query(
        `INSERT INTO app.user_preferences (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.user.id, company.id]
      );

      await pool.query(
        `INSERT INTO app.audit_log (company_id, user_id, action, resource_type, resource_id)
         VALUES ($1, $2, 'create', 'company', $1)`,
        [company.id, req.user.id]
      );

      res.status(201).json(company);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/companies/:id - get company profile
  router.get("/:id", authenticate, async (req, res) => {
    const { id } = req.params;
    const member = await getMembership(pool, id, req.user.id);
    if (!isActive(member)) return res.status(403).json({ error: "Access denied" });

    try {
      const { rows: [company] } = await pool.query(
        `SELECT c.*,
           (SELECT COUNT(*)::int FROM app.company_members WHERE company_id = c.id AND status = 'active') AS member_count
         FROM app.companies c WHERE c.id = $1`,
        [id]
      );
      if (!company) return res.status(404).json({ error: "Company not found" });
      res.json({ ...company, current_user_role: member.role });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/companies/:id - update company profile
  router.patch("/:id", authenticate, async (req, res) => {
    const { id } = req.params;
    const member = await getMembership(pool, id, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: "Admin access required" });

    const { name, logo_url, website, industry, company_size, settings } = req.body;
    const sets = [];
    const vals = [];

    if (name !== undefined) { sets.push(`name = $${sets.length + 1}`); vals.push(name); }
    if (logo_url !== undefined) { sets.push(`logo_url = $${sets.length + 1}`); vals.push(logo_url); }
    if (website !== undefined) { sets.push(`website = $${sets.length + 1}`); vals.push(website); }
    if (industry !== undefined) { sets.push(`industry = $${sets.length + 1}`); vals.push(industry); }
    if (company_size !== undefined) { sets.push(`company_size = $${sets.length + 1}`); vals.push(company_size); }
    if (settings !== undefined) {
      sets.push(`settings = settings || $${sets.length + 1}::jsonb`);
      vals.push(JSON.stringify(settings));
    }

    if (!sets.length) return res.status(400).json({ error: "No fields to update" });

    if (name) {
      const slug = await uniqueSlug(pool, name, id);
      sets.push(`slug = $${sets.length + 1}`);
      vals.push(slug);
    }

    try {
      vals.push(id);
      const { rows: [company] } = await pool.query(
        `UPDATE app.companies SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      res.json(company);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/companies/:id/members
  router.get("/:id/members", authenticate, async (req, res) => {
    const { id } = req.params;
    const member = await getMembership(pool, id, req.user.id);
    if (!isActive(member)) return res.status(403).json({ error: "Access denied" });

    try {
      const { rows } = await pool.query(
        `SELECT cm.id, cm.role, cm.status, cm.joined_at,
                u.id AS user_id, u.email, u.full_name, u.avatar_url, u.last_login_at
         FROM app.company_members cm
         JOIN app.users u ON u.id = cm.user_id
         WHERE cm.company_id = $1
         ORDER BY
           CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
           cm.joined_at`,
        [id]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/companies/:id/members/:memberId
  router.patch("/:id/members/:memberId", authenticate, async (req, res) => {
    const { id, memberId } = req.params;
    const myMember = await getMembership(pool, id, req.user.id);
    if (!isAdmin(myMember)) return res.status(403).json({ error: "Admin access required" });

    const { role, status } = req.body;
    const sets = [];
    const vals = [];

    if (role !== undefined) {
      if (!["admin", "editor", "viewer"].includes(role)) {
        return res.status(400).json({ error: "role must be admin, editor, or viewer" });
      }
      sets.push(`role = $${sets.length + 1}`);
      vals.push(role);
    }
    if (status !== undefined) {
      if (!["active", "suspended"].includes(status)) {
        return res.status(400).json({ error: "status must be active or suspended" });
      }
      sets.push(`status = $${sets.length + 1}`);
      vals.push(status);
    }
    if (!sets.length) return res.status(400).json({ error: "No fields to update" });

    try {
      const { rows: [target] } = await pool.query(
        "SELECT role FROM app.company_members WHERE id = $1 AND company_id = $2",
        [memberId, id]
      );
      if (!target) return res.status(404).json({ error: "Member not found" });
      if (target.role === "owner") return res.status(400).json({ error: "Cannot change owner role" });

      vals.push(memberId, id);
      const { rows: [updated] } = await pool.query(
        `UPDATE app.company_members SET ${sets.join(", ")}
         WHERE id = $${vals.length - 1} AND company_id = $${vals.length} RETURNING *`,
        vals
      );
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/companies/:id/members/:memberId
  router.delete("/:id/members/:memberId", authenticate, async (req, res) => {
    const { id, memberId } = req.params;
    const myMember = await getMembership(pool, id, req.user.id);
    if (!isAdmin(myMember)) return res.status(403).json({ error: "Admin access required" });

    try {
      const { rows: [target] } = await pool.query(
        "SELECT role, user_id FROM app.company_members WHERE id = $1 AND company_id = $2",
        [memberId, id]
      );
      if (!target) return res.status(404).json({ error: "Member not found" });
      if (target.role === "owner") return res.status(400).json({ error: "Cannot remove the company owner" });

      await pool.query("DELETE FROM app.company_members WHERE id = $1", [memberId]);

      await pool.query(
        `INSERT INTO app.audit_log (company_id, user_id, action, resource_type, resource_id, changes)
         VALUES ($1, $2, 'remove_member', 'user', $3, $4)`,
        [id, req.user.id, target.user_id, JSON.stringify({ member_id: memberId })]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/companies/:id/invitations
  router.get("/:id/invitations", authenticate, async (req, res) => {
    const { id } = req.params;
    const myMember = await getMembership(pool, id, req.user.id);
    if (!isAdmin(myMember)) return res.status(403).json({ error: "Admin access required" });

    try {
      const { rows } = await pool.query(
        `SELECT ci.id, ci.email, ci.role, ci.status, ci.expires_at, ci.created_date, ci.token,
                u.full_name AS invited_by_name, u.email AS invited_by_email
         FROM app.company_invitations ci
         JOIN app.users u ON u.id = ci.invited_by
         WHERE ci.company_id = $1 AND ci.status = 'pending'
         ORDER BY ci.created_date DESC`,
        [id]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/companies/:id/invitations - invite a user
  router.post("/:id/invitations", authenticate, async (req, res) => {
    const { id } = req.params;
    const myMember = await getMembership(pool, id, req.user.id);
    if (!isAdmin(myMember)) return res.status(403).json({ error: "Admin access required" });

    const { email, role = "viewer" } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });
    if (!["admin", "editor", "viewer"].includes(role)) {
      return res.status(400).json({ error: "role must be admin, editor, or viewer" });
    }

    try {
      // Already a member?
      const { rows: existingMember } = await pool.query(
        `SELECT cm.id FROM app.company_members cm
         JOIN app.users u ON u.id = cm.user_id
         WHERE cm.company_id = $1 AND LOWER(u.email) = LOWER($2) AND cm.status = 'active'`,
        [id, email]
      );
      if (existingMember.length) {
        return res.status(409).json({ error: "This user is already a member" });
      }

      // Cancel any existing pending invite
      await pool.query(
        `UPDATE app.company_invitations SET status = 'cancelled'
         WHERE company_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'`,
        [id, email]
      );

      const { rows: [inv] } = await pool.query(
        `INSERT INTO app.company_invitations (company_id, invited_by, email, role)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [id, req.user.id, email.toLowerCase(), role]
      );

      await pool.query(
        `INSERT INTO app.audit_log (company_id, user_id, action, resource_type, resource_id, changes)
         VALUES ($1, $2, 'invite_member', 'invitation', $3, $4)`,
        [id, req.user.id, inv.id, JSON.stringify({ email, role })]
      );

      res.status(201).json(inv);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/companies/:id/invitations/:invId - cancel
  router.delete("/:id/invitations/:invId", authenticate, async (req, res) => {
    const { id, invId } = req.params;
    const myMember = await getMembership(pool, id, req.user.id);
    if (!isAdmin(myMember)) return res.status(403).json({ error: "Admin access required" });

    try {
      await pool.query(
        `UPDATE app.company_invitations SET status = 'cancelled'
         WHERE id = $1 AND company_id = $2`,
        [invId, id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/companies/join/:token - accept invitation
  router.post("/join/:token", authenticate, async (req, res) => {
    const { token } = req.params;

    try {
      const { rows } = await pool.query(
        `SELECT ci.*, c.name AS company_name
         FROM app.company_invitations ci
         JOIN app.companies c ON c.id = ci.company_id
         WHERE ci.token = $1 AND ci.status = 'pending' AND ci.expires_at > NOW()`,
        [token]
      );
      if (!rows.length) {
        return res.status(400).json({ error: "Invalid or expired invitation" });
      }

      const inv = rows[0];
      const { rows: [userRow] } = await pool.query(
        "SELECT email FROM app.users WHERE id = $1",
        [req.user.id]
      );

      if (userRow.email.toLowerCase() !== inv.email.toLowerCase()) {
        return res.status(403).json({
          error: "This invitation was sent to a different email address",
        });
      }

      await pool.query(
        `INSERT INTO app.company_members (company_id, user_id, role, invited_by, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (company_id, user_id)
         DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
        [inv.company_id, req.user.id, inv.role, inv.invited_by]
      );

      await pool.query(
        `UPDATE app.company_invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
        [inv.id]
      );

      await pool.query(
        `INSERT INTO app.user_preferences (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.user.id, inv.company_id]
      );

      res.json({ ok: true, company_id: inv.company_id, company_name: inv.company_name });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET/PATCH /api/companies/:id/preferences - user prefs for this company
  router.get("/:id/preferences", authenticate, async (req, res) => {
    const { id } = req.params;
    const member = await getMembership(pool, id, req.user.id);
    if (!isActive(member)) return res.status(403).json({ error: "Access denied" });

    try {
      const { rows } = await pool.query(
        "SELECT * FROM app.user_preferences WHERE user_id = $1 AND company_id = $2",
        [req.user.id, id]
      );
      res.json(rows[0] || { user_id: req.user.id, company_id: id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch("/:id/preferences", authenticate, async (req, res) => {
    const { id } = req.params;
    const member = await getMembership(pool, id, req.user.id);
    if (!isActive(member)) return res.status(403).json({ error: "Access denied" });

    const { theme, language, timezone, date_format, notifications, sidebar_collapsed, dashboard_layout } = req.body;
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.user_preferences (user_id, company_id, theme, language, timezone, date_format,
           notifications, sidebar_collapsed, dashboard_layout)
         VALUES ($1, $2,
           COALESCE($3, 'system'), COALESCE($4, 'en'), COALESCE($5, 'UTC'),
           COALESCE($6, 'MMM d, yyyy'),
           COALESCE($7::jsonb, '{"email_digest":true,"member_joined":true,"report_ready":true}'),
           COALESCE($8, false),
           COALESCE($9::jsonb, '{}'))
         ON CONFLICT (user_id, company_id) DO UPDATE SET
           theme             = COALESCE(EXCLUDED.theme, user_preferences.theme),
           language          = COALESCE(EXCLUDED.language, user_preferences.language),
           timezone          = COALESCE(EXCLUDED.timezone, user_preferences.timezone),
           date_format       = COALESCE(EXCLUDED.date_format, user_preferences.date_format),
           notifications     = COALESCE(EXCLUDED.notifications, user_preferences.notifications),
           sidebar_collapsed = COALESCE(EXCLUDED.sidebar_collapsed, user_preferences.sidebar_collapsed),
           dashboard_layout  = COALESCE(EXCLUDED.dashboard_layout, user_preferences.dashboard_layout),
           updated_date      = NOW()
         RETURNING *`,
        [
          req.user.id, id, theme, language, timezone, date_format,
          notifications ? JSON.stringify(notifications) : null,
          sidebar_collapsed ?? null,
          dashboard_layout ? JSON.stringify(dashboard_layout) : null,
        ]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/companies/:id/api-keys
  router.get("/:id/api-keys", authenticate, async (req, res) => {
    const { id } = req.params;
    const myMember = await getMembership(pool, id, req.user.id);
    if (!isAdmin(myMember)) return res.status(403).json({ error: "Admin access required" });

    try {
      const { rows } = await pool.query(
        `SELECT ak.id, ak.name, ak.key_prefix, ak.permissions, ak.expires_at,
                ak.last_used_at, ak.is_active, ak.created_date,
                u.full_name AS created_by_name, u.email AS created_by_email
         FROM app.api_keys ak
         JOIN app.users u ON u.id = ak.created_by
         WHERE ak.company_id = $1
         ORDER BY ak.created_date DESC`,
        [id]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/companies/:id/api-keys
  router.post("/:id/api-keys", authenticate, async (req, res) => {
    const { id } = req.params;
    const myMember = await getMembership(pool, id, req.user.id);
    if (!isAdmin(myMember)) return res.status(403).json({ error: "Admin access required" });

    const { name, permissions = ["read"], expires_at } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    try {
      const rawKey = `cdp_${crypto.randomBytes(32).toString("hex")}`;
      const key_hash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const key_prefix = rawKey.substring(0, 12);

      const { rows: [key] } = await pool.query(
        `INSERT INTO app.api_keys (company_id, created_by, name, key_hash, key_prefix, permissions, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, req.user.id, name, key_hash, key_prefix, permissions, expires_at || null]
      );

      res.status(201).json({
        ...key,
        raw_key: rawKey,
        warning: "Store this key securely - it will not be shown again",
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/companies/:id/api-keys/:keyId
  router.delete("/:id/api-keys/:keyId", authenticate, async (req, res) => {
    const { id, keyId } = req.params;
    const myMember = await getMembership(pool, id, req.user.id);
    if (!isAdmin(myMember)) return res.status(403).json({ error: "Admin access required" });

    try {
      await pool.query(
        "UPDATE app.api_keys SET is_active = false WHERE id = $1 AND company_id = $2",
        [keyId, id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/companies/:id/audit-log
  router.get("/:id/audit-log", authenticate, async (req, res) => {
    const { id } = req.params;
    const myMember = await getMembership(pool, id, req.user.id);
    if (!isAdmin(myMember)) return res.status(403).json({ error: "Admin access required" });

    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const { rows } = await pool.query(
        `SELECT al.*, u.full_name AS user_name, u.email AS user_email
         FROM app.audit_log al
         LEFT JOIN app.users u ON u.id = al.user_id
         WHERE al.company_id = $1
         ORDER BY al.occurred_at DESC
         LIMIT $2`,
        [id, limit]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
