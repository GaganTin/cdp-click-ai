import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

// OAuth credentials must exist before the router reads them in createAuthRouter()
process.env.GOOGLE_CLIENT_ID = "test-google-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
process.env.MICROSOFT_CLIENT_ID = "test-ms-id";
process.env.MICROSOFT_CLIENT_SECRET = "test-ms-secret";
process.env.FRONTEND_URL = "http://frontend.test";

const { createAuthRouter } = await import("../server/routes/auth.js");

const GOOGLE_EMAIL = "googleuser@example.com";
const MS_EMAIL = "msuser@example.com";

// ── In-memory fake of the Postgres pool ────────────────────────────────────────
// Pattern-matches the handful of SQL statements the auth routes issue and keeps a
// consistent store so register → login round-trips work. Records every query so
// tests can assert which tables each flow wrote to.
function makeFakeDb() {
  const accounts = [];
  const users = [];
  const companies = [];
  const members = [];
  const prefs = [];
  const audit = [];
  const queries = [];
  let counter = 0;
  const id = (p) => `${p}-${++counter}`;

  async function run(sql, params = []) {
    queries.push({ sql, params });
    const s = sql.replace(/\s+/g, " ").trim();

    if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") return { rows: [], rowCount: 0 };

    // Login lookup (join with companies) - check before the simple users SELECT
    if (/^SELECT u\.\*/.test(s) || (/FROM app\.users u/.test(s) && /json_agg/.test(s))) {
      const email = String(params[0]).toLowerCase();
      const u = users.find((x) => x.email === email && x.is_active !== false);
      if (!u) return { rows: [], rowCount: 0 };
      const cos = members
        .filter((m) => m.user_id === u.id && m.status === "active")
        .map((m) => {
          const c = companies.find((c) => c.id === m.company_id);
          return { id: c.id, name: c.name, slug: c.slug, plan: c.plan, logo_url: c.logo_url, role: m.role };
        });
      return { rows: [{ ...u, companies: cos }], rowCount: 1 };
    }

    // Existing-user existence check
    if (/^SELECT id FROM app\.users WHERE LOWER\(email\)/.test(s)) {
      const email = String(params[0]).toLowerCase();
      const u = users.find((x) => x.email === email);
      return { rows: u ? [{ id: u.id }] : [], rowCount: u ? 1 : 0 };
    }

    // uniqueSlug probe (accounts)
    if (/^SELECT id FROM app\.accounts WHERE LOWER\(slug\)/.test(s)) {
      const slug = String(params[0]).toLowerCase();
      const a = accounts.find((a) => a.slug.toLowerCase() === slug);
      return { rows: a ? [{ id: a.id }] : [], rowCount: a ? 1 : 0 };
    }

    // uniqueSlug probe (companies)
    if (/^SELECT id FROM app\.companies WHERE LOWER\(slug\)/.test(s)) {
      const slug = String(params[0]).toLowerCase();
      const c = companies.find((c) => c.slug.toLowerCase() === slug);
      return { rows: c ? [{ id: c.id }] : [], rowCount: c ? 1 : 0 };
    }

    // uniqueCapsuiteRef probe (globally unique - empty means available)
    if (/^SELECT 1 FROM app\.companies WHERE capsuite_ref/.test(s)) {
      const c = companies.find((c) => c.capsuite_ref === params[0]);
      return { rows: c ? [{ "?column?": 1 }] : [], rowCount: c ? 1 : 0 };
    }

    // INSERT account (returns id + plan + trial state)
    if (/^INSERT INTO app\.accounts/.test(s)) {
      const [name, slug] = params;
      const plan_expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const a = { id: id("account"), name, slug, plan: "lite", plan_expires_at, plan_upgraded_at: null, owner_user_id: null };
      accounts.push(a);
      return { rows: [{ id: a.id, plan: a.plan, plan_expires_at: a.plan_expires_at, plan_upgraded_at: a.plan_upgraded_at }], rowCount: 1 };
    }

    // INSERT user (account-scoped: account_id is the first column)
    if (/^INSERT INTO app\.users/.test(s) && /RETURNING/.test(s)) {
      const [account_id, email, password_hash, full_name, avatar_url, is_email_verified] = params;
      const u = {
        id: id("user"),
        account_id,
        email: String(email).toLowerCase(),
        password_hash: password_hash ?? null,
        full_name,
        avatar_url: avatar_url ?? null,
        is_email_verified: !!is_email_verified,
        is_active: true,
        created_date: "2026-06-03T00:00:00.000Z",
        last_login_at: null,
      };
      users.push(u);
      return {
        rows: [{
          id: u.id, email: u.email, full_name: u.full_name, avatar_url: u.avatar_url,
          is_email_verified: u.is_email_verified, created_date: u.created_date,
        }],
        rowCount: 1,
      };
    }

    // First user becomes the account owner
    if (/^UPDATE app\.accounts SET owner_user_id/.test(s)) {
      const [userId, accountId] = params;
      const a = accounts.find((a) => a.id === accountId);
      if (a) a.owner_user_id = userId;
      return { rows: [], rowCount: a ? 1 : 0 };
    }

    // No pending platform-owner invites in these flows
    if (/^DELETE FROM app\.platform_owner_invites/.test(s)) {
      return { rows: [], rowCount: 0 };
    }

    // INSERT company (account-scoped, with capsuite_ref + denormalised plan)
    if (/^INSERT INTO app\.companies/.test(s)) {
      const [account_id, name, slug, capsuite_ref, plan] = params;
      const c = {
        id: id("company"), account_id, name, slug, capsuite_ref,
        plan: plan || "free", logo_url: null, interaction_service_company_id: null,
      };
      companies.push(c);
      return {
        rows: [{ id: c.id, name: c.name, slug: c.slug, plan: c.plan, logo_url: c.logo_url, capsuite_ref: c.capsuite_ref }],
        rowCount: 1,
      };
    }

    // INSERT owner membership (role/status are SQL literals: 'admin','active')
    if (/^INSERT INTO app\.company_members/.test(s)) {
      const [account_id, company_id, user_id] = params;
      members.push({ account_id, company_id, user_id, role: "admin", status: "active" });
      return { rows: [], rowCount: 1 };
    }

    if (/^INSERT INTO app\.user_preferences/.test(s)) {
      const [user_id, company_id] = params;
      prefs.push({ user_id, company_id });
      return { rows: [], rowCount: 1 };
    }

    if (/^INSERT INTO app\.audit_log/.test(s)) {
      audit.push({ sql: s, params });
      return { rows: [], rowCount: 1 };
    }

    if (/^UPDATE app\.users SET/.test(s)) return { rows: [], rowCount: 1 };

    if (/^UPDATE app\.companies/.test(s)) {
      const [isId, cdpId] = params;
      const c = companies.find((c) => c.id === cdpId);
      if (c) c.interaction_service_company_id = isId;
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  const pool = {
    query: run,
    connect: async () => ({ query: run, release: () => {} }),
  };
  return { pool, store: { accounts, users, companies, members, prefs, audit }, queries };
}

// ── HTTP harness ────────────────────────────────────────────────────────────────
let server, baseUrl, db, realFetch;
const interactionCalls = [];

// Each test gets its own client IP so the per-IP register rate-limiter (max 5)
// buckets per test instead of accumulating across the whole file.
let ipSeq = 0;
let currentTestIp = "10.0.0.1";

function jsonResponse(obj) {
  return Promise.resolve({ ok: true, status: 200, json: async () => obj });
}

// OAuth callbacks require the `state` query param to match the `oauth_state`
// cookie set when the flow started (CSRF guard). Simulate both here.
const OAUTH_STATE = "test-oauth-state";
function oauthCallback(path) {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${baseUrl}${path}${sep}state=${OAUTH_STATE}`, {
    redirect: "manual",
    headers: { Cookie: `oauth_state=${OAUTH_STATE}` },
  });
}

beforeAll(async () => {
  realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (url, opts) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token") || u.includes("/oauth2/v2.0/token")) {
      return jsonResponse({ access_token: "fake-token" });
    }
    if (u.includes("googleapis.com/oauth2/v3/userinfo")) {
      return jsonResponse({ email: GOOGLE_EMAIL, name: "Google User", picture: "http://pic/g.png" });
    }
    if (u.includes("graph.microsoft.com/v1.0/me")) {
      return jsonResponse({ mail: MS_EMAIL, displayName: "MS User" });
    }
    if (u.includes("/company/")) {
      interactionCalls.push({ url: u, body: opts?.body });
      return jsonResponse({ id: "is-company-123" });
    }
    // Requests to our own test server: tag with the per-test client IP so the
    // register rate-limiter (keyed on req.ip, trust proxy enabled) isolates tests.
    const headers = { ...(opts?.headers || {}), "X-Forwarded-For": currentTestIp };
    return realFetch(url, { ...opts, headers });
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (server) server.close();
});

beforeEach(async () => {
  interactionCalls.length = 0;
  currentTestIp = `10.0.0.${++ipSeq}`;
  db = makeFakeDb();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set("trust proxy", true);
  app.use("/api/auth", createAuthRouter(db.pool));

  if (server) server.close();
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

// Wait for the fire-and-forget interaction-service registration to flush
async function waitForInteraction(n = 1, timeout = 1000) {
  const start = Date.now();
  while (interactionCalls.length < n && Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

// Assert a given user provisioned exactly one company, owner membership, prefs row
function expectFullProvisioning(email) {
  const u = db.store.users.find((x) => x.email === email.toLowerCase());
  expect(u, `user ${email} should exist`).toBeTruthy();

  // The first user owns the account (app.accounts.owner_user_id) and gets an
  // 'admin' company membership - 'owner' is no longer a membership role.
  const userMembers = db.store.members.filter((m) => m.user_id === u.id);
  expect(userMembers).toHaveLength(1);
  expect(userMembers[0].role).toBe("admin");
  expect(userMembers[0].status).toBe("active");

  const company = db.store.companies.find((c) => c.id === userMembers[0].company_id);
  expect(company, "company should exist").toBeTruthy();

  const userPrefs = db.store.prefs.filter((p) => p.user_id === u.id);
  expect(userPrefs).toHaveLength(1);
  expect(userPrefs[0].company_id).toBe(company.id);

  return { user: u, company };
}

describe("auth sign-up flows - every path provisions user + company identically", () => {
  it("email register creates user + company + owner membership + preferences", async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "founder@acme.com",
        password: "supersecret1",
        full_name: "Founder One",
        company_name: "Acme Inc",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe("founder@acme.com");
    expect(body.user.companies).toHaveLength(1);
    expect(body.user.companies[0].role).toBe("admin");
    expect(body.token).toBeTruthy();

    expectFullProvisioning("founder@acme.com");

    await waitForInteraction(1);
    expect(interactionCalls).toHaveLength(1);
  });

  it("Google sign-up provisions the same way as email register", async () => {
    const res = await oauthCallback("/api/auth/google/callback?code=abc123");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://frontend.test/");

    const { company } = expectFullProvisioning(GOOGLE_EMAIL);
    // Avatar from the provider should be persisted
    const u = db.store.users.find((x) => x.email === GOOGLE_EMAIL);
    expect(u.avatar_url).toBe("http://pic/g.png");
    expect(u.is_email_verified).toBe(true);

    await waitForInteraction(1);
    expect(interactionCalls).toHaveLength(1);
    expect(interactionCalls[0].body).toContain(company.id);
  });

  it("Microsoft sign-up provisions the same way as email register", async () => {
    const res = await oauthCallback("/api/auth/microsoft/callback?code=xyz789");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://frontend.test/");

    expectFullProvisioning(MS_EMAIL);
    const u = db.store.users.find((x) => x.email === MS_EMAIL);
    expect(u.is_email_verified).toBe(true);
    expect(u.password_hash).toBeNull(); // OAuth users have no password

    await waitForInteraction(1);
    expect(interactionCalls).toHaveLength(1);
  });

  it("all three sign-up paths yield structurally identical workspaces", async () => {
    // Email
    await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@a.com", password: "password12", full_name: "A", company_name: "A Co" }),
    });
    // Google
    await oauthCallback("/api/auth/google/callback?code=g");
    // Microsoft
    await oauthCallback("/api/auth/microsoft/callback?code=m");

    expect(db.store.users).toHaveLength(3);
    expect(db.store.companies).toHaveLength(3);
    expect(db.store.members).toHaveLength(3);
    expect(db.store.prefs).toHaveLength(3);
    // Every membership is an active admin (the account owner's workspace role)
    expect(db.store.members.every((m) => m.role === "admin" && m.status === "active")).toBe(true);

    await waitForInteraction(3);
    expect(interactionCalls).toHaveLength(3);
  });
});

describe("auth login flows - consistent across methods", () => {
  it("email register then login with the same password succeeds", async () => {
    await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "login@acme.com", password: "mypassword1", full_name: "Login User", company_name: "Login Co" }),
    });

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "login@acme.com", password: "mypassword1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("login@acme.com");
    expect(body.user.companies[0].role).toBe("admin");
    expect(body.user.password_hash).toBeUndefined(); // never leak the hash
  });

  it("login with wrong password is rejected", async () => {
    await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "wrong@acme.com", password: "rightpass12", full_name: "X", company_name: "X Co" }),
    });

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "wrong@acme.com", password: "WRONGpass12" }),
    });
    expect(res.status).toBe(401);
  });

  it("OAuth sign-up, then logging in via the same provider does NOT create a second company", async () => {
    await oauthCallback("/api/auth/google/callback?code=first");
    await waitForInteraction(1);

    // Second visit = existing user, should just log in
    const res = await oauthCallback("/api/auth/google/callback?code=second");
    expect(res.status).toBe(302);

    expect(db.store.users).toHaveLength(1);
    expect(db.store.companies).toHaveLength(1);
    expect(db.store.members).toHaveLength(1);
    // No extra interaction registration on the login pass
    await new Promise((r) => setTimeout(r, 50));
    expect(interactionCalls).toHaveLength(1);
  });

  it("registering a duplicate email is rejected with 409", async () => {
    const payload = { email: "dupe@acme.com", password: "password12", full_name: "Dupe", company_name: "Dupe Co" };
    const first = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);

    const second = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    expect(second.status).toBe(409);
    expect(db.store.users).toHaveLength(1);
  });
});

describe("OAuth provider configuration guards", () => {
  it("reports configured status for both providers", async () => {
    const g = await (await fetch(`${baseUrl}/api/auth/google/status`)).json();
    const m = await (await fetch(`${baseUrl}/api/auth/microsoft/status`)).json();
    expect(g.configured).toBe(true);
    expect(m.configured).toBe(true);
  });

  it("redirects /microsoft to the Microsoft consent screen", async () => {
    const res = await fetch(`${baseUrl}/api/auth/microsoft`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("login.microsoftonline.com");
    expect(res.headers.get("location")).toContain("test-ms-id");
  });
});
