import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";

// OAuth env (read in createAuthRouter) - present so the router builds cleanly.
process.env.GOOGLE_CLIENT_ID = "test-google-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
process.env.JWT_SECRET = "test-jwt-secret";

// Capture every emailed code instead of sending. The auth routes call
// sendLoginCodeEmail(to, code, {purpose}); we record so tests can read the OTP.
const sentCodes = [];
vi.mock("../server/services/email.js", () => ({
  sendLoginCodeEmail: async (to, code, opts = {}) => { sentCodes.push({ to, code, purpose: opts.purpose || "login" }); return { id: "sim", simulated: false }; },
  sendPasswordResetEmail: async () => ({ id: "sim", simulated: false }),
  sendVerificationEmail: async () => ({ id: "sim", simulated: false }),
  sendVerificationCodeEmail: async () => ({ id: "sim", simulated: false }),
}));

const { createAuthRouter } = await import("../server/routes/auth.js");
const { createToken } = await import("../server/middleware/auth.js");

// ── In-memory fake Postgres tailored to the login + MFA SQL ───────────────────
function makeFakeDb() {
  const accounts = [];
  const users = [];
  const companies = [];
  const members = [];
  const challenges = [];
  let counter = 0;
  const id = (p) => `${p}-${++counter}`;

  // Seed a fully-provisioned account/user/company/member so login works.
  function seedUser({ email, password = null, mfa_enabled = false }) {
    const account = { id: id("account"), plan: "free" };
    accounts.push(account);
    const user = {
      id: id("user"), account_id: account.id, email: email.toLowerCase(),
      password_hash: password ? bcrypt.hashSync(password, 8) : null,
      full_name: "Test User", avatar_url: null, is_email_verified: true,
      is_active: true, is_platform_admin: false, mfa_enabled,
      created_date: "2026-06-26T00:00:00.000Z", last_login_at: null,
    };
    users.push(user);
    const company = { id: id("company"), account_id: account.id, name: "Co", slug: "co", plan: "free", logo_url: null };
    companies.push(company);
    members.push({ account_id: account.id, company_id: company.id, user_id: user.id, role: "admin", status: "active" });
    return user;
  }

  async function run(sql, params = []) {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") return { rows: [], rowCount: 0 };

    // Login lookup by email (u.* + companies)
    if (/^SELECT u\.\*/.test(s) && /LOWER\(u\.email\)/.test(s)) {
      const email = String(params[0]).toLowerCase();
      const u = users.find((x) => x.email === email && x.is_active !== false);
      if (!u) return { rows: [], rowCount: 0 };
      return { rows: [{ ...u, companies: companiesFor(u.id) }], rowCount: 1 };
    }
    // fetchUserWithCompanies by id (u.* + companies)
    if (/^SELECT u\.\*/.test(s) && /u\.id = \$1/.test(s)) {
      const u = users.find((x) => x.id === params[0] && x.is_active !== false);
      if (!u) return { rows: [], rowCount: 0 };
      return { rows: [{ ...u, companies: companiesFor(u.id) }], rowCount: 1 };
    }
    // setup: SELECT email, mfa_enabled
    if (/^SELECT email, mfa_enabled FROM app\.users/.test(s)) {
      const u = users.find((x) => x.id === params[0]);
      return { rows: u ? [{ email: u.email, mfa_enabled: u.mfa_enabled }] : [], rowCount: u ? 1 : 0 };
    }
    // disable: SELECT password_hash, mfa_enabled
    if (/^SELECT password_hash, mfa_enabled FROM app\.users/.test(s)) {
      const u = users.find((x) => x.id === params[0]);
      return { rows: u ? [{ password_hash: u.password_hash, mfa_enabled: u.mfa_enabled }] : [], rowCount: u ? 1 : 0 };
    }
    // authenticate password-change check (fail open path) - not seeded here
    if (/^SELECT password_changed_at FROM app\.users/.test(s)) {
      return { rows: [{ password_changed_at: null }], rowCount: 1 };
    }

    // INSERT challenge ... RETURNING id  (purpose is a SQL literal)
    if (/^INSERT INTO app\.mfa_challenges/.test(s)) {
      const purpose = /'enable'/.test(s) ? "enable" : "login";
      const ch = {
        id: id("ch"), user_id: params[0], purpose, code_hash: params[1],
        attempts: 0, expires_at: new Date(Date.now() + 10 * 60 * 1000), consumed_at: null,
      };
      challenges.push(ch);
      return { rows: [{ id: ch.id }], rowCount: 1 };
    }
    // SELECT * challenge by id (login verify)
    if (/^SELECT \* FROM app\.mfa_challenges WHERE id = \$1/.test(s)) {
      const ch = challenges.find((c) => c.id === params[0] && c.purpose === "login" && c.consumed_at == null);
      return { rows: ch ? [ch] : [], rowCount: ch ? 1 : 0 };
    }
    // SELECT * challenge by user+enable (enable verify)
    if (/^SELECT \* FROM app\.mfa_challenges WHERE user_id = \$1 AND purpose = 'enable'/.test(s)) {
      const ch = challenges.find((c) => c.user_id === params[0] && c.purpose === "enable" && c.consumed_at == null);
      return { rows: ch ? [ch] : [], rowCount: ch ? 1 : 0 };
    }
    // resend lookup (join users)
    if (/^SELECT c\.id, u\.email FROM app\.mfa_challenges c/.test(s)) {
      const ch = challenges.find((c) => c.id === params[0] && c.purpose === "login" && c.consumed_at == null);
      if (!ch) return { rows: [], rowCount: 0 };
      const u = users.find((x) => x.id === ch.user_id);
      return { rows: [{ id: ch.id, email: u.email }], rowCount: 1 };
    }
    if (/^UPDATE app\.mfa_challenges SET attempts = attempts \+ 1/.test(s)) {
      const ch = challenges.find((c) => c.id === params[0]); if (ch) ch.attempts += 1;
      return { rows: [], rowCount: ch ? 1 : 0 };
    }
    if (/^UPDATE app\.mfa_challenges SET consumed_at = NOW\(\)/.test(s)) {
      const ch = challenges.find((c) => c.id === params[0]); if (ch) ch.consumed_at = new Date();
      return { rows: [], rowCount: ch ? 1 : 0 };
    }
    if (/^UPDATE app\.mfa_challenges SET code_hash/.test(s)) {
      const ch = challenges.find((c) => c.id === params[1]);
      if (ch) { ch.code_hash = params[0]; ch.attempts = 0; ch.expires_at = new Date(Date.now() + 10 * 60 * 1000); }
      return { rows: [], rowCount: ch ? 1 : 0 };
    }
    if (/^DELETE FROM app\.mfa_challenges WHERE id = \$1/.test(s)) {
      const i = challenges.findIndex((c) => c.id === params[0]); if (i >= 0) challenges.splice(i, 1);
      return { rows: [], rowCount: i >= 0 ? 1 : 0 };
    }
    if (/^DELETE FROM app\.mfa_challenges WHERE user_id = \$1 AND purpose = 'enable'/.test(s)) {
      for (let i = challenges.length - 1; i >= 0; i--) if (challenges[i].user_id === params[0] && challenges[i].purpose === "enable") challenges.splice(i, 1);
      return { rows: [], rowCount: 0 };
    }
    if (/^DELETE FROM app\.mfa_challenges WHERE user_id = \$1/.test(s)) {
      for (let i = challenges.length - 1; i >= 0; i--) if (challenges[i].user_id === params[0]) challenges.splice(i, 1);
      return { rows: [], rowCount: 0 };
    }

    if (/^UPDATE app\.users SET mfa_enabled = true/.test(s)) {
      const u = users.find((x) => x.id === params[0]); if (u) u.mfa_enabled = true;
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    if (/^UPDATE app\.users SET mfa_enabled = false/.test(s)) {
      const u = users.find((x) => x.id === params[0]); if (u) u.mfa_enabled = false;
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    if (/^UPDATE app\.users SET last_login_at/.test(s)) return { rows: [], rowCount: 1 };
    if (/^INSERT INTO app\.audit_log/.test(s)) return { rows: [], rowCount: 1 };

    return { rows: [], rowCount: 0 };
  }

  function companiesFor(userId) {
    return members.filter((m) => m.user_id === userId && m.status === "active").map((m) => {
      const c = companies.find((c) => c.id === m.company_id);
      return { id: c.id, name: c.name, slug: c.slug, plan: c.plan, logo_url: c.logo_url, role: m.role };
    });
  }

  const pool = { query: run, connect: async () => ({ query: run, release: () => {} }) };
  return { pool, seedUser, store: { users, challenges } };
}

let server, baseUrl, db;
let ipSeq = 0;

function post(path, body, { token } = {}) {
  const headers = { "Content-Type": "application/json", "X-Forwarded-For": `10.1.0.${++ipSeq}` };
  if (token) headers.Cookie = `cdp_token=${token}`;
  return fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body || {}) });
}

beforeAll(() => {});
afterAll(() => { if (server) server.close(); });

beforeEach(async () => {
  sentCodes.length = 0;
  db = makeFakeDb();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set("trust proxy", true);
  app.use("/api/auth", createAuthRouter(db.pool));
  if (server) server.close();
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

const lastCode = (purpose = "login") => [...sentCodes].reverse().find((c) => c.purpose === purpose)?.code;

describe("MFA login challenge", () => {
  it("a non-MFA user logs in directly (no challenge, gets a session)", async () => {
    db.seedUser({ email: "plain@acme.com", password: "password12", mfa_enabled: false });
    const res = await post("/api/auth/login", { email: "plain@acme.com", password: "password12" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mfa_required).toBeFalsy();
    expect(body.user.email).toBe("plain@acme.com");
    expect(res.headers.get("set-cookie")).toMatch(/cdp_token=/);
    expect(sentCodes).toHaveLength(0);
  });

  it("an MFA user gets a challenge (no session yet) then completes it with the emailed code", async () => {
    db.seedUser({ email: "mfa@acme.com", password: "password12", mfa_enabled: true });

    const step1 = await post("/api/auth/login", { email: "mfa@acme.com", password: "password12" });
    expect(step1.status).toBe(200);
    const c1 = await step1.json();
    expect(c1.mfa_required).toBe(true);
    expect(c1.challenge_id).toBeTruthy();
    // First factor must NOT issue a session.
    expect(step1.headers.get("set-cookie")).toBeFalsy();
    expect(c1.user).toBeUndefined();
    expect(sentCodes.at(-1)).toMatchObject({ to: "mfa@acme.com", purpose: "login" });

    const step2 = await post("/api/auth/login/mfa", { challenge_id: c1.challenge_id, code: lastCode() });
    expect(step2.status).toBe(200);
    const body = await step2.json();
    expect(body.user.email).toBe("mfa@acme.com");
    expect(body.user.password_hash).toBeUndefined();
    expect(step2.headers.get("set-cookie")).toMatch(/cdp_token=/);
  });

  it("a wrong code is rejected and counts down attempts; the right code still works", async () => {
    db.seedUser({ email: "x@acme.com", password: "password12", mfa_enabled: true });
    const { challenge_id } = await (await post("/api/auth/login", { email: "x@acme.com", password: "password12" })).json();

    const bad = await post("/api/auth/login/mfa", { challenge_id, code: "000001" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("invalid_code");

    const good = await post("/api/auth/login/mfa", { challenge_id, code: lastCode() });
    expect(good.status).toBe(200);
  });

  it("a consumed challenge cannot be reused", async () => {
    db.seedUser({ email: "once@acme.com", password: "password12", mfa_enabled: true });
    const { challenge_id } = await (await post("/api/auth/login", { email: "once@acme.com", password: "password12" })).json();
    const code = lastCode();

    expect((await post("/api/auth/login/mfa", { challenge_id, code })).status).toBe(200);
    const replay = await post("/api/auth/login/mfa", { challenge_id, code });
    expect(replay.status).toBe(400);
    expect((await replay.json()).code).toBe("invalid_challenge");
  });

  it("5 wrong codes burns the challenge (429), forcing a fresh sign-in", async () => {
    db.seedUser({ email: "brute@acme.com", password: "password12", mfa_enabled: true });
    const { challenge_id } = await (await post("/api/auth/login", { email: "brute@acme.com", password: "password12" })).json();
    for (let i = 0; i < 5; i++) await post("/api/auth/login/mfa", { challenge_id, code: "111111" });
    const sixth = await post("/api/auth/login/mfa", { challenge_id, code: "111111" });
    expect(sixth.status).toBe(429);
    // Even the correct code no longer works - the challenge was deleted.
    const after = await post("/api/auth/login/mfa", { challenge_id, code: lastCode() });
    expect(after.status).toBe(400);
  });

  it("resend issues a new code; the old code stops working", async () => {
    db.seedUser({ email: "re@acme.com", password: "password12", mfa_enabled: true });
    const { challenge_id } = await (await post("/api/auth/login", { email: "re@acme.com", password: "password12" })).json();
    const oldCode = lastCode();
    const r = await post("/api/auth/login/mfa/resend", { challenge_id });
    expect(r.status).toBe(200);
    const newCode = lastCode();
    expect(newCode).not.toBe(oldCode);
    expect((await post("/api/auth/login/mfa", { challenge_id, code: oldCode })).status).toBe(400);
    expect((await post("/api/auth/login/mfa", { challenge_id, code: newCode })).status).toBe(200);
  });

  it("a wrong password never reaches the MFA step", async () => {
    db.seedUser({ email: "wp@acme.com", password: "password12", mfa_enabled: true });
    const res = await post("/api/auth/login", { email: "wp@acme.com", password: "WRONG-pass-99" });
    expect(res.status).toBe(401);
    expect(sentCodes).toHaveLength(0);
  });
});

describe("MFA enable / disable (Settings)", () => {
  it("enable requires confirming an emailed code, then login starts challenging", async () => {
    const u = db.seedUser({ email: "enable@acme.com", password: "password12", mfa_enabled: false });
    const token = createToken({ id: u.id, email: u.email });

    const setup = await post("/api/auth/mfa/setup", {}, { token });
    expect(setup.status).toBe(200);
    expect(sentCodes.at(-1)).toMatchObject({ to: "enable@acme.com", purpose: "enable" });

    const enable = await post("/api/auth/mfa/enable", { code: lastCode("enable") }, { token });
    expect(enable.status).toBe(200);
    expect((await enable.json()).mfa_enabled).toBe(true);
    expect(db.store.users.find((x) => x.id === u.id).mfa_enabled).toBe(true);

    // Now a fresh login must challenge.
    const login = await post("/api/auth/login", { email: "enable@acme.com", password: "password12" });
    expect((await login.json()).mfa_required).toBe(true);
  });

  it("enable rejects a wrong confirmation code", async () => {
    const u = db.seedUser({ email: "en2@acme.com", password: "password12", mfa_enabled: false });
    const token = createToken({ id: u.id, email: u.email });
    await post("/api/auth/mfa/setup", {}, { token });
    const res = await post("/api/auth/mfa/enable", { code: "000000" }, { token });
    expect([400, 429]).toContain(res.status);
    expect(db.store.users.find((x) => x.id === u.id).mfa_enabled).toBe(false);
  });

  it("disable requires the current password when one is set", async () => {
    const u = db.seedUser({ email: "dis@acme.com", password: "password12", mfa_enabled: true });
    const token = createToken({ id: u.id, email: u.email });

    const noPw = await post("/api/auth/mfa/disable", {}, { token });
    expect(noPw.status).toBe(400);
    expect((await noPw.json()).code).toBe("password_required");

    const wrongPw = await post("/api/auth/mfa/disable", { password: "nope" }, { token });
    expect(wrongPw.status).toBe(401);

    const ok = await post("/api/auth/mfa/disable", { password: "password12" }, { token });
    expect(ok.status).toBe(200);
    expect(db.store.users.find((x) => x.id === u.id).mfa_enabled).toBe(false);
  });

  it("OAuth-only account (no password) can disable without a password", async () => {
    const u = db.seedUser({ email: "oauth@acme.com", password: null, mfa_enabled: true });
    const token = createToken({ id: u.id, email: u.email });
    const ok = await post("/api/auth/mfa/disable", {}, { token });
    expect(ok.status).toBe(200);
    expect(db.store.users.find((x) => x.id === u.id).mfa_enabled).toBe(false);
  });

  it("MFA management endpoints require authentication", async () => {
    const res = await post("/api/auth/mfa/setup", {});
    expect(res.status).toBe(401);
  });
});

describe("OAuth provider env-name fallback", () => {
  it("configures Microsoft from AUTH_AZURE_AD_* names when MICROSOFT_* is unset", async () => {
    // Build a router in an isolated env where only the NextAuth-style names exist.
    const saved = { ...process.env };
    delete process.env.MICROSOFT_CLIENT_ID; delete process.env.MICROSOFT_CLIENT_SECRET;
    process.env.AUTH_AZURE_AD_CLIENT_ID = "azure-app-id";
    process.env.AUTH_AZURE_AD_CLIENT_SECRET = "azure-secret";
    process.env.AUTH_AZURE_AD_TENANT_ID = "tenant-123";

    const app = express();
    app.use(express.json()); app.use(cookieParser()); app.set("trust proxy", true);
    app.use("/api/auth", createAuthRouter(db.pool));
    const s = http.createServer(app);
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${s.address().port}`;

    const status = await (await fetch(`${url}/api/auth/microsoft/status`)).json();
    expect(status.configured).toBe(true);

    const redirect = await fetch(`${url}/api/auth/microsoft`, { redirect: "manual" });
    const loc = redirect.headers.get("location");
    expect(loc).toContain("login.microsoftonline.com/tenant-123/");
    expect(loc).toContain("azure-app-id");

    s.close();
    process.env = saved;
  });
});
