import { Router } from "express";
import { authenticate, requirePlatformAdmin } from "../middleware/auth.js";

// Fallback used when DB is not available - mirrors the DB seed exactly.
// Three tiers: 'lite' ($100/mo, 2-month trial), 'standard' ($199/mo), 'enterprise'
// (contact sales). team_members:null => unlimited. ai_tokens are stored as raw
// tokens (gpt-5-mini @ $0.25/$2.00 per 1M) but shown in the UI as "credits"
// at 100,000 tokens = 1 credit (10M => 100, 30M => 300).
export const FALLBACK_PLANS = [
  {
    id: "lite", name: "Lite", price_display: "$100", period: "/month",
    badge: null,
    description: "Everything you need to get started with AI-powered customer data.",
    cta_label: "Start 2-month free trial", cta_href: "/register", cta_external: false,
    is_highlighted: false, sort_order: 1, trial_days: 60, warning_days: 7,
    features: ["Unlimited team members", "2 workspaces", "Up to 10,000 customer profiles", "AI Analyst", "Intelligent Segmentation", "UTM tracking", "AI Content & Traffic Analysis", "Dynamic Pop-up", "5 Emails Sent", "100 credits / month"],
    limits: { profiles: 10000, campaigns: 5, ai_tokens: 10000000, team_members: null, workspaces: 2 },
    is_active: true,
  },
  {
    id: "standard", name: "Standard", price_display: "$199", period: "/month",
    badge: "Most popular",
    description: "For growing teams that need more scale and higher send volume.",
    cta_label: "Get started", cta_href: "/register", cta_external: false,
    is_highlighted: true, sort_order: 2, trial_days: null, warning_days: 7,
    features: ["Unlimited team members", "5 workspaces", "Up to 50,000 customer profiles", "AI Analyst", "Intelligent Segmentation", "UTM tracking", "AI Content & Traffic Analysis", "Dynamic Pop-up", "50,000 Emails Sent", "300 credits / month"],
    limits: { profiles: 50000, campaigns: 50000, ai_tokens: 30000000, team_members: null, workspaces: 5 },
    is_active: true,
  },
  {
    id: "enterprise", name: "Enterprise", price_display: "Contact sales", period: "",
    badge: null,
    description: "For high-volume teams. Custom profile and AI limits, tailored to you.",
    cta_label: "Contact sales", cta_href: "mailto:support@clickcdp.com?subject=Upgrade to Enterprise", cta_external: true,
    is_highlighted: false, sort_order: 3, trial_days: null, warning_days: 7,
    features: ["Unlimited team members", "5+ workspaces", "Custom customer profile volume", "AI Analyst", "Intelligent Segmentation", "UTM tracking", "AI Content & Traffic Analysis", "Dynamic Pop-up", "Unlimited Emails Sent", "Custom credits", "Priority support"],
    limits: { profiles: null, campaigns: null, ai_tokens: null, team_members: null, workspaces: null },
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
