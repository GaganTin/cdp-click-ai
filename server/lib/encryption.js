import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM  = "aes-256-gcm";
const IV_BYTES    = 12;   // 96-bit IV- recommended for GCM
const TAG_BYTES   = 16;   // 128-bit auth tag
const ENCODING    = "hex";
const PREFIX      = "enc:v1:"; // version prefix so we can detect and migrate later

// ── Key derivation ─────────────────────────────────────────────────────────────
// Accepts either:
//   - A 64-char hex string (raw 32-byte key)  → used directly
//   - Any other string (passphrase)            → derived with scrypt
function deriveKey(raw) {
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not set in environment.");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return scryptSync(raw, "capsuite-cdp-v1", 32);
}

let _cachedKey = null;
function getKey() {
  if (!_cachedKey) _cachedKey = deriveKey(process.env.INTEGRATION_ENCRYPTION_KEY);
  return _cachedKey;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Encrypts a plaintext string.
 * Returns a self-contained string: enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * Each call produces a different ciphertext (random IV)- safe to store as-is.
 */
export function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // already encrypted, idempotent

  const key    = getKey();
  const iv     = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const body    = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString(ENCODING)}:${authTag.toString(ENCODING)}:${body.toString(ENCODING)}`;
}

/**
 * Decrypts a value produced by encrypt().
 * If the value is not prefixed with enc:v1: it is returned unchanged
 * (backward-compatible with any legacy plaintext values still in the DB).
 */
export function decrypt(value) {
  if (!value || !isEncrypted(value)) return value; // plaintext passthrough

  const key   = getKey();
  const inner = value.slice(PREFIX.length);
  const parts = inner.split(":");

  if (parts.length !== 3) throw new Error(`Malformed encrypted value (expected 3 parts, got ${parts.length})`);

  const [ivHex, tagHex, bodyHex] = parts;
  const iv      = Buffer.from(ivHex, ENCODING);
  const authTag = Buffer.from(tagHex, ENCODING);
  const body    = Buffer.from(bodyHex, ENCODING);

  if (iv.length !== IV_BYTES) throw new Error("Invalid IV length in encrypted value");
  if (authTag.length !== TAG_BYTES) throw new Error("Invalid auth tag length");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
