// Central AI-usage recorder. Every LLM call funnels through recordAiUsage so
// token spend and cost are attributed per user / per workspace / per account.
//
// It writes TWO rows:
//   • app.ai_usage     - the cost ledger (tokens + frozen $ cost, account-scoped)
//   • app.usage_events - the existing ai_token QUOTA counter (company-scoped),
//                        so plan-limit checks and the old usage queries keep working.
//
// Cost is frozen at insert time from app.ai_model_pricing (rates cached in-process;
// call clearPricingCache() after an admin edits a rate).

const _priceCache = new Map(); // model -> { input_per_1m, output_per_1m, currency }

export function clearPricingCache() {
  _priceCache.clear();
}

async function getPricing(pool, model) {
  if (_priceCache.has(model)) return _priceCache.get(model);
  let price = { input_per_1m: 0, output_per_1m: 0, currency: "USD" };
  try {
    const { rows } = await pool.query(
      "SELECT input_per_1m, output_per_1m, currency FROM app.ai_model_pricing WHERE model = $1",
      [model]
    );
    if (rows[0]) price = rows[0];
  } catch { /* pricing table may not exist yet - cost stays 0 */ }
  _priceCache.set(model, price);
  return price;
}

/**
 * Record one AI call. Never throws - usage tracking must not break the feature.
 * @param {import('pg').Pool} pool
 * @param {object} ctx
 * @param {string}  ctx.model         model/deployment name (matches ai_model_pricing.model)
 * @param {string}  ctx.feature       analyst | chart_summary | llm | attribute_tag | attribute_group | attribute_suggest
 * @param {number} [ctx.inputTokens]  prompt tokens
 * @param {number} [ctx.outputTokens] completion tokens
 * @param {string} [ctx.companyId]    active workspace (resolves the account)
 * @param {string} [ctx.accountId]    account (resolved from companyId when omitted)
 * @param {string} [ctx.userId]       acting user, when known
 * @param {object} [ctx.metadata]     extra context stored on the row
 */
export async function recordAiUsage(pool, ctx = {}) {
  if (!pool) return;
  try {
    const input  = Math.max(0, Math.round(Number(ctx.inputTokens)  || 0));
    const output = Math.max(0, Math.round(Number(ctx.outputTokens) || 0));
    const total  = input + output;
    if (total === 0) return;

    const { companyId = null, userId = null, feature = "unknown", model = "unknown", metadata = {} } = ctx;

    // Cost ledger is account-scoped; resolve the account from the workspace.
    let accountId = ctx.accountId || null;
    if (!accountId && companyId) {
      const { rows } = await pool.query("SELECT account_id FROM app.companies WHERE id = $1", [companyId]);
      accountId = rows[0]?.account_id || null;
    }

    if (accountId) {
      const price = await getPricing(pool, model);
      const cost =
        (input  / 1_000_000) * Number(price.input_per_1m || 0) +
        (output / 1_000_000) * Number(price.output_per_1m || 0);
      await pool.query(
        `INSERT INTO app.ai_usage
           (account_id, company_id, user_id, feature, model,
            input_tokens, output_tokens, total_tokens, cost, currency, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [accountId, companyId, userId, feature, model,
         input, output, total, cost, price.currency || "USD", JSON.stringify(metadata)]
      );
    }

    // Quota counter (company-scoped; NOT NULL company_id). Skipped for callers
    // with no workspace context (e.g. the unauthenticated /integrations/llm).
    if (companyId) {
      await pool.query(
        `INSERT INTO app.usage_events (company_id, user_id, event_type, quantity, metadata)
         VALUES ($1, $2, 'ai_token', $3, $4)`,
        [companyId, userId, total, JSON.stringify({ feature, model })]
      );
    }
  } catch (err) {
    console.error("recordAiUsage failed:", err.message);
  }
}
