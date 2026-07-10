import { Router } from "express";
import { authenticate, withCompany, requirePlatformAdmin } from "../middleware/auth.js";
import {
  listAddonProducts, getAddonProduct, getAddonBalance, listAccountAddons,
  getEmailQuota, grantAddon, canPurchaseAddons, getAccountBillingState,
} from "../lib/addons.js";

// Stripe is loaded lazily so the app boots even before the dependency / keys are
// configured. Checkout + webhook return 503 until STRIPE_SECRET_KEY is set.
let _stripe = null, _stripeTried = false;
async function getStripe() {
  if (_stripeTried) return _stripe;
  _stripeTried = true;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const { default: Stripe } = await import("stripe");
    _stripe = new Stripe(key);
  } catch (e) {
    console.error("Stripe unavailable (npm i stripe):", e.message);
    _stripe = null;
  }
  return _stripe;
}

function appBase(req) {
  return (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || req.headers.origin
    || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

async function resolveAccountId(pool, companyId) {
  const { rows } = await pool.query("SELECT account_id FROM app.companies WHERE id = $1", [companyId]);
  return rows[0]?.account_id || null;
}

// Shape a product for the buyer UI (money in major units; block sizing).
function publicProduct(p) {
  return {
    kind: p.kind, label: p.label, unit_label: p.unit_label,
    block_size: Number(p.block_size), display_per_block: Number(p.display_per_block),
    min_blocks: p.min_blocks,
    unit_amount_cents: p.unit_amount_cents, currency: p.currency,
    price_per_block: p.unit_amount_cents / 100,
    purchasable: !!process.env.STRIPE_SECRET_KEY,
  };
}

export function createAddonsRouter(pool) {
  const router = Router();

  // GET /api/addons/products - catalog (block size + per-block price).
  router.get("/products", authenticate, async (_req, res) => {
    try {
      const products = await listAddonProducts(pool);
      res.json(products.map(publicProduct));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/addons - the account's current balances + purchased buckets.
  router.get("/", authenticate, withCompany(pool), async (req, res) => {
    try {
      const accountId = await resolveAccountId(pool, req.companyId);
      if (!accountId) return res.status(404).json({ error: "Account not found" });
      const account = await getAccountBillingState(pool, accountId);
      const [aiBalance, emailQuota, buckets, products] = await Promise.all([
        getAddonBalance(pool, accountId, "ai_tokens"),
        getEmailQuota(pool, accountId),
        listAccountAddons(pool, accountId),
        listAddonProducts(pool),
      ]);
      res.json({
        can_purchase: canPurchaseAddons(account),
        plan_active: account ? (account.is_active && (account.plan_expires_at == null || new Date(account.plan_expires_at) > new Date())) : false,
        ai_tokens_balance: aiBalance,
        email_credits_balance: emailQuota.balance,
        email_used_month: emailQuota.used,
        email_base: emailQuota.base,
        email_limit: emailQuota.limit,
        buckets,
        products: products.map(publicProduct),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/addons/checkout - Stripe Checkout Session for whole blocks.
  //   body: { kind: 'ai_tokens'|'email_credits', blocks: >=min }
  // Paying subscribers only (plan_expires_at NULL). Add-ons freeze on lapse.
  router.post("/checkout", authenticate, withCompany(pool), async (req, res) => {
    try {
      const stripe = await getStripe();
      if (!stripe) return res.status(503).json({ error: "Add-on purchases are not configured yet." });

      const accountId = await resolveAccountId(pool, req.companyId);
      if (!accountId) return res.status(404).json({ error: "Account not found" });
      const account = await getAccountBillingState(pool, accountId);
      if (!canPurchaseAddons(account)) {
        return res.status(403).json({ error: "Add-ons are available to paying subscribers only. Upgrade your plan first." });
      }

      const { kind } = req.body;
      const product = await getAddonProduct(pool, kind);
      if (!product) return res.status(400).json({ error: "Unknown add-on" });
      const blocks = Math.max(product.min_blocks, Math.floor(Number(req.body.blocks) || 0));
      if (blocks < product.min_blocks) return res.status(400).json({ error: `Minimum ${product.min_blocks} block(s)` });

      const lineItem = product.stripe_price_id
        ? { price: product.stripe_price_id, quantity: blocks }
        : {
            price_data: {
              currency: product.currency,
              unit_amount: product.unit_amount_cents,
              product_data: { name: `${product.label} - ${Number(product.display_per_block).toLocaleString()} ${product.unit_label} per block` },
            },
            quantity: blocks,
          };
      lineItem.adjustable_quantity = { enabled: true, minimum: product.min_blocks, maximum: 1000 };

      const base = appBase(req);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [lineItem],
        client_reference_id: accountId,
        metadata: { account_id: accountId, kind, blocks: String(blocks), created_by: req.user?.id || "" },
        success_url: `${base}/settings?tab=billing&addon=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/settings?tab=billing&addon=cancel`,
      });
      res.json({ url: session.url });
    } catch (e) {
      console.error("addon checkout failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/addons/grant - platform-admin manual grant (support / comps).
  //   body: { account_id, kind, blocks }
  router.post("/grant", authenticate, requirePlatformAdmin(pool), async (req, res) => {
    try {
      const { account_id, kind, blocks } = req.body;
      if (!account_id || !kind) return res.status(400).json({ error: "account_id and kind are required" });
      const bucket = await grantAddon(pool, {
        accountId: account_id, kind, blocks: Number(blocks) || 1,
        source: "admin_grant", createdBy: req.user?.id || null,
      });
      res.json(bucket);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

// Raw-body Stripe webhook. Fulfils checkout.session.completed -> grantAddon.
// Mounted in server/index.js; relies on express.json's `verify` stashing rawBody.
export function stripeWebhookHandler(pool) {
  return async (req, res) => {
    const stripe = await getStripe();
    if (!stripe) return res.status(503).end();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = secret
        ? stripe.webhooks.constructEvent(req.rawBody || req.body, sig, secret)
        : (req.body); // no secret configured (dev) - trust the parsed body
    } catch (e) {
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const s = event.data.object;
        if (s.payment_status === "paid") {
          const accountId = s.metadata?.account_id || s.client_reference_id;
          const kind = s.metadata?.kind;
          // Buyer can adjust quantity at checkout, so trust the line item, not metadata.
          let blocks = Number(s.metadata?.blocks) || 0;
          try {
            const li = await stripe.checkout.sessions.listLineItems(s.id, { limit: 1 });
            if (li.data[0]?.quantity) blocks = li.data[0].quantity;
          } catch { /* fall back to metadata blocks */ }
          if (accountId && kind && blocks > 0) {
            await grantAddon(pool, {
              accountId, kind, blocks, source: "stripe",
              stripeSession: s.id, stripePaymentIntent: s.payment_intent || null,
              createdBy: s.metadata?.created_by || null,
            });
          }
        }
      }
    } catch (e) {
      console.error("stripe webhook fulfilment failed:", e.message);
      // Still 200 so Stripe doesn't hammer retries; the unique index makes a manual
      // replay safe if fulfilment needs to be re-run.
    }
    res.json({ received: true });
  };
}
