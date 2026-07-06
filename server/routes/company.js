import { Router } from "express";
import crypto from "crypto";
import { authenticate } from "../middleware/auth.js";
import { registerCompanyWithInteractionService } from "../lib/interactionService.js";
import { slugify, uniqueSlug } from "../lib/slug.js";
import { sendInvitationEmail } from "../services/email.js";
import { isDemoCompany } from "../lib/demoWorkspace.js";

// The shared demo workspace is platform-managed: it can only be created,
// reseeded, or deleted by a platform admin via Studio - never through the normal
// workspace routes. Refuse any such attempt (belt-and-suspenders on top of the
// fact that no user is a member of it).
const DEMO_MANAGED_MSG =
  "The demo workspace is managed by the platform team and can't be changed or deleted here.";

// capsuite_ref is globally unique (external ETL maps it → company_id). Readable
// underscore-cased root from the name + a short random suffix, retry on collision.
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

async function getMembership(pool, companyId, userId) {
  const { rows } = await pool.query(
    "SELECT role, status FROM app.company_members WHERE company_id = $1 AND user_id = $2",
    [companyId, userId]
  );
  return rows[0] || null;
}

function isAdmin(member) {
  return member && member.role === "admin" && member.status === "active";
}

function isActive(member) {
  return member && member.status === "active";
}

export function createCompanyRouter(pool) {
  const router = Router();

  // Active-member count vs the account plan's team_members limit (null = unlimited).
  async function memberLimit(companyId) {
    const { rows } = await pool.query(
      `SELECT p.limits->>'team_members' AS lim,
              (SELECT COUNT(*)::int FROM app.company_members
                WHERE company_id = c.id AND status = 'active') AS active
         FROM app.companies c
         JOIN app.accounts a ON a.id = c.account_id
         JOIN app.plans p    ON p.id = a.plan
        WHERE c.id = $1`,
      [companyId]
    );
    const r = rows[0] || {};
    const limit = r.lim == null || r.lim === "" ? null : parseInt(r.lim, 10);
    return { limit, active: r.active || 0 };
  }

  // Count of active admins in a workspace (used to prevent removing the last one).
  async function activeAdminCount(companyId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM app.company_members
        WHERE company_id = $1 AND role = 'admin' AND status = 'active'`,
      [companyId]
    );
    return rows[0].n;
  }

  // POST /api/companies - create a new workspace under the caller's account
  router.post("/", authenticate, async (req, res) => {
    const { name, website, industry, company_size } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // The new workspace belongs to the caller's account.
      const { rows: [u] } = await client.query(
        "SELECT account_id FROM app.users WHERE id = $1",
        [req.user.id]
      );
      if (!u) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "User not found" });
      }
      const accountId = u.account_id;

      // Enforce the plan's workspace limit (null = unlimited).
      const { rows: [acct] } = await client.query(
        `SELECT a.plan, p.limits FROM app.accounts a JOIN app.plans p ON p.id = a.plan WHERE a.id = $1`,
        [accountId]
      );
      const wsLimit = acct?.limits?.workspaces ?? null;
      if (wsLimit != null) {
        const { rows: [{ n }] } = await client.query(
          "SELECT COUNT(*)::int AS n FROM app.companies WHERE account_id = $1 AND is_active = true",
          [accountId]
        );
        if (n >= wsLimit) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            error: `Your ${acct.plan} plan allows up to ${wsLimit} workspace(s). Upgrade to add more.`,
          });
        }
      }

      const slug = await uniqueSlug(client, name);
      const capsuite_ref = await uniqueCapsuiteRef(client, name);
      const { rows: [company] } = await client.query(
        `INSERT INTO app.companies (account_id, name, slug, capsuite_ref, website, industry, company_size, plan)
         VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT plan FROM app.accounts WHERE id = $1))
         RETURNING *`,
        [accountId, name, slug, capsuite_ref, website || null, industry || null, company_size || null]
      );

      await client.query(
        `INSERT INTO app.company_members (account_id, company_id, user_id, role, status)
         VALUES ($1, $2, $3, 'admin', 'active')`,
        [accountId, company.id, req.user.id]
      );

      await client.query(
        `INSERT INTO app.user_preferences (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.user.id, company.id]
      );

      // Seed the per-workspace pipeline config rows (ga_reports/gsc_reports etc.
      // come from column defaults). Without these the GA/GSC DAGs LEFT JOIN to a
      // NULL config and silently skip the workspace.
      await client.query(
        `INSERT INTO app.company_report_config (company_id, created_by, capsuite_ref, is_trial)
         VALUES ($1, $2, $3, (SELECT plan_expires_at IS NOT NULL FROM app.accounts WHERE id = $4))
         ON CONFLICT (company_id) DO NOTHING`,
        [company.id, req.user.id, capsuite_ref, accountId]
      );
      await client.query(
        `INSERT INTO app.web_content_html_elements (company_id, created_by, capsuite_ref)
         VALUES ($1, $2, $3) ON CONFLICT (company_id) DO NOTHING`,
        [company.id, req.user.id, capsuite_ref]
      );

      await client.query(
        `INSERT INTO app.audit_log (account_id, company_id, user_id, action, resource_type, resource_id)
         VALUES ($1, $2, $3, 'create', 'workspace', $4)`,
        [accountId, company.id, req.user.id, company.id]
      );

      await client.query("COMMIT");

      // Register with interaction service - non-fatal if service is down
      registerCompanyWithInteractionService(pool, company.id, company.name).catch(() => {});

      res.status(201).json(company);
    } catch (err) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
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
    if (await isDemoCompany(pool, id)) return res.status(403).json({ error: DEMO_MANAGED_MSG });
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
      const slug = await uniqueSlug(pool, name, { excludeId: id });
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

  // DELETE /api/companies/:id - permanently delete a workspace and ALL its data.
  // Guards: admin only, the caller must type the exact workspace name
  // (confirm_name), and an account may never be left with zero workspaces.
  router.delete("/:id", authenticate, async (req, res) => {
    const { id } = req.params;
    if (await isDemoCompany(pool, id)) return res.status(403).json({ error: DEMO_MANAGED_MSG });
    const member = await getMembership(pool, id, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: "Admin access required" });

    const confirmName = typeof req.body?.confirm_name === "string" ? req.body.confirm_name.trim() : "";

    const client = await pool.connect();
    try {
      const { rows: [company] } = await client.query(
        "SELECT name, capsuite_ref, account_id FROM app.companies WHERE id = $1",
        [id]
      );
      if (!company) return res.status(404).json({ error: "Workspace not found" });

      // Type-to-confirm gate: the deliberate-action check against accidental deletes.
      if (confirmName !== company.name) {
        return res.status(400).json({ error: "The name you typed doesn't match the workspace name." });
      }

      // Never leave the account with no workspaces.
      const { rows: [{ n }] } = await client.query(
        "SELECT COUNT(*)::int AS n FROM app.companies WHERE account_id = $1 AND is_active = true",
        [company.account_id]
      );
      if (n <= 1) {
        return res.status(400).json({ error: "You can't delete your only workspace. Create another one first." });
      }

      await client.query("BEGIN");
      // Audit BEFORE the delete: audit_log.company_id is ON DELETE SET NULL, so the
      // record survives the cascade with account_id + resource_id intact.
      await client.query(
        `INSERT INTO app.audit_log (account_id, company_id, user_id, action, resource_type, resource_id, changes)
         VALUES ($1, $2, $3, 'delete', 'workspace', $4, $5)`,
        [company.account_id, id, req.user.id, id, JSON.stringify({ name: company.name })]
      );
      // Deleting the company row cascades every company_id-scoped table (members,
      // profiles, integrations, ga_landing, commerce, attributes, popups, edm, …).
      await client.query("DELETE FROM app.companies WHERE id = $1", [id]);
      await client.query("COMMIT");

      // Best-effort cleanup of sync watermarks keyed by capsuite_ref (no FK cascade),
      // so a future workspace reusing the ref re-runs a clean first backfill.
      Promise.allSettled([
        pool.query("DELETE FROM ga_landing.ga_sync_control WHERE capsuite_ref = $1", [company.capsuite_ref]),
        pool.query("DELETE FROM shopify.shopify_sync_control WHERE capsuite_ref = $1", [company.capsuite_ref]),
      ]);

      res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // GET /api/companies/:id/members
  router.get("/:id/members", authenticate, async (req, res) => {
    const { id } = req.params;
    const member = await getMembership(pool, id, req.user.id);
    if (!isActive(member)) return res.status(403).json({ error: "Access denied" });

    try {
      const { rows } = await pool.query(
        `SELECT cm.id, cm.role, cm.status, cm.joined_at, cm.permissions,
                u.id AS user_id, u.email, u.full_name, u.avatar_url, u.last_login_at,
                (a.owner_user_id = cm.user_id) AS is_account_owner
         FROM app.company_members cm
         JOIN app.users u ON u.id = cm.user_id
         JOIN app.companies c ON c.id = cm.company_id
         JOIN app.accounts a ON a.id = c.account_id
         WHERE cm.company_id = $1
         ORDER BY
           (a.owner_user_id = cm.user_id) DESC,
           CASE cm.role WHEN 'admin' THEN 0 WHEN 'contributor' THEN 1 ELSE 2 END,
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
      if (!["admin", "contributor", "viewer"].includes(role)) {
        return res.status(400).json({ error: "role must be admin, contributor, or viewer" });
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
        `SELECT cm.role, cm.status AS target_status, (a.owner_user_id = cm.user_id) AS is_account_owner
         FROM app.company_members cm
         JOIN app.companies c ON c.id = cm.company_id
         JOIN app.accounts a ON a.id = c.account_id
         WHERE cm.id = $1 AND cm.company_id = $2`,
        [memberId, id]
      );
      if (!target) return res.status(404).json({ error: "Member not found" });
      if (target.is_account_owner) return res.status(400).json({ error: "Cannot change the account owner's role" });

      // Don't let the workspace lose its last active admin.
      const removingAdmin =
        (role !== undefined && role !== "admin") || (status !== undefined && status !== "active");
      if (target.role === "admin" && target.target_status === "active" && removingAdmin
          && (await activeAdminCount(id)) <= 1) {
        return res.status(400).json({ error: "A workspace must keep at least one active admin." });
      }

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
        `SELECT cm.role, cm.status AS target_status, cm.user_id, (a.owner_user_id = cm.user_id) AS is_account_owner
         FROM app.company_members cm
         JOIN app.companies c ON c.id = cm.company_id
         JOIN app.accounts a ON a.id = c.account_id
         WHERE cm.id = $1 AND cm.company_id = $2`,
        [memberId, id]
      );
      if (!target) return res.status(404).json({ error: "Member not found" });
      if (target.is_account_owner) return res.status(400).json({ error: "Cannot remove the account owner" });

      // Don't let the workspace lose its last active admin.
      if (target.role === "admin" && target.target_status === "active" && (await activeAdminCount(id)) <= 1) {
        return res.status(400).json({ error: "A workspace must keep at least one active admin." });
      }

      await pool.query("DELETE FROM app.company_members WHERE id = $1 AND company_id = $2", [memberId, id]);

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
    if (!["admin", "contributor", "viewer"].includes(role)) {
      return res.status(400).json({ error: "role must be admin, contributor, or viewer" });
    }

    try {
      // Already a member (active OR suspended)? Re-inviting a suspended member
      // must NOT silently reactivate them - admins un-suspend explicitly.
      const { rows: existingMember } = await pool.query(
        `SELECT cm.status FROM app.company_members cm
         JOIN app.users u ON u.id = cm.user_id
         WHERE cm.company_id = $1 AND LOWER(u.email) = LOWER($2)`,
        [id, email]
      );
      if (existingMember.length) {
        if (existingMember[0].status === "suspended") {
          return res.status(409).json({ error: "This user is suspended in this workspace. Un-suspend them instead of re-inviting." });
        }
        return res.status(409).json({ error: "This user is already a member" });
      }

      // Enforce the account plan's team-member limit (null = unlimited).
      const { limit, active } = await memberLimit(id);
      if (limit != null && active >= limit) {
        return res.status(403).json({
          error: `Your plan allows up to ${limit} team member${limit === 1 ? "" : "s"} per workspace. Upgrade to add more.`,
        });
      }

      // Cancel any existing pending invite
      await pool.query(
        `UPDATE app.company_invitations SET status = 'cancelled'
         WHERE company_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'`,
        [id, email]
      );

      const { rows: [inv] } = await pool.query(
        `INSERT INTO app.company_invitations (account_id, company_id, invited_by, email, role)
         VALUES ((SELECT account_id FROM app.companies WHERE id = $1), $1, $2, $3, $4) RETURNING *`,
        [id, req.user.id, email.toLowerCase(), role]
      );

      await pool.query(
        `INSERT INTO app.audit_log (company_id, user_id, action, resource_type, resource_id, changes)
         VALUES ($1, $2, 'invite_member', 'invitation', $3, $4)`,
        [id, req.user.id, inv.id, JSON.stringify({ email, role })]
      );

      // Email the invite link (best-effort: a delivery failure must not fail the
      // invite - the record exists and the admin can still copy the link from the UI).
      let email_delivery = { sent: false, simulated: false, error: null };
      try {
        const { rows: [ctx] } = await pool.query(
          `SELECT c.name AS company_name, u.full_name AS inviter_name
             FROM app.companies c, app.users u
            WHERE c.id = $1 AND u.id = $2`,
          [id, req.user.id]
        );
        const r = await sendInvitationEmail(inv.email, inv.token, {
          companyName: ctx?.company_name,
          inviterName: ctx?.inviter_name,
        });
        email_delivery = { sent: !r?.simulated, simulated: !!r?.simulated, error: null };
        if (r?.simulated) console.warn("[company] invitation email simulated (RESEND_API_KEY unset) for", inv.email);
      } catch (e) {
        console.error("[company] invitation email FAILED for", inv.email, "-", e.message);
        email_delivery = { sent: false, simulated: false, error: e.message };
      }

      res.status(201).json({ ...inv, email_delivery });
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

  // GET /api/companies/invitation/:token - public invite preview (no auth).
  // Lets the /join landing page show who invited whom, and which email to sign in
  // with, before the recipient has an account. Never exposes anything sensitive.
  router.get("/invitation/:token", async (req, res) => {
    const { token } = req.params;
    try {
      const { rows } = await pool.query(
        `SELECT ci.email, ci.role, ci.status, (ci.expires_at <= NOW()) AS expired,
                c.name AS company_name, u.full_name AS inviter_name
           FROM app.company_invitations ci
           JOIN app.companies c ON c.id = ci.company_id
           JOIN app.users u ON u.id = ci.invited_by
          WHERE ci.token = $1`,
        [token]
      );
      if (!rows.length) return res.status(404).json({ error: "Invitation not found" });
      const inv = rows[0];
      const valid = inv.status === "pending" && !inv.expired;
      res.json({
        email: inv.email,
        role: inv.role,
        company_name: inv.company_name,
        inviter_name: inv.inviter_name,
        status: inv.status,
        expired: inv.expired,
        valid,
      });
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

      // A stale invite must not reactivate a suspended membership.
      const { rows: [existing] } = await pool.query(
        `SELECT status FROM app.company_members WHERE company_id = $1 AND user_id = $2`,
        [inv.company_id, req.user.id]
      );
      if (existing?.status === "suspended") {
        return res.status(403).json({ error: "Your access to this workspace is suspended. Contact an admin." });
      }

      // Re-check the plan team-member limit at accept time (unless already a member).
      if (!existing) {
        const { limit, active } = await memberLimit(inv.company_id);
        if (limit != null && active >= limit) {
          return res.status(403).json({ error: "This workspace has reached its team-member limit." });
        }
      }

      await pool.query(
        `INSERT INTO app.company_members (account_id, company_id, user_id, role, permissions, invited_by, status)
         SELECT c.account_id, $1, $2, $3, $4::jsonb, $5, 'active'
         FROM app.companies c WHERE c.id = $1
         ON CONFLICT (company_id, user_id)
         DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions, status = 'active'`,
        [inv.company_id, req.user.id, inv.role, JSON.stringify(inv.permissions || {}), inv.invited_by]
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
           COALESCE($7::jsonb, '{"campaign_completed":true,"sync_status":true,"new_leads":true}'),
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
