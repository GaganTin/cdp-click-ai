import { Router } from "express";
import { authenticate, requirePlatformAdmin } from "../middleware/auth.js";

// ============================================================================
//  Platform-wide announcement banners.
//   • GET /api/announcements/active  - ANY authenticated user; powers the app-
//     wide banner. Returns only currently-live announcements.
//   • GET/POST/PATCH/DELETE /api/announcements[/:id] - platform owners only
//     (Studio). Full management of the announcement catalog.
//
//  Announcements are global broadcasts (not per-workspace), so none of these
//  endpoints use x-company-id / withCompany.
// ============================================================================
const LEVELS = ["info", "success", "warning", "maintenance"];

// Shape returned to the management UI (everything) and the banner (subset).
const COLS = `id, level, title, body, link_url, link_label, is_active,
              dismissible, starts_at, ends_at, created_by, created_at, updated_at`;

export function createAnnouncementsRouter(pool) {
  const router = Router();

  // ── GET /api/announcements/active ─────────────────────────────────────────
  // Live announcements for the current moment, newest first. Any logged-in user.
  router.get("/active", authenticate, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, level, title, body, link_url, link_label, dismissible, created_at
           FROM app.announcements
          WHERE is_active = true
            AND (starts_at IS NULL OR starts_at <= NOW())
            AND (ends_at   IS NULL OR ends_at   >= NOW())
          ORDER BY created_at DESC`
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Everything below is platform-owner only.
  router.use(authenticate, requirePlatformAdmin(pool));

  // ── GET /api/announcements ────────────────────────────────────────────────
  // Full catalog (active + scheduled + expired + disabled) for the Studio tab.
  router.get("/", async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT ${COLS} FROM app.announcements ORDER BY created_at DESC`
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/announcements ───────────────────────────────────────────────
  router.post("/", async (req, res) => {
    const {
      level = "info", title, body,
      link_url, link_label,
      is_active = true, dismissible = true,
      starts_at, ends_at,
    } = req.body || {};

    if (!body?.trim()) return res.status(400).json({ error: "body is required" });
    if (!LEVELS.includes(level)) return res.status(400).json({ error: "invalid level" });

    try {
      const { rows } = await pool.query(
        `INSERT INTO app.announcements
           (level, title, body, link_url, link_label, is_active, dismissible, starts_at, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${COLS}`,
        [
          level,
          title?.trim() || null,
          body.trim(),
          link_url?.trim() || null,
          link_label?.trim() || null,
          is_active !== false,
          dismissible !== false,
          starts_at || null,
          ends_at || null,
          req.user.id,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/announcements/:id ──────────────────────────────────────────
  // Partial update; only the supplied fields change.
  router.patch("/:id", async (req, res) => {
    const allowed = ["level", "title", "body", "link_url", "link_label", "is_active", "dismissible", "starts_at", "ends_at"];
    const sets = [];
    const vals = [];
    let i = 1;

    for (const key of allowed) {
      if (!(key in (req.body || {}))) continue;
      let v = req.body[key];
      if (key === "level" && !LEVELS.includes(v)) return res.status(400).json({ error: "invalid level" });
      if (key === "body" && !String(v || "").trim()) return res.status(400).json({ error: "body cannot be empty" });
      if (["title", "body", "link_url", "link_label"].includes(key)) v = (v == null || v === "") ? null : String(v).trim();
      if (["starts_at", "ends_at"].includes(key)) v = v || null;
      sets.push(`${key} = $${i++}`);
      vals.push(v);
    }
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

    sets.push(`updated_at = NOW()`);
    vals.push(req.params.id);

    try {
      const { rows } = await pool.query(
        `UPDATE app.announcements SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${COLS}`,
        vals
      );
      if (!rows.length) return res.status(404).json({ error: "announcement not found" });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/announcements/:id ─────────────────────────────────────────
  router.delete("/:id", async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM app.announcements WHERE id = $1`,
        [req.params.id]
      );
      if (!rowCount) return res.status(404).json({ error: "announcement not found" });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
