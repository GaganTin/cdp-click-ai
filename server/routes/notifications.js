import { Router } from "express";
import { authenticate, withCompany } from "../middleware/auth.js";

// In-app notification feed for the bell. Every endpoint is scoped to the
// authenticated user AND the active workspace (x-company-id via withCompany),
// so a user only ever sees/mutates their own notifications in the current
// workspace. Read-only-friendly: marking-as-read is allowed for any role
// (it's the caller's own state, not workspace data).
export function createNotificationsRouter(pool) {
  const router = Router();

  // GET /api/notifications?limit=20&unread=true
  // Returns the newest notifications for this user+workspace plus the unread count.
  router.get("/", authenticate, withCompany(pool), async (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const onlyUnread = req.query.unread === "true";
    try {
      const { rows } = await pool.query(
        `SELECT id, type, title, body, link, metadata, is_read, read_at, created_date
           FROM app.notifications
          WHERE user_id = $1 AND company_id = $2
            ${onlyUnread ? "AND is_read = false" : ""}
          ORDER BY created_date DESC
          LIMIT $3`,
        [req.user.id, req.companyId, limit]
      );
      const { rows: cnt } = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM app.notifications
          WHERE user_id = $1 AND company_id = $2 AND is_read = false`,
        [req.user.id, req.companyId]
      );
      res.json({ notifications: rows, unread_count: cnt[0].n });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/notifications/:id/read - mark a single notification read.
  router.post("/:id/read", authenticate, withCompany(pool), async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE app.notifications
            SET is_read = true, read_at = NOW()
          WHERE id = $1 AND user_id = $2 AND company_id = $3 AND is_read = false
          RETURNING id`,
        [req.params.id, req.user.id, req.companyId]
      );
      res.json({ updated: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/notifications/read-all - mark every unread notification read.
  router.post("/read-all", authenticate, withCompany(pool), async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        `UPDATE app.notifications
            SET is_read = true, read_at = NOW()
          WHERE user_id = $1 AND company_id = $2 AND is_read = false`,
        [req.user.id, req.companyId]
      );
      res.json({ updated: rowCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/notifications - clear ALL notifications for this user+workspace.
  router.delete("/", authenticate, withCompany(pool), async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM app.notifications WHERE user_id = $1 AND company_id = $2`,
        [req.user.id, req.companyId]
      );
      res.json({ deleted: rowCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/notifications/:id - clear a single notification.
  router.delete("/:id", authenticate, withCompany(pool), async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM app.notifications
          WHERE id = $1 AND user_id = $2 AND company_id = $3`,
        [req.params.id, req.user.id, req.companyId]
      );
      res.json({ deleted: rowCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
