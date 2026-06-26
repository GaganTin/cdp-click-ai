import { Router } from "express";
import { authenticate, clearAuthCookie } from "../middleware/auth.js";

export function createAccountRouter(pool) {
  const router = Router();

  // Resolve the caller's account, ownership, and the workspace/member shape that
  // gates account deletion. Computed server-side and re-checked on the actual
  // DELETE so the client's copy is never trusted.
  async function deletionContext(userId) {
    const { rows: [u] } = await pool.query(
      `SELECT u.account_id, u.email, a.name AS account_name,
              (a.owner_user_id = u.id) AS is_account_owner
         FROM app.users u
         JOIN app.accounts a ON a.id = u.account_id
        WHERE u.id = $1 AND u.is_active = true`,
      [userId]
    );
    if (!u) return null;

    const { rows: [counts] } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM app.companies
            WHERE account_id = $1 AND is_active = true) AS active_workspaces,
         (SELECT COUNT(DISTINCT cm.user_id)::int
            FROM app.company_members cm
            JOIN app.companies c ON c.id = cm.company_id
           WHERE c.account_id = $1 AND c.is_active = true
             AND cm.status = 'active' AND cm.user_id <> $2) AS other_members`,
      [u.account_id, userId]
    );

    const active_workspaces = counts?.active_workspaces || 0;
    const other_members = counts?.other_members || 0;
    // Self-serve delete is allowed for the owner as long as no OTHER active member
    // exists in any workspace (multiple solo workspaces are fine). Any other active
    // member anywhere routes to support.
    const can_self_delete = u.is_account_owner && other_members === 0;

    return {
      account_id: u.account_id,
      account_name: u.account_name,
      email: u.email,
      is_account_owner: u.is_account_owner,
      active_workspaces,
      other_members,
      can_self_delete,
    };
  }

  // GET /api/account/deletion-status - tells the UI whether the owner can delete
  // the account themselves or must contact support, and what to type to confirm.
  router.get("/deletion-status", authenticate, async (req, res) => {
    try {
      const ctx = await deletionContext(req.user.id);
      if (!ctx) return res.status(404).json({ error: "Account not found" });
      const { account_id, ...safe } = ctx; // don't leak the raw account id
      res.json(safe);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/account - permanently delete the whole account and ALL its data.
  // Guards: owner only; type-email-to-confirm; blocked when the account has other
  // members or more than one active workspace (those go through support).
  router.delete("/", authenticate, async (req, res) => {
    const confirm = typeof req.body?.confirm === "string" ? req.body.confirm.trim() : "";
    try {
      const ctx = await deletionContext(req.user.id);
      if (!ctx) return res.status(404).json({ error: "Account not found" });
      if (!ctx.is_account_owner) {
        return res.status(403).json({ error: "Only the account owner can delete the account." });
      }
      if (!ctx.can_self_delete) {
        return res.status(403).json({
          error: "This account has other team members. Please contact support to delete it.",
        });
      }
      if (confirm.toLowerCase() !== (ctx.email || "").toLowerCase()) {
        return res.status(400).json({ error: "The email you typed doesn't match your account email." });
      }

      // Capture sync watermarks (keyed by capsuite_ref, no FK cascade) to clean up
      // after the row-level cascade below.
      const { rows: refs } = await pool.query(
        "SELECT capsuite_ref FROM app.companies WHERE account_id = $1",
        [ctx.account_id]
      );

      // Deleting the account cascades to users, companies (and every
      // company-scoped row in app.* and the source schemas), members,
      // integrations, audit_log, support_tickets, etc. via ON DELETE CASCADE.
      await pool.query("DELETE FROM app.accounts WHERE id = $1", [ctx.account_id]);
      clearAuthCookie(res);

      // Best-effort cleanup of capsuite_ref-keyed sync state (no FK cascade).
      const cleanups = [];
      for (const { capsuite_ref } of refs) {
        if (!capsuite_ref) continue;
        cleanups.push(
          pool.query("DELETE FROM ga_landing.ga_sync_control WHERE capsuite_ref = $1", [capsuite_ref]),
          pool.query("DELETE FROM shopify.shopify_sync_control WHERE capsuite_ref = $1", [capsuite_ref]),
        );
      }
      Promise.allSettled(cleanups);

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
