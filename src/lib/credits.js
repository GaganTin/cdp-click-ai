// AI usage is metered and stored in the backend/DB as raw GPT tokens, but those
// numbers are large and unfriendly (a 10,000,000-token allowance "looks like a
// lot"). Everywhere in the UI we present them as "credits" instead, at a fixed
// rate of 100,000 tokens = 1 credit (so 10M => 100 credits, 30M => 300).
// Backend/DB values are always raw tokens; convert at the UI boundary only.
export const TOKENS_PER_CREDIT = 100_000;

// Raw tokens -> display credits (rounded).
export const toCredits = (tokens) => Math.round(Number(tokens || 0) / TOKENS_PER_CREDIT);

// Display credits -> raw tokens (for values entered in credit-denominated inputs).
export const toTokens = (credits) => Math.round(Number(credits || 0) * TOKENS_PER_CREDIT);

// Format raw tokens as a credits string. Small amounts (a single AI response is
// a fraction of a credit) keep 2 decimals so they don't collapse to "0"; larger
// totals are rounded and grouped. Use for fine-grained, per-message meters.
export const fmtCredits = (tokens) => {
  const c = Number(tokens || 0) / TOKENS_PER_CREDIT;
  return c > 0 && c < 100 ? c.toFixed(2) : Math.round(c).toLocaleString();
};
