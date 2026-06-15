import { describe, it, expect, beforeAll } from "vitest";

// Deterministic 32-byte (64 hex) test key. Set before importing the lib, since
// the key is read lazily on first use and then cached.
beforeAll(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const { encrypt, decrypt, isEncrypted } = await import("../server/lib/encryption.js");
const { encryptConfig, decryptConfig, redactConfig } = await import("../server/lib/configCrypto.js");

// Obviously-fake fixture token (do not use real credentials in tests).
const TOKEN = "test_token_0000000000000000000000";

describe("encryption - core encrypt/decrypt", () => {
  it("encrypt() produces an enc:v1: prefixed value", () => {
    expect(encrypt(TOKEN).startsWith("enc:v1:")).toBe(true);
  });

  it("round-trips: decrypt(encrypt(x)) === x", () => {
    expect(decrypt(encrypt(TOKEN))).toBe(TOKEN);
  });

  it("uses a random IV (two encryptions differ but both decrypt)", () => {
    const a = encrypt(TOKEN);
    const b = encrypt(TOKEN);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(TOKEN);
    expect(decrypt(b)).toBe(TOKEN);
  });
});

describe("encryption - idempotency & passthrough", () => {
  it("encrypt(alreadyEncrypted) does not double-encrypt", () => {
    const once = encrypt(TOKEN);
    expect(encrypt(once)).toBe(once);
  });

  it("decrypt(plaintext) passes through unchanged (legacy values)", () => {
    expect(decrypt(TOKEN)).toBe(TOKEN);
  });

  it("isEncrypted reflects the prefix", () => {
    expect(isEncrypted(encrypt(TOKEN))).toBe(true);
    expect(isEncrypted(TOKEN)).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it("null/empty pass through", () => {
    expect(encrypt(null)).toBe(null);
    expect(encrypt("")).toBe("");
    expect(decrypt(null)).toBe(null);
  });
});

describe("encryption - tamper detection (GCM auth tag)", () => {
  it("throws on a corrupted ciphertext", () => {
    const tampered = encrypt(TOKEN).slice(0, -4) + "dead";
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on a structurally invalid encrypted value", () => {
    const bad = "enc:v1:" + "a".repeat(24) + ":" + "b".repeat(32) + ":" + "c".repeat(32);
    expect(() => decrypt(bad)).toThrow();
  });
});

describe("configCrypto - encrypt/decrypt/redact", () => {
  it("encrypts only sensitive fields, leaving others intact", () => {
    const enc = encryptConfig("shopify", { storeName: "cdp-teststore", accessToken: TOKEN });
    expect(enc.storeName).toBe("cdp-teststore");
    expect(isEncrypted(enc.accessToken)).toBe(true);
  });

  it("decryptConfig restores the original config", () => {
    const enc = encryptConfig("shopify", { storeName: "cdp-teststore", accessToken: TOKEN });
    const dec = decryptConfig("shopify", enc);
    expect(dec.accessToken).toBe(TOKEN);
    expect(dec.storeName).toBe("cdp-teststore");
  });

  it("encryptConfig is idempotent on an already-encrypted config", () => {
    const enc = encryptConfig("shopify", { storeName: "s", accessToken: TOKEN });
    expect(encryptConfig("shopify", enc).accessToken).toBe(enc.accessToken);
  });

  it("types without sensitive fields pass through unchanged", () => {
    const cfg = { propertyId: "123", propertyName: "https://example.com" };
    expect(encryptConfig("googleAnalytics", cfg)).toEqual(cfg);
  });

  it("redactConfig masks sensitive fields for API responses", () => {
    const enc = encryptConfig("shopify", { storeName: "cdp-teststore", accessToken: TOKEN });
    const redacted = redactConfig("shopify", enc);
    expect(redacted.accessToken).toBe("••••••••");
    expect(redacted.storeName).toBe("cdp-teststore");
  });

  it("redacts legacy plaintext sensitive fields too", () => {
    const redacted = redactConfig("shopify", { storeName: "mystore", accessToken: TOKEN });
    expect(redacted.accessToken).toBe("••••••••");
  });
});
