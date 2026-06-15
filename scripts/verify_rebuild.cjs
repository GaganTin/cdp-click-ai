#!/usr/bin/env node
/* Verifies the rebuilt schema: tenant isolation, role model, audit, and that a
 * WORKSPACE delete cascades all source + app data, on a CLONE workspace so the
 * seed data is left intact. Read-only except for the throwaway clone it makes. */
const { getPool } = require("./_db.cjs");
const pool = getPool();
const q = (t, p) => pool.query(t, p);

(async () => {
  const out = [];
  // 1. tenancy shape
  const t = (await q(`SELECT
     (SELECT count(*) FROM app.accounts) accounts,
     (SELECT count(*) FROM app.users) users,
     (SELECT count(*) FROM app.companies) companies,
     (SELECT count(*) FROM app.company_members) members`)).rows[0];
  out.push(`tenancy: ${t.accounts} account, ${t.users} users, ${t.companies} workspaces, ${t.members} memberships`);

  // 2. role model + permissions present
  const roles = (await q(`SELECT role, count(*) n FROM app.company_members GROUP BY role ORDER BY role`)).rows;
  out.push("roles: " + roles.map(r => `${r.role}=${r.n}`).join(", "));
  const restricted = (await q(`SELECT u.email, cm.role, cm.permissions
     FROM app.company_members cm JOIN app.users u ON u.id=cm.user_id
     WHERE cm.permissions <> '{}' LIMIT 1`)).rows[0];
  out.push(`permissions override example: ${restricted ? restricted.email + " (" + restricted.role + ") → " + JSON.stringify(restricted.permissions.resources) : "none"}`);
  const ownerOk = (await q(`SELECT a.slug, u.email FROM app.accounts a JOIN app.users u ON u.id=a.owner_user_id`)).rows[0];
  out.push(`account owner: ${ownerOk ? ownerOk.email : "MISSING"}`);

  // 3. per-workspace isolation: each source table has rows for BOTH companies, no cross-bleed
  const iso = (await q(`
     SELECT c.name,
       (SELECT count(*) FROM app.customer_profiles p WHERE p.company_id=c.id) profiles,
       (SELECT count(*) FROM ga_landing.path_exploration g WHERE g.company_id=c.id) ga_events,
       (SELECT count(*) FROM app.profile_identities i WHERE i.company_id=c.id) identities,
       (SELECT count(*) FROM app.anonymous_profiles a WHERE a.company_id=c.id) anon,
       (SELECT count(*) FROM app.anonymous_profiles a WHERE a.company_id=c.id AND a.resolved_member_id IS NOT NULL) anon_resolved,
       (SELECT count(*) FROM interaction.activities x WHERE x.company_id=c.id) activities,
       (SELECT count(*) FROM app.audit_log al WHERE al.company_id=c.id) audit
     FROM app.companies c ORDER BY c.name`)).rows;
  iso.forEach(r => out.push(`  ${r.name}: ${r.profiles} profiles, ${r.ga_events} ga_events, ${r.identities} identities, ${r.anon} anon (${r.anon_resolved} resolved), ${r.activities} activities, ${r.audit} audit`));

  // 4. integration credential uniqueness within account (should be 0 dup fingerprints)
  const dup = (await q(`SELECT count(*) c FROM (
     SELECT account_id, integration_type, credential_fingerprint, count(*) n
     FROM app.data_integrations WHERE credential_fingerprint IS NOT NULL
     GROUP BY 1,2,3 HAVING count(*)>1) z`)).rows[0].c;
  out.push(`integration cred dup groups (must be 0): ${dup}`);

  // 5. WORKSPACE cascade delete - clone a workspace, count all its rows, delete, confirm 0
  const acct = (await q(`SELECT id FROM app.accounts WHERE slug='acme'`)).rows[0].id;
  await q(`DELETE FROM app.companies WHERE slug='zz-cascade-test'`); // clean any prior run
  const clone = (await q(`INSERT INTO app.companies (account_id, name, slug, capsuite_ref)
     VALUES ($1,'ZZ Cascade Test','zz-cascade-test','zz_cascade_test') RETURNING id`, [acct])).rows[0].id;
  // sprinkle rows across schemas + a child (edm send under a campaign)
  await q(`INSERT INTO app.customer_profiles (company_id, member_id, member_source) VALUES ($1,'zz_m1','manual')`, [clone]);
  await q(`INSERT INTO ga_landing.path_exploration (company_id, event_name, date, capsuite_apid, capsuite_ref) VALUES ($1,'page_view','20260101','zz_apid','zz')`, [clone]);
  await q(`INSERT INTO manual.membership (member_id, company_id, primary_email) VALUES ('zz_m1',$1,'zz@x.com')`, [clone]);
  await q(`INSERT INTO shopify."order" (order_id, company_id) VALUES ('zz_o1',$1)`, [clone]);
  await q(`INSERT INTO commerce."order" (order_id, company_id, source_platform) VALUES ('zz_o1',$1,'shopify')`, [clone]);
  await q(`INSERT INTO interaction.activities (company_id, activity_type, occurred_at) VALUES ($1,'impression',NOW())`, [clone]);
  const ec = (await q(`INSERT INTO app.edm_campaigns (company_id, name) VALUES ($1,'zz') RETURNING id`, [clone])).rows[0].id;
  await q(`INSERT INTO app.edm_sends (company_id, edm_campaign_id, email) VALUES ($1,$2,'zz@x.com')`, [clone, ec]);
  await q(`SELECT app.log_audit($1, NULL, 'create', 'workspace', $2)`, [clone, clone]);

  const before = (await q(`SELECT
     (SELECT count(*) FROM app.customer_profiles WHERE company_id=$1)
     +(SELECT count(*) FROM ga_landing.path_exploration WHERE company_id=$1)
     +(SELECT count(*) FROM manual.membership WHERE company_id=$1)
     +(SELECT count(*) FROM shopify."order" WHERE company_id=$1)
     +(SELECT count(*) FROM commerce."order" WHERE company_id=$1)
     +(SELECT count(*) FROM interaction.activities WHERE company_id=$1)
     +(SELECT count(*) FROM app.edm_campaigns WHERE company_id=$1)
     +(SELECT count(*) FROM app.edm_sends WHERE company_id=$1) total`, [clone])).rows[0].total;

  await q(`DELETE FROM app.companies WHERE id=$1`, [clone]);  // the cascade under test

  const after = (await q(`SELECT
     (SELECT count(*) FROM app.customer_profiles WHERE company_id=$1)
     +(SELECT count(*) FROM ga_landing.path_exploration WHERE company_id=$1)
     +(SELECT count(*) FROM manual.membership WHERE company_id=$1)
     +(SELECT count(*) FROM shopify."order" WHERE company_id=$1)
     +(SELECT count(*) FROM commerce."order" WHERE company_id=$1)
     +(SELECT count(*) FROM interaction.activities WHERE company_id=$1)
     +(SELECT count(*) FROM app.edm_campaigns WHERE company_id=$1)
     +(SELECT count(*) FROM app.edm_sends WHERE company_id=$1) total`, [clone])).rows[0].total;
  const auditKept = (await q(`SELECT count(*) c FROM app.audit_log WHERE resource_id=$1::text`, [clone])).rows[0].c;
  out.push(`WORKSPACE delete cascade: ${before} rows before → ${after} after (must be 0); audit rows kept detached: ${auditKept}`);

  console.log("\n=== REBUILD VERIFICATION ===");
  out.forEach(l => console.log(l));
  console.log(`\nRESULT: ${after === "0" && dup === "0" ? "PASS ✅" : "CHECK ⚠️"}`);
  await pool.end();
})().catch(e => { console.error(e); pool.end(); process.exit(1); });
