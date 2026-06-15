#!/usr/bin/env node
/* ============================================================================
 *  smoke_test.cjs - exercise every API endpoint against the running server +
 *  rebuilt DB, to map what works vs. what's still broken by the schema change.
 *  Requires the dev server up on :3001 and the seed loaded.
 *    node scripts/smoke_test.cjs
 * ========================================================================== */
const BASE = process.env.API_BASE || "http://localhost:3001/api";
const EMAIL = "owner@acme.test", PASS = "Password123!";

let token = null, companyId = null;
const results = [];

async function call(name, method, path, { body, company = true, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && token) headers.authorization = `Bearer ${token}`;
  if (company && companyId) headers["x-company-id"] = companyId;
  let status = 0, ok = false, err = null, json = null;
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    status = res.status;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    ok = res.ok;
    if (!ok) err = (json && json.error) || (typeof json === "string" ? json.slice(0, 160) : `HTTP ${status}`);
  } catch (e) { err = e.message; }
  results.push({ name, method, path: path.length > 48 ? path.slice(0, 47) + "…" : path, status, ok, err });
  return json;
}

(async () => {
  // ── login ────────────────────────────────────────────────────────────────
  const login = await call("auth.login", "POST", "/auth/login", { body: { email: EMAIL, password: PASS }, company: false, auth: false });
  if (!login || !login.token) { console.error("LOGIN FAILED - aborting:", results.at(-1)); process.exit(1); }
  token = login.token;
  const wantSlug = process.env.COMPANY_SLUG || "acme-retail";
  const retail = login.user.companies.find(c => c.slug === wantSlug) || login.user.companies[0];
  companyId = retail.id;
  console.log(`Logged in as ${EMAIL}; testing workspace "${retail.name}" (${companyId})\n`);

  // ── prefetch ids from list endpoints ──────────────────────────────────────
  const campaigns = await call("entities.Campaign.list", "GET", "/entities/Campaign");
  const segments = await call("entities.Segment.list", "GET", "/entities/Segment");
  await call("entities.SavedReport.list", "GET", "/entities/SavedReport");
  await call("entities.PinnedChart.list", "GET", "/entities/PinnedChart");
  await call("entities.DataDictionary.list", "GET", "/entities/DataDictionary");
  const edm = await call("edm.listCampaigns", "GET", "/edm/campaigns");
  const popups = await call("popup.list", "GET", "/popups");
  const attrs = await call("attributes.list", "GET", "/attributes");
  const customers = await call("profiles.listCustomers", "GET", "/profiles/customers?limit=5");
  const anon = await call("profiles.listAnonymous", "GET", "/profiles/anonymous?limit=5");

  const firstId = (x) => Array.isArray(x) ? x[0]?.id : (x?.data?.[0]?.id || x?.rows?.[0]?.id || x?.items?.[0]?.id);
  const segId = firstId(segments);
  const edmId = firstId(edm);
  const popupId = firstId(popups);
  const attrId = firstId(attrs);
  const custList = Array.isArray(customers) ? customers : (customers?.data || customers?.rows || customers?.profiles || []);
  const anonList = Array.isArray(anon) ? anon : (anon?.data || anon?.rows || anon?.profiles || []);
  const memberId = custList[0]?.member_id;
  const visitorId = anonList[0]?.visitor_id;

  // ── account / company / platform ──────────────────────────────────────────
  await call("auth.me", "GET", "/auth/me", { company: false });
  await call("auth.preferences", "GET", "/auth/preferences", { company: false });
  await call("plans.list", "GET", "/plans", { company: false, auth: false });
  await call("companies.get", "GET", `/companies/${companyId}`);
  await call("companies.members", "GET", `/companies/${companyId}/members`);
  await call("companies.invitations", "GET", `/companies/${companyId}/invitations`);
  await call("companies.preferences", "GET", `/companies/${companyId}/preferences`);
  await call("companies.apiKeys", "GET", `/companies/${companyId}/api-keys`);
  await call("companies.auditLog", "GET", `/companies/${companyId}/audit-log?limit=20`);
  await call("billing.usage", "GET", "/billing/usage");
  await call("support.tickets", "GET", "/support/tickets");

  // ── profiles ──────────────────────────────────────────────────────────────
  await call("profiles.customerFilters", "GET", "/profiles/customer-filters");
  await call("profiles.anonymousFilters", "GET", "/profiles/anonymous-filters");
  await call("profiles.analytics", "GET", "/profiles/analytics");
  if (memberId) {
    await call("profiles.transactions", "GET", `/profiles/customers/${encodeURIComponent(memberId)}/transactions`);
    await call("profiles.insights", "GET", `/profiles/customers/${encodeURIComponent(memberId)}/insights`);
  }
  if (visitorId) await call("profiles.anonInsights", "GET", `/profiles/anonymous/${encodeURIComponent(visitorId)}/insights`);

  // ── segments ──────────────────────────────────────────────────────────────
  if (segId) await call("segments.size", "GET", `/segments/${segId}/size`);

  // ── edm ───────────────────────────────────────────────────────────────────
  await call("edm.listTemplates", "GET", "/edm/templates");
  await call("edm.listSuppression", "GET", "/edm/suppression");
  await call("edm.getSettings", "GET", "/edm/settings");
  await call("edm.listAutomations", "GET", "/edm/automations");
  if (edmId) {
    await call("edm.getCampaign", "GET", `/edm/campaigns/${edmId}`);
    await call("edm.campaignStats", "GET", `/edm/campaigns/${edmId}/stats`);
    await call("edm.campaignSends", "GET", `/edm/campaigns/${edmId}/sends`);
    await call("edm.recipientsPreview", "GET", `/edm/campaigns/${edmId}/recipients/preview`);
  }

  // ── integrations ──────────────────────────────────────────────────────────
  await call("integrations.list", "GET", "/data-integrations");
  await call("integrations.get", "GET", "/data-integrations/googleAnalytics");
  await call("integrations.syncJobs", "GET", "/data-integrations/googleAnalytics/sync/jobs");
  await call("integrations.audit", "GET", "/data-integrations/googleAnalytics/audit");

  // ── settings ──────────────────────────────────────────────────────────────
  await call("settings.getAll", "GET", "/settings");

  // ── popups ────────────────────────────────────────────────────────────────
  await call("popup.listTemplates", "GET", "/popups/templates");
  await call("popup.analytics", "GET", "/popups/analytics");
  await call("popup.dailyTrend", "GET", "/popups/analytics/daily");
  await call("popup.emailCollected", "GET", "/popups/email-collected");
  await call("popup.lastActivity", "GET", "/popups/last-activity");
  if (popupId) await call("popup.getEmails", "GET", `/popups/${popupId}/emails`);

  // ── attributes ────────────────────────────────────────────────────────────
  await call("attributes.options", "GET", "/attributes/options");
  await call("attributes.review", "GET", "/attributes/review");
  await call("attributes.crawlSettings", "GET", "/attributes/crawl-settings");
  await call("attributes.ruleFields", "GET", "/attributes/rule-fields");
  await call("attributes.analytics", "GET", "/attributes/analytics");
  await call("attributes.webPages", "GET", "/attributes/web-pages");
  await call("attributes.jobs", "GET", "/attributes/jobs?limit=10");
  await call("attributes.latestJob", "GET", "/attributes/jobs/latest");
  if (attrId) {
    await call("attributes.get", "GET", `/attributes/${attrId}`);
    await call("attributes.pages", "GET", `/attributes/${attrId}/pages`);
  }
  if (memberId) await call("attributes.profileAttrs", "GET", `/attributes/profile/customer/${encodeURIComponent(memberId)}`);

  // ── analyst / skills ──────────────────────────────────────────────────────
  await call("agents.listConversations", "GET", "/agents/conversations");
  await call("skills.list", "GET", "/skills");

  // ── a few WRITE cycles (create → delete) ──────────────────────────────────
  const seg = await call("entities.Segment.create", "POST", "/entities/Segment",
    { body: { name: "SMOKE seg", segment_type: "customer", filter_criteria: {} } });
  if (seg?.id) await call("entities.Segment.delete", "DELETE", `/entities/Segment/${seg.id}`);
  const sk = await call("skills.create", "POST", "/skills", { body: { name: "SMOKE skill", type: "context", content: "x" } });
  if (sk?.id) await call("skills.remove", "DELETE", `/skills/${sk.id}`);
  const tpl = await call("edm.createTemplate", "POST", "/edm/templates", { body: { name: "SMOKE tpl", subject: "s", html_body: "<p>x</p>" } });
  if (tpl?.id) await call("edm.deleteTemplate", "DELETE", `/edm/templates/${tpl.id}`);

  // ── report ────────────────────────────────────────────────────────────────
  const pass = results.filter(r => r.ok), fail = results.filter(r => !r.ok);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("RESULT", 7) + pad("CODE", 5) + pad("ENDPOINT", 30) + "PATH");
  for (const r of results) {
    console.log(pad(r.ok ? "PASS" : "FAIL", 7) + pad(r.status, 5) + pad(r.name, 30) + r.method + " " + r.path + (r.ok ? "" : `   ⟵ ${r.err}`));
  }
  console.log(`\n${pass.length}/${results.length} passed, ${fail.length} failed.`);
  if (fail.length) {
    console.log("\nFAILURES:");
    fail.forEach(r => console.log(`  ✗ ${r.name} [${r.status}] ${r.method} ${r.path} - ${r.err}`));
  }
  process.exit(fail.length ? 2 : 0);
})();
