import { Router } from "express";
import { authenticate } from "../middleware/auth.js";

const VALID_TYPES     = ["feedback", "bug", "feature_request", "support"];
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

export function createSupportRouter(pool) {
  const router = Router();

  // GET /api/support/tickets - list tickets submitted by the current user
  router.get("/tickets", authenticate, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, type, subject, body, status, priority,
                created_date, updated_date, resolved_at
         FROM app.support_tickets
         WHERE user_id = $1
         ORDER BY created_date DESC
         LIMIT 50`,
        [req.user.id]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/support/tickets - create a new ticket / feedback
  router.post("/tickets", authenticate, async (req, res) => {
    const { type, subject, body, priority } = req.body;

    if (!subject?.trim()) return res.status(400).json({ error: "subject is required" });
    if (!body?.trim())    return res.status(400).json({ error: "body is required" });

    const safeType     = VALID_TYPES.includes(type)       ? type     : "feedback";
    const safePriority = VALID_PRIORITIES.includes(priority) ? priority : "normal";

    let companyId = req.headers["x-company-id"] || null;

    try {
      // The x-company-id header is client-supplied; only stamp it if the user is an
      // active member, so a ticket can't be mis-attributed to another tenant.
      if (companyId) {
        const { rows: m } = await pool.query(
          `SELECT 1 FROM app.company_members WHERE company_id = $1 AND user_id = $2 AND status = 'active'`,
          [companyId, req.user.id]
        );
        if (!m.length) companyId = null;
      }
      // Stamp the account too so the platform-owner Studio can group tickets by
      // client. Derived from the submitting user (every user belongs to one account).
      const { rows: [ticket] } = await pool.query(
        `INSERT INTO app.support_tickets
           (account_id, company_id, user_id, type, subject, body, priority)
         VALUES ((SELECT account_id FROM app.users WHERE id = $2), $1, $2, $3, $4, $5, $6)
         RETURNING id, type, subject, body, status, priority, created_date`,
        [companyId, req.user.id, safeType, subject.trim(), body.trim(), safePriority]
      );
      res.status(201).json(ticket);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
