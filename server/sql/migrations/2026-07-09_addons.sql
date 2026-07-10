-- ============================================================================
-- 2026-07-09_addons.sql
-- Prepaid ADD-ONS for AI tokens and email credits.
--
-- Model (see also server/lib/addons.js):
--   • account_addons  - one row per purchased bucket. `remaining` is drawn down as
--                       the account's base plan allowance is exceeded; NEVER resets.
--                       Buckets are usable ONLY while the plan is active
--                       (is_active AND plan_expires_at IS NULL OR > now); they freeze
--                       when the plan lapses and are hard-deleted by the existing
--                       6-month purge (server/lib/billingLifecycle.js).
--   • addon_ledger    - append-only record of every draw-down, so the period-scoped
--                       "already deducted this period" figure is exact and the whole
--                       thing is auditable / self-healing.
--   • addon_products  - catalog: block size + per-block Stripe price. Purchases are
--                       whole blocks (min 1), so every quantity is a valid multiple:
--                         AI    1 block = 5,000,000 tokens (= 50 credits)
--                         Email 1 block = 10,000 emails
--
-- ai_tokens buckets fold into app.ai_quota (below). email_credits buckets are
-- enforced in server/routes/edm.js at SEND time against monthly emails-sent.
--
-- Idempotent. Run with: psql "$DATABASE_URL" -f <file>
-- ============================================================================

BEGIN;

-- ── Purchased prepaid buckets ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.account_addons (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID        NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  kind         TEXT        NOT NULL CHECK (kind IN ('ai_tokens','email_credits')),
  quantity     BIGINT      NOT NULL CHECK (quantity > 0),   -- raw tokens, or emails
  remaining    BIGINT      NOT NULL CHECK (remaining >= 0), -- current balance
  blocks       INTEGER,                                     -- blocks purchased (audit)
  status       TEXT        NOT NULL DEFAULT 'active',       -- active | exhausted | refunded
  source       TEXT        NOT NULL DEFAULT 'stripe',       -- stripe | admin_grant
  stripe_checkout_session TEXT,
  stripe_payment_intent   TEXT,
  created_by   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS account_addons_acct_kind_idx
  ON app.account_addons(account_id, kind, status, created_date);
-- Stripe checkout sessions are single-use; the unique index makes webhook
-- fulfilment idempotent (a redelivered event can't double-grant).
CREATE UNIQUE INDEX IF NOT EXISTS account_addons_checkout_uniq
  ON app.account_addons(stripe_checkout_session)
  WHERE stripe_checkout_session IS NOT NULL;

DROP TRIGGER IF EXISTS account_addons_updated_date ON app.account_addons;
CREATE TRIGGER account_addons_updated_date BEFORE UPDATE ON app.account_addons
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_date();

-- ── Draw-down ledger (period reconciliation + audit) ────────────────────────
CREATE TABLE IF NOT EXISTS app.addon_ledger (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID        NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL,
  amount      BIGINT      NOT NULL,   -- units drawn from buckets in this event
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata    JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS addon_ledger_acct_kind_idx
  ON app.addon_ledger(account_id, kind, occurred_at DESC);

-- ── Product catalog (block size + Stripe price; editable in Studio) ─────────
CREATE TABLE IF NOT EXISTS app.addon_products (
  kind              TEXT        PRIMARY KEY,        -- ai_tokens | email_credits
  label             TEXT        NOT NULL,
  unit_label        TEXT        NOT NULL,           -- 'credits' | 'emails'
  block_size        BIGINT      NOT NULL,           -- raw units granted per block
  display_per_block BIGINT      NOT NULL,           -- units shown to the buyer per block
  min_blocks        INTEGER     NOT NULL DEFAULT 1,
  unit_amount_cents INTEGER     NOT NULL DEFAULT 0, -- price per block (minor units)
  currency          TEXT        NOT NULL DEFAULT 'usd',
  stripe_price_id   TEXT,                            -- set once the Stripe price exists
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  updated_date      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the two products. unit_amount_cents are PLACEHOLDERS - set real per-block
-- prices (and stripe_price_id) before enabling checkout.
INSERT INTO app.addon_products
  (kind, label, unit_label, block_size, display_per_block, min_blocks, unit_amount_cents, currency, stripe_price_id, is_active)
VALUES
  ('ai_tokens',     'AI credits',    'credits', 5000000, 50,    1, 2500, 'usd', NULL, true),
  ('email_credits', 'Email credits', 'emails',  10000,   10000, 1, 1000, 'usd', NULL, true)
ON CONFLICT (kind) DO UPDATE SET
  label=EXCLUDED.label, unit_label=EXCLUDED.unit_label, block_size=EXCLUDED.block_size,
  display_per_block=EXCLUDED.display_per_block, min_blocks=EXCLUDED.min_blocks;
  -- NB: price / stripe_price_id / is_active are intentionally NOT overwritten on
  -- re-run, so a live-tuned price survives a schema re-apply.

-- ── Active prepaid balance for an account+kind (0 when the plan is lapsed) ───
CREATE OR REPLACE FUNCTION app.addon_balance(p_account_id UUID, p_kind TEXT)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(ad.remaining), 0)::BIGINT
    FROM app.account_addons ad
    JOIN app.accounts a ON a.id = ad.account_id
   WHERE ad.account_id = p_account_id
     AND ad.kind       = p_kind
     AND ad.status     = 'active'
     AND ad.remaining  > 0
     -- Frozen when the plan is not active: not counted toward available balance.
     AND a.is_active = true
     AND (a.plan_expires_at IS NULL OR a.plan_expires_at > now());
$$;

-- ── ai_quota v4: base plan/override + active ai_tokens add-on balance ────────
-- token_limit now reports base + add-on balance, so the whole app (enforcement,
-- banners, usage bars) automatically accounts for purchased AI credits. is_over
-- only trips once BOTH the period base and the prepaid buckets are exhausted.
-- Draw-down of the buckets happens in server/lib/addons.js after each AI call.
DROP FUNCTION IF EXISTS app.ai_quota(UUID);
CREATE OR REPLACE FUNCTION app.ai_quota(p_account_id UUID)
RETURNS TABLE(used BIGINT, token_limit BIGINT, is_over BOOLEAN,
              period_start TIMESTAMPTZ, period_end TIMESTAMPTZ, is_trial BOOLEAN)
LANGUAGE sql STABLE AS $$
  WITH acct AS (
    SELECT a.created_date,
           a.plan_expires_at,
           a.plan_upgraded_at,
           COALESCE(
             NULLIF(a.settings->'limit_overrides'->>'ai_tokens', '')::BIGINT,
             NULLIF(p.limits->>'ai_tokens', '')::BIGINT
           ) AS base_limit,
           app.addon_balance(a.id, 'ai_tokens') AS addon_balance
      FROM app.accounts a
      JOIN app.plans    p ON p.id = a.plan
     WHERE a.id = p_account_id
  ),
  win AS (
    SELECT
      (acct.plan_expires_at IS NOT NULL) AS is_trial,
      acct.plan_expires_at,
      CASE
        WHEN acct.plan_expires_at IS NOT NULL
          THEN acct.created_date
        ELSE
          COALESCE(acct.plan_upgraded_at, acct.created_date)
          + make_interval(months =>
              (EXTRACT(YEAR  FROM age(now(), COALESCE(acct.plan_upgraded_at, acct.created_date)))::INT * 12
             + EXTRACT(MONTH FROM age(now(), COALESCE(acct.plan_upgraded_at, acct.created_date)))::INT))
      END AS period_start
      FROM acct
  ),
  win2 AS (
    SELECT is_trial, period_start,
           CASE WHEN is_trial THEN plan_expires_at
                ELSE period_start + INTERVAL '1 month' END AS period_end
      FROM win
  ),
  u AS (
    SELECT COALESCE(SUM(total_tokens), 0)::BIGINT AS used
      FROM app.ai_usage, win2
     WHERE account_id  = p_account_id
       AND occurred_at >= win2.period_start
  )
  SELECT u.used,
         -- NULL base = unlimited; otherwise base + prepaid balance.
         CASE WHEN acct.base_limit IS NULL THEN NULL
              ELSE acct.base_limit + acct.addon_balance END AS token_limit,
         (acct.base_limit IS NOT NULL
            AND u.used >= acct.base_limit + acct.addon_balance) AS is_over,
         win2.period_start,
         win2.period_end,
         win2.is_trial
    FROM u CROSS JOIN acct CROSS JOIN win2;
$$;

COMMENT ON FUNCTION app.ai_quota(UUID) IS
  'Per-account AI token quota over the current BILLING PERIOD, base plan/override limit PLUS active prepaid ai_tokens add-on balance. Returns (used, token_limit, is_over, period_start, period_end, is_trial). NULL limit = unlimited.';

COMMIT;
