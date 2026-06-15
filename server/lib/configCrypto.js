import { encrypt, decrypt, isEncrypted } from "./encryption.js";

// Fields that must be encrypted at rest, keyed by integration_type.
// Add new sensitive fields here as integrations expand.
const SENSITIVE_FIELDS = {
  shopify:          ["accessToken"],
  shopifyCustomApp: ["accessToken"],
};

/**
 * encryptConfig- call before INSERT/UPDATE to the DB.
 * Encrypts only the fields listed in SENSITIVE_FIELDS.
 * Idempotent: already-encrypted values are left unchanged.
 */
export function encryptConfig(integrationType, config) {
  const fields = SENSITIVE_FIELDS[integrationType];
  if (!fields?.length || !config) return config;
  const out = { ...config };
  for (const field of fields) {
    if (out[field] && !isEncrypted(out[field])) {
      out[field] = encrypt(out[field]);
    }
  }
  return out;
}

/**
 * decryptConfig- call when you need the real value server-side
 * (connection testing, sync DAG triggers, disconnect cleanup).
 * Backward-compatible: plaintext values pass through unchanged.
 */
export function decryptConfig(integrationType, config) {
  const fields = SENSITIVE_FIELDS[integrationType];
  if (!fields?.length || !config) return config;
  const out = { ...config };
  for (const field of fields) {
    if (out[field]) out[field] = decrypt(out[field]); // no-op if not encrypted
  }
  return out;
}

/**
 * redactConfig- call before sending config to the API client.
 * Replaces sensitive field values with a fixed mask.
 * The client only needs to know "a value exists"- it never needs the token.
 */
export function redactConfig(integrationType, config) {
  const fields = SENSITIVE_FIELDS[integrationType];
  if (!fields?.length || !config) return config;
  const out = { ...config };
  for (const field of fields) {
    if (out[field]) out[field] = "••••••••";
  }
  return out;
}
