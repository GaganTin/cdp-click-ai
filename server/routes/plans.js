import { Router } from "express";
import { authenticate, requirePlatformAdmin } from "../middleware/auth.js";

// Fallback used when DB is not available - mirrors the DB seed exactly.
// Only two plans exist: 'free' (30-day trial) and 'paid' (contact sales).
export const FALLBACK_PLANS = [
  {
    id: "free", name: "Free", price_display: "$0", period: "1 month free",
    badge: "Trial",
    description: "Try everything free for 30 days. Solo use only - no team members.",
    cta_label: "Start free trial", cta_href: "/register", cta_external: false,
    is_highlighted: false, sort_order: 1, trial_days: 30, warning_days: 7,
    features: ["Solo user only (no team members)", "5 workspaces", "1,000 customer profiles", "5 email campaigns", "1,000 AI tokens", "UTM tracking", "Read-only access after trial ends"],
    limits: { profiles: 1000, campaigns: 5, ai_tokens: 1000, team_members: 1, workspaces: 5 },
    is_active: true,
  },
  {
    id: "paid", name: "Paid", price_display: "Contact sales", period: "",
    badge: null,
    description: "For growing teams that need more power and fewer limits. Talk to our team to get set up.",
    cta_label: "Contact sales", cta_href: "mailto:support@clickcdp.com?subject=Upgrade to Paid", cta_external: true,
    is_highlighted: true, sort_order: 2, trial_days: null, warning_days: 7,
    features: ["Up to 5 team members", "5 workspaces", "100,000 customer profiles", "Unlimited email campaigns", "Unlimited AI tokens", "Advanced segmentation", "Priority support"],
    limits: { profiles: 100000, campaigns: null, ai_tokens: null, team_members: 5, workspaces: 5 },
    is_active: true,
  },
];

export function createPlansRouter(pool) {
  const router = Router();

  // GET /api/plans - public, no auth required
  router.get("/", async (_req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM app.plans WHERE is_active = true ORDER BY sort_order"
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/plans/:id - update plan config (platform owners only; the Studio
  // console uses /api/admin/plans/:id, this hardens the legacy endpoint).
  router.patch("/:id", authenticate, requirePlatformAdmin(pool), async (req, res) => {
    const allowed = ["name","price_display","period","badge","description","cta_label","cta_href","cta_external","is_highlighted","trial_days","warning_days","features","limits","is_active"];
    const sets = [];
    const vals = [];

    for (const key of allowed) {
      if (key in req.body) {
        sets.push(`${key} = $${sets.length + 1}`);
        const v = req.body[key];
        vals.push((key === "features" || key === "limits") ? JSON.stringify(v) : v);
      }
    }

    if (!sets.length) return res.status(400).json({ error: "No fields to update" });
    vals.push(req.params.id);

    try {
      const { rows } = await pool.query(
        `UPDATE app.plans SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      if (!rows.length) return res.status(404).json({ error: "Plan not found" });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
