import { Router } from "express";
import { authenticate, withCompany } from "../middleware/auth.js";

export function createBillingRouter(pool) {
  const router = Router();

  // GET /api/billing/usage - current quota usage for the company
  router.get("/usage", authenticate, withCompany(pool), async (req, res) => {
    try {
      const [members, campaigns, tokens, profiles] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) FROM app.company_members
           WHERE company_id = $1 AND status = 'active'`,
          [req.companyId]
        ),
        pool.query(
          `SELECT COUNT(*) FROM app.edm_campaigns WHERE company_id = $1`,
          [req.companyId]
        ),
        pool.query(
          `SELECT COALESCE(SUM(quantity), 0) AS total
           FROM app.usage_events
           WHERE company_id = $1 AND event_type = 'ai_token'`,
          [req.companyId]
        ),
        pool.query(`SELECT COUNT(*) FROM app.customer_profiles`),
      ]);

      res.json({
        team_members: parseInt(members.rows[0].count),
        campaigns:    parseInt(campaigns.rows[0].count),
        ai_tokens:    parseInt(tokens.rows[0].total),
        profiles:     parseInt(profiles.rows[0].count),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/billing/invoices - invoice history for the company
  router.get("/invoices", authenticate, withCompany(pool), async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, amount, currency, status, description,
                invoice_date, period_start, period_end, invoice_url
         FROM app.billing_invoices
         WHERE company_id = $1
         ORDER BY invoice_date DESC
         LIMIT 100`,
        [req.companyId]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
