/* ============================================================================
 *  test_studio.mjs - comprehensive end-to-end test of the Studio (platform-owner)
 *  API logic. Creates isolated fixtures (a throwaway account + user + workspace),
 *  exercises every /api/admin endpoint and its edge cases against a RUNNING
 *  server, asserts outputs, then tears the fixtures down.
 *
 *  Usage: start the server, then:  node scripts/test_studio.mjs
 * ========================================================================== */
import "dotenv/config";
import pg from "pg";
import crypto from "crypto";
import { createToken, verifyToken, planLimit } from "../server/middleware/auth.js";

const BASE = process.env.TEST_BASE || "http://localhost:3001/api";
const pool = new pg.Pool({ connectionString: process.env.POSTGRESQL_CONN || process.env.DATABASE_URL, max: 3 });

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name}  ${detail}`); }
}

const TAG = "ZZSTUDIOTEST_" + crypto.randomBytes(3).toString("hex");
const ids = { account: null, owner: null, workspace: null, regAccount: null };
let ownerTok, testUserTok;

// HTTP helper using a cookie token.
async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Cookie = "cdp_token=" + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, res };
}

async function setup() {
  const realOwner = (await pool.query("SELECT id,email,account_id FROM app.users WHERE is_platform_admin=true LIMIT 1")).rows[0];
  if (!realOwner) throw new Error("No platform owner in DB - run apply_platform_admin.cjs");
  ownerTok = createToken({ id: realOwner.id, email: realOwner.email });
  ids.realOwner = realOwner;

  // Throwaway account → user → workspace → membership
  const acct = (await pool.query(
    `INSERT INTO app.accounts (name, slug, plan, plan_expires_at)
     VALUES ($1,$2,'free', NOW() + INTERVAL '30 days') RETURNING id`,
    [TAG + " Co", TAG.toLowerCase()]
  )).rows[0];
  ids.account = acct.id;
  const user = (await pool.query(
    `INSERT INTO app.users (account_id, email, full_name, password_hash, is_email_verified)
     VALUES ($1,$2,'Test User','x', false) RETURNING id,email`,
    [acct.id, TAG.toLowerCase() + "@example.com"]
  )).rows[0];
  ids.owner = user.id; ids.ownerEmail = user.email;
  await pool.query("UPDATE app.accounts SET owner_user_id=$1 WHERE id=$2", [user.id, acct.id]);
  const ws = (await pool.query(
    `INSERT INTO app.companies (account_id, name, slug, capsuite_ref, plan)
     VALUES ($1,$2,$3,$4,'free') RETURNING id`,
    [acct.id, TAG + " Workspace", TAG.toLowerCase() + "-ws", TAG.toLowerCase() + "_" + crypto.randomBytes(2).toString("hex")]
  )).rows[0];
  ids.workspace = ws.id;
  await pool.query(
    `INSERT INTO app.company_members (account_id, company_id, user_id, role, status)
     VALUES ($1,$2,$3,'admin','active')`,
    [acct.id, ws.id, user.id]
  );
  // Seed one ai_token usage event (simple table) to verify usage counting.
  await pool.query(
    `INSERT INTO app.usage_events (company_id, user_id, event_type, quantity) VALUES ($1,$2,'ai_token',5)`,
    [ws.id, user.id]
  );
  testUserTok = createToken({ id: user.id, email: user.email });
  console.log(`Fixtures: account=${ids.account} user=${ids.owner} ws=${ids.workspace} tag=${TAG}\n`);
}

async function teardown() {
  try {
    if (ids.account) await pool.query("DELETE FROM app.accounts WHERE id=$1", [ids.account]);
    if (ids.regAccount) await pool.query("DELETE FROM app.accounts WHERE id=$1", [ids.regAccount]);
    await pool.query("DELETE FROM app.platform_owner_invites WHERE email LIKE $1", [TAG.toLowerCase() + "%"]);
    await pool.query("DELETE FROM app.support_tickets WHERE subject LIKE $1", [TAG + "%"]);
    console.log("\nTeardown: fixtures removed.");
  } catch (e) { console.error("Teardown error:", e.message); }
  await pool.end();
}

async function run() {
  // ── Access control ────────────────────────────────────────────────────────
  console.log("Access control");
  check("unauth → 401", (await api("/admin/stats")).status === 401);
  check("non-owner → 403", (await api("/admin/stats", { token: testUserTok })).status === 403);
  check("owner → 200", (await api("/admin/stats", { token: ownerTok })).status === 200);

  // ── Stats ─────────────────────────────────────────────────────────────────
  console.log("Stats");
  const stats = (await api("/admin/stats", { token: ownerTok })).json;
  check("stats numeric fields", ["total_accounts","paid_accounts","free_accounts","total_users","total_workspaces","signups_30d","active_trials","expired_trials","expiring_7d","open_tickets"].every(k => typeof stats[k] === "number"), JSON.stringify(stats).slice(0,120));
  check("signups_daily has 30 days", Array.isArray(stats.signups_daily) && stats.signups_daily.length === 30);
  check("test account counted", stats.total_accounts >= 1 && stats.active_trials >= 1);

  // ── Accounts list: search + sort ────────────────────────────────────────────
  console.log("Accounts list");
  const searched = (await api(`/admin/accounts?search=${TAG}`, { token: ownerTok })).json;
  check("search finds test account", searched.length === 1 && searched[0].id === ids.account, `got ${searched.length}`);
  check("user_count/workspace_count numeric", searched[0]?.user_count === 1 && searched[0]?.workspace_count === 1, JSON.stringify(searched[0]));
  for (const s of ["created_date","name","plan","last_activity"]) {
    check(`sort=${s} → 200 array`, Array.isArray((await api(`/admin/accounts?sort=${s}`, { token: ownerTok })).json));
  }

  // ── Account detail + usage ──────────────────────────────────────────────────
  console.log("Account detail");
  const detail = (await api(`/admin/accounts/${ids.account}`, { token: ownerTok })).json;
  check("detail account/users/workspaces", detail.account?.id === ids.account && detail.users.length === 1 && detail.workspaces.length === 1);
  check("workspace ai_tokens counted = 5", detail.workspaces[0].ai_tokens === 5, `got ${detail.workspaces[0]?.ai_tokens}`);
  check("detail 404 for bogus id", (await api(`/admin/accounts/${crypto.randomUUID()}`, { token: ownerTok })).status === 404);

  // ── Account update: plan trigger, trial, suspend, overrides, billing ────────
  console.log("Account update");
  await api(`/admin/accounts/${ids.account}`, { token: ownerTok, method: "PATCH", body: { plan: "paid" } });
  let a = (await pool.query("SELECT plan, plan_expires_at, plan_upgraded_at FROM app.accounts WHERE id=$1", [ids.account])).rows[0];
  check("free→paid stamps upgraded + clears expiry", a.plan === "paid" && a.plan_upgraded_at && a.plan_expires_at === null);
  await api(`/admin/accounts/${ids.account}`, { token: ownerTok, method: "PATCH", body: { plan: "free", plan_expires_at: "2030-01-01T00:00:00.000Z" } });
  a = (await pool.query("SELECT plan, plan_expires_at, plan_upgraded_at FROM app.accounts WHERE id=$1", [ids.account])).rows[0];
  check("paid→free clears upgraded + sets expiry", a.plan === "free" && !a.plan_upgraded_at && a.plan_expires_at !== null);
  await api(`/admin/accounts/${ids.account}`, { token: ownerTok, method: "PATCH", body: { is_active: false } });
  check("suspend works", (await pool.query("SELECT is_active FROM app.accounts WHERE id=$1", [ids.account])).rows[0].is_active === false);
  await api(`/admin/accounts/${ids.account}`, { token: ownerTok, method: "PATCH", body: { is_active: true } });
  check("invalid plan rejected (400)", (await api(`/admin/accounts/${ids.account}`, { token: ownerTok, method: "PATCH", body: { plan: "enterprise" } })).status === 400);
  // limit overrides + billing notes
  await api(`/admin/accounts/${ids.account}`, { token: ownerTok, method: "PATCH", body: { limit_overrides: { profiles: 7, ai_tokens: "" }, billing_notes: "Paid by wire", payment_reference: "INV-1" } });
  const s2 = (await pool.query("SELECT settings FROM app.accounts WHERE id=$1", [ids.account])).rows[0].settings;
  check("billing notes stored", s2.billing_notes === "Paid by wire" && s2.payment_reference === "INV-1");
  check("blank override dropped, numeric kept", s2.limit_overrides.profiles === 7 && !("ai_tokens" in s2.limit_overrides), JSON.stringify(s2.limit_overrides));
  // planLimit honours the override
  check("planLimit() uses override (7)", (await planLimit(pool, ids.workspace, "profiles")) === 7);
  check("planLimit() falls back to plan for other keys", (await planLimit(pool, ids.workspace, "campaigns")) === 5);

  // ── Users list + last_action + guards ───────────────────────────────────────
  console.log("Users");
  const users = (await api(`/admin/users?search=${TAG}`, { token: ownerTok })).json;
  check("users search finds test user", users.length === 1 && users[0].id === ids.owner);
  check("user has last_action field", "last_action" in users[0]);
  check("self-demote blocked (400)", (await api(`/admin/users/${ids.realOwner.id}`, { token: ownerTok, method: "PATCH", body: { is_platform_admin: false } })).status === 400);
  check("non-boolean rejected (400)", (await api(`/admin/users/${ids.owner}`, { token: ownerTok, method: "PATCH", body: { is_platform_admin: "yes" } })).status === 400);
  // promote then demote the test user (real owner still exists → allowed)
  check("promote test user (200)", (await api(`/admin/users/${ids.owner}`, { token: ownerTok, method: "PATCH", body: { is_platform_admin: true } })).status === 200);
  check("now an owner in DB", (await pool.query("SELECT is_platform_admin FROM app.users WHERE id=$1", [ids.owner])).rows[0].is_platform_admin === true);
  check("demote test user (200)", (await api(`/admin/users/${ids.owner}`, { token: ownerTok, method: "PATCH", body: { is_platform_admin: false } })).status === 200);

  // ── Email actions ───────────────────────────────────────────────────────────
  console.log("Email actions");
  const sv = await api(`/admin/users/${ids.owner}/send-verification`, { token: ownerTok, method: "POST" });
  check("send-verification 200 + token row", sv.status === 200 && (await pool.query("SELECT email_verify_token FROM app.users WHERE id=$1", [ids.owner])).rows[0].email_verify_token, JSON.stringify(sv.json));
  const sr = await api(`/admin/users/${ids.owner}/send-reset`, { token: ownerTok, method: "POST" });
  check("send-reset 200 + reset token row", sr.status === 200 && (await pool.query("SELECT COUNT(*)::int n FROM app.password_reset_tokens WHERE user_id=$1", [ids.owner])).rows[0].n >= 1);
  await pool.query("DELETE FROM app.password_reset_tokens WHERE user_id=$1", [ids.owner]);

  // ── Impersonation ───────────────────────────────────────────────────────────
  console.log("Impersonation");
  const imp = await api(`/admin/users/${ids.owner}/impersonate`, { token: ownerTok, method: "POST" });
  const setCookie = imp.res.headers.get("set-cookie") || "";
  const impToken = (setCookie.match(/cdp_token=([^;]+)/) || [])[1];
  let impClaims = null; try { impClaims = verifyToken(impToken); } catch {}
  check("impersonate mints tagged token", imp.status === 200 && impClaims?.id === ids.owner && impClaims?.imp === true && impClaims?.impersonated_by === ids.realOwner.email, JSON.stringify(impClaims));
  check("can't impersonate self (400)", (await api(`/admin/users/${ids.realOwner.id}/impersonate`, { token: ownerTok, method: "POST" })).status === 400);

  // ── Owner invites ───────────────────────────────────────────────────────────
  console.log("Owner invites");
  const newEmail = TAG.toLowerCase() + "-new@example.com";
  const inv1 = await api("/admin/owners/invite", { token: ownerTok, method: "POST", body: { email: newEmail } });
  check("invite new email → invited", inv1.json?.status === "invited");
  const invList = (await api("/admin/owner-invites", { token: ownerTok })).json;
  check("pending invite listed", invList.some(i => i.email === newEmail));
  check("invalid email rejected (400)", (await api("/admin/owners/invite", { token: ownerTok, method: "POST", body: { email: "nope" } })).status === 400);
  // invite an existing (test) user → promote
  const inv2 = await api("/admin/owners/invite", { token: ownerTok, method: "POST", body: { email: ids.ownerEmail } });
  check("invite existing → promoted", inv2.json?.status === "promoted");
  await api(`/admin/users/${ids.owner}`, { token: ownerTok, method: "PATCH", body: { is_platform_admin: false } }); // revert
  // invite-on-signup: registering the invited email auto-promotes
  const reg = await api("/auth/register", { method: "POST", body: { email: newEmail, password: "Password123!", full_name: "New Owner", company_name: TAG + " New" } });
  if (reg.status === 201 || reg.status === 200) {
    const ru = (await pool.query("SELECT id, account_id, is_platform_admin FROM app.users WHERE LOWER(email)=$1", [newEmail])).rows[0];
    ids.regAccount = ru?.account_id;
    check("signup consumes invite → auto-owner", ru?.is_platform_admin === true);
    check("invite removed after signup", (await pool.query("SELECT 1 FROM app.platform_owner_invites WHERE email=$1", [newEmail])).rowCount === 0);
  } else {
    check("register endpoint available for invite-on-signup", false, `register returned ${reg.status} (code-based signup?) - skipping`);
    await api(`/admin/owner-invites/${encodeURIComponent(newEmail)}`, { token: ownerTok, method: "DELETE" });
  }
  // cancel invite endpoint
  await api("/admin/owners/invite", { token: ownerTok, method: "POST", body: { email: TAG.toLowerCase() + "-cancel@example.com" } });
  await api(`/admin/owner-invites/${encodeURIComponent(TAG.toLowerCase() + "-cancel@example.com")}`, { token: ownerTok, method: "DELETE" });
  check("cancel invite removes it", !((await api("/admin/owner-invites", { token: ownerTok })).json.some(i => i.email === TAG.toLowerCase() + "-cancel@example.com")));

  // ── Plans ───────────────────────────────────────────────────────────────────
  console.log("Plans");
  const plans = (await api("/admin/plans", { token: ownerTok })).json;
  const free = plans.find(p => p.id === "free");
  check("plans returns catalog", Array.isArray(plans) && !!free && !!free.limits);
  const origWd = free.warning_days;
  const upd = await api("/admin/plans/free", { token: ownerTok, method: "PATCH", body: { warning_days: origWd + 1 } });
  check("plan update applies", upd.status === 200 && (await pool.query("SELECT warning_days FROM app.plans WHERE id='free'")).rows[0].warning_days === origWd + 1);
  await api("/admin/plans/free", { token: ownerTok, method: "PATCH", body: { warning_days: origWd } }); // restore
  check("plan update 404 for bogus", (await api("/admin/plans/zzz", { token: ownerTok, method: "PATCH", body: { warning_days: 1 } })).status === 404);

  // ── Support tickets ─────────────────────────────────────────────────────────
  console.log("Support tickets");
  const sub = await api("/support/tickets", { token: testUserTok, method: "POST", body: { type: "bug", subject: TAG + " ticket", body: "broken", priority: "high" } });
  check("user submits ticket (201)", sub.status === 201 && sub.json?.id, JSON.stringify(sub.json));
  const tid = sub.json?.id;
  const tlist = (await api("/admin/tickets", { token: ownerTok })).json;
  const t = tlist.find(x => x.id === tid);
  check("ticket appears in studio w/ account+user", !!t && t.account_name === TAG + " Co" && t.user_email === ids.ownerEmail, JSON.stringify(t));
  check("filter by type=bug includes it", (await api("/admin/tickets?type=bug", { token: ownerTok })).json.some(x => x.id === tid));
  const ut = await api(`/admin/tickets/${tid}`, { token: ownerTok, method: "PATCH", body: { status: "resolved" } });
  check("resolve stamps resolved_at", ut.status === 200 && (await pool.query("SELECT resolved_at FROM app.support_tickets WHERE id=$1", [tid])).rows[0].resolved_at);
  check("filter status=open excludes resolved", !(await api("/admin/tickets?status=open", { token: ownerTok })).json.some(x => x.id === tid));
  check("invalid status rejected (400)", (await api(`/admin/tickets/${tid}`, { token: ownerTok, method: "PATCH", body: { status: "banana" } })).status === 400);

  // ── Audit feed ──────────────────────────────────────────────────────────────
  console.log("Audit feed");
  const audit = (await api("/admin/audit?action=update&limit=50", { token: ownerTok })).json;
  check("audit feed returns rows", Array.isArray(audit) && audit.length > 0);
  check("audit filtered to action=update", audit.every(r => r.action === "update"));
  check("account-scoped audit filter works", Array.isArray((await api(`/admin/audit?account_id=${ids.account}`, { token: ownerTok })).json));

  // ── Delete account (guard + cascade) ────────────────────────────────────────
  console.log("Delete account");
  check("can't delete own account (400)", (await api(`/admin/accounts/${ids.realOwner.account_id}`, { token: ownerTok, method: "DELETE" })).status === 400);
  const del = await api(`/admin/accounts/${ids.account}`, { token: ownerTok, method: "DELETE" });
  check("delete test account (200)", del.status === 200);
  check("account gone + cascade (users/ws removed)",
    (await pool.query("SELECT 1 FROM app.accounts WHERE id=$1", [ids.account])).rowCount === 0 &&
    (await pool.query("SELECT 1 FROM app.users WHERE id=$1", [ids.owner])).rowCount === 0 &&
    (await pool.query("SELECT 1 FROM app.companies WHERE id=$1", [ids.workspace])).rowCount === 0);
  if (del.status === 200) ids.account = null; // already gone; skip in teardown
}

(async () => {
  try { await setup(); await run(); }
  catch (e) { console.error("FATAL:", e.stack || e.message); fail++; }
  finally {
    await teardown();
    console.log(`\n${"=".repeat(48)}\nRESULT: ${pass} passed, ${fail} failed`);
    if (fails.length) console.log("Failed: " + fails.join("; "));
    process.exit(fail ? 1 : 0);
  }
})();
