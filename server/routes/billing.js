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
                (SELECT COALESCE(SUM(au.cost), 0) FROM app.ai_usage au
                   WHERE au.company_id = c.id)                                    AS ai_cost,
                (SELECT COUNT(*) FROM app.customer_profiles cp WHERE cp.company_id = c.id) AS profiles
           FROM app.companies c
          WHERE c.account_id = $1
          ORDER BY c.created_date`,
        [accountId]
      );

      // Account-wide AI spend straight from the cost ledger (includes rows whose
      // workspace was later deleted, which is why it's keyed on account_id).
      const { rows: aiRows } = await pool.query(
        `SELECT COALESCE(SUM(total_tokens), 0)  AS tokens,
                COALESCE(SUM(input_tokens), 0)   AS input_tokens,
                COALESCE(SUM(output_tokens), 0)  AS output_tokens,
                COALESCE(SUM(cost), 0)           AS cost,
                COALESCE(MAX(currency), 'USD')   AS currency
           FROM app.ai_usage WHERE account_id = $1`,
        [accountId]
      );
      const ai = aiRows[0] || {};

      // Account-wide team members = DISTINCT users across all workspaces (a user
      // who belongs to several workspaces counts once against the team limit).
      const { rows: tm } = await pool.query(
        `SELECT COUNT(DISTINCT cm.user_id) AS n
           FROM app.company_members cm
           JOIN app.companies c ON c.id = cm.company_id
          WHERE c.account_id = $1 AND cm.status = 'active'`,
        [accountId]
      );

      const money = (v) => Math.round((parseFloat(v) || 0) * 1e6) / 1e6;

      const workspaces = wsRows.map((w) => ({
        id: w.id,
        name: w.name,
        team_members: num(w.team_members),
        campaigns: num(w.campaigns),
        ai_tokens: num(w.ai_tokens),
        ai_cost: money(w.ai_cost),
        profiles: num(w.profiles),
      }));

      const overall = {
        team_members: num(tm[0]?.n),
        campaigns: workspaces.reduce((s, w) => s + w.campaigns, 0),
        // AI totals come from the cost ledger (account-keyed) so they stay correct
        // even after a workspace is deleted.
        ai_tokens: num(ai.tokens),
        ai_input_tokens: num(ai.input_tokens),
        ai_output_tokens: num(ai.output_tokens),
        ai_cost: money(ai.cost),
        ai_currency: ai.currency || "USD",
        profiles: workspaces.reduce((s, w) => s + w.profiles, 0),
        workspaces_count: workspaces.length,
      };

      res.json({
        // Flat keys kept for backward compatibility (now account-wide totals).
        team_members: overall.team_members,
        campaigns: overall.campaigns,
        ai_tokens: overall.ai_tokens,
        ai_cost: overall.ai_cost,
        ai_currency: overall.ai_currency,
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
