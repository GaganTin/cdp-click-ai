import { Router } from "express";
import { authenticate, withCompany } from "../middleware/auth.js";

export function createBillingRouter(pool) {
  const router = Router();

  // GET /api/billing/usage - quota usage for the whole ACCOUNT (plan limits are
  // account-level) plus a per-workspace breakdown.
  //   - top-level flat keys (team_members/campaigns/ai_tokens/profiles) =
  //     account-wide totals, compared against the plan limits in the UI.
  //   - `overall`    = the same totals as an explicit object (+ workspaces_count).
  //   - `workspaces` = per-workspace breakdown of each metric.
  // (Previously `profiles` was counted globally across ALL tenants - now scoped
  //  to the account's own workspaces.)
  router.get("/usage", authenticate, withCompany(pool), async (req, res) => {
    try {
      // Limits live on the account; resolve it from the active workspace.
      const { rows: arows } = await pool.query(
        "SELECT account_id FROM app.companies WHERE id = $1",
        [req.companyId]
      );
      const accountId = arows[0]?.account_id;
      if (!accountId) return res.status(404).json({ error: "Account not found" });

      const num = (v) => parseInt(v, 10) || 0;

      // Per-workspace metrics for every workspace in the account.
      const { rows: wsRows } = await pool.query(
        `SELECT c.id, c.name,
                (SELECT COUNT(*) FROM app.company_members cm
                   WHERE cm.company_id = c.id AND cm.status = 'active')           AS team_members,
                (SELECT COUNT(*) FROM app.edm_campaigns ec WHERE ec.company_id = c.id) AS campaigns,
                (SELECT COALESCE(SUM(ue.quantity), 0) FROM app.usage_events ue
                   WHERE ue.company_id = c.id AND ue.event_type = 'ai_token')     AS ai_tokens,
                (SELECT COUNT(*) FROM app.customer_profiles cp WHERE cp.company_id = c.id) AS profiles
           FROM app.companies c
          WHERE c.account_id = $1
          ORDER BY c.created_date`,
        [accountId]
      );

      // Account-wide team members = DISTINCT users across all workspaces (a user
      // who belongs to several workspaces counts once against the team limit).
      const { rows: tm } = await pool.query(
        `SELECT COUNT(DISTINCT cm.user_id) AS n
           FROM app.company_members cm
           JOIN app.companies c ON c.id = cm.company_id
          WHERE c.account_id = $1 AND cm.status = 'active'`,
        [accountId]
      );

      const workspaces = wsRows.map((w) => ({
        id: w.id,
        name: w.name,
        team_members: num(w.team_members),
        campaigns: num(w.campaigns),
        ai_tokens: num(w.ai_tokens),
        profiles: num(w.profiles),
      }));

      const overall = {
        team_members: num(tm[0]?.n),
        campaigns: workspaces.reduce((s, w) => s + w.campaigns, 0),
        ai_tokens: workspaces.reduce((s, w) => s + w.ai_tokens, 0),
        profiles: workspaces.reduce((s, w) => s + w.profiles, 0),
        workspaces_count: workspaces.length,
      };

      res.json({
        // Flat keys kept for backward compatibility (now account-wide totals).
        team_members: overall.team_members,
        campaigns: overall.campaigns,
        ai_tokens: overall.ai_tokens,
        profiles: overall.profiles,
        workspaces_count: overall.workspaces_count,
        overall,
        workspaces,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
