#!/usr/bin/env node
/* ============================================================================
 *  seed_all.cjs - one connected dataset for the rebuilt schema (server/sql/*)
 * ----------------------------------------------------------------------------
 *  Creates ONE account with TWO workspaces (companies) so multi-tenant
 *  isolation is visible, and fills every page/tab with realistic data:
 *    • Account "Acme Group" (plan pro) + 3 users with different per-workspace roles
 *    • Workspace A "Acme Retail"  (capsuite_ref acme_retail) - Shopify + GA + GSC
 *    • Workspace B "Acme Academy" (capsuite_ref acme_academy) - Manual + GA
 *    • Per workspace: integrations, GA/GSC landing data, source membership,
 *      unified customer_profiles + identity map + anonymous profiles,
 *      segments, UTM campaigns, EDM (templates/campaigns/sends/events/
 *      suppression/automations), popups (+ interaction mirror), attributes
 *      (+ values/pages/tags/jobs), pinned charts, saved reports, skills,
 *      conversations, sync jobs, audit log.
 *
 *  Usage:
 *    POSTGRESQL_CONN=... node scripts/seed_all.cjs
 *  Assumes the schema (server/sql/01..12) is already applied to an EMPTY DB.
 *  Safe to re-run: it aborts if the "acme" account already exists.
 *
 *  Login after seeding:  owner@acme.test  /  Password123!
 * ========================================================================== */

const bcrypt = require("bcryptjs");
const { getPool } = require("./_db.cjs");

const pool = getPool({ max: 4 });

// ── helpers ────────────────────────────────────────────────────────────────
const q = (text, params) => pool.query(text, params);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const pick = (arr, i) => arr[i % arr.length];
const rint = (lo, hi, seed) => lo + ((seed * 2654435761) % (hi - lo + 1));

async function main() {
  const exists = await q("SELECT 1 FROM app.accounts WHERE slug = 'acme'");
  if (exists.rowCount) {
    console.log("Account 'acme' already exists - nothing seeded. (Teardown + reapply schema for a clean seed.)");
    return;
  }

  const pwHash = await bcrypt.hash("Password123!", 12);

  // ── Account ───────────────────────────────────────────────────────────────
  const acct = (await q(
    `INSERT INTO app.accounts (name, slug, plan, plan_expires_at, settings)
     VALUES ('Acme Group','acme','paid', NULL, '{"onboarded":true}')
     RETURNING id`
  )).rows[0].id;

  // ── Users ─────────────────────────────────────────────────────────────────
  const mkUser = async (email, name) =>
    (await q(
      `INSERT INTO app.users (account_id, email, password_hash, full_name, is_email_verified, last_login_at)
       VALUES ($1,$2,$3,$4,true, NOW()) RETURNING id`,
      [acct, email, pwHash, name]
    )).rows[0].id;
  const owner = await mkUser("owner@acme.test", "Olivia Owner");
  const admin = await mkUser("admin@acme.test", "Adam Admin");
  const viewer = await mkUser("viewer@acme.test", "Vera Viewer");
  // the account owner (always an admin everywhere)
  await q(`UPDATE app.accounts SET owner_user_id = $1 WHERE id = $2`, [owner, acct]);

  // ── Companies (workspaces) ────────────────────────────────────────────────
  const mkCompany = async (name, slug, ref, industry, website) =>
    (await q(
      `INSERT INTO app.companies (account_id, name, slug, capsuite_ref, industry, website, plan,
         interaction_service_company_id, interaction_service_synced_at, settings)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT plan FROM app.accounts WHERE id=$1), gen_random_uuid(), NOW(), '{}')
       RETURNING id, website, interaction_service_company_id`,
      [acct, name, slug, ref, industry, website]
    )).rows[0];
  const retail = await mkCompany("Acme Retail", "acme-retail", "acme_retail", "Retail", "https://shop.acme.test");
  const academy = await mkCompany("Acme Academy", "acme-academy", "acme_academy", "Education", "https://learn.acme.test");
  const companies = [
    { ...retail, name: "Acme Retail", ref: "acme_retail", commerce: "shopify" },
    { ...academy, name: "Acme Academy", ref: "acme_academy", commerce: "manual" },
  ];

  // ── Members (per-company roles → "selected view") ─────────────────────────
  // roles: admin (full + controls others) | contributor (view+edit where granted)
  //        | viewer (read-only). permissions JSONB = admin-set overrides.
  const mkMember = (cid, uid, role, perms = {}) =>
    q(`INSERT INTO app.company_members (account_id, company_id, user_id, role, permissions) VALUES ($1,$2,$3,$4,$5)`,
      [acct, cid, uid, role, JSON.stringify(perms)]);
  await mkMember(retail.id, owner, "admin");
  await mkMember(academy.id, owner, "admin");
  await mkMember(retail.id, admin, "admin");
  // a contributor whom the admin restricted: can edit campaigns/edm, view-only elsewhere
  await mkMember(academy.id, admin, "contributor", {
    resources: {
      campaigns: { view: true, edit: true },
      edm: { view: true, edit: true },
      segments: { view: true, edit: false },
      profiles: { view: true, edit: false },
      settings: { view: false, edit: false },
    },
  });
  await mkMember(retail.id, viewer, "viewer"); // viewer sees ONLY retail, read-only

  for (const co of companies) {
    await seedCompany(co, { owner, admin });
    console.log(`  ✓ seeded workspace: ${co.name}`);
  }

  console.log("\nDone. Login: owner@acme.test / Password123!");
}

// ── per-company seed ────────────────────────────────────────────────────────
async function seedCompany(co, users) {
  const cid = co.id;
  const ref = co.ref;
  const owner = users.owner;

  // config rows
  await q(
    `INSERT INTO app.company_report_config (company_id, created_by, capsuite_ref, url_domain)
     VALUES ($1,$2,$3,$4)`,
    [cid, owner, ref, co.website || ""]
  );
  await q(
    `INSERT INTO app.web_content_html_elements (company_id, created_by, capsuite_ref, url_pattern)
     VALUES ($1,$2,$3,$4)`,
    [cid, owner, ref, (co.website || "").replace(/^https?:\/\/(www\.)?/, "").split(".")[0]]
  );
  await q(
    `INSERT INTO app.settings (company_id, created_by, key, value, label)
     VALUES ($1,$2,'analyst_system_prompt',$3,'Analyst context')`,
    [cid, owner, `You are the CDP analyst for ${co.name}. Be concise and data-driven.`]
  );
  await q(
    `INSERT INTO app.user_preferences (user_id, company_id) VALUES ($1,$2)`,
    [owner, cid]
  );

  // ── Integrations (+ sync jobs + audit) ──────────────────────────────────
  const mkIntegration = async (type, config, secret) => {
    const fp = secret ? (await q(`SELECT app.credential_fingerprint($1) f`, [secret])).rows[0].f : null;
    const id = (await q(
      `INSERT INTO app.data_integrations
         (account_id, company_id, created_by, integration_type, config, credential_fingerprint,
          is_connected, last_connected_date, is_synced, last_synced_date)
       VALUES ($1,$2,$3,$4,$5,$6,true, NOW(), true, NOW()) RETURNING id`,
      [/* account */ (await q(`SELECT account_id FROM app.companies WHERE id=$1`, [cid])).rows[0].account_id,
        cid, owner, type, config, fp]
    )).rows[0].id;
    await q(
      `INSERT INTO app.integration_sync_jobs (company_id, integration_type, status, triggered_by, started_at, completed_at, records_synced)
       VALUES ($1,$2,'completed','manual', NOW()-INTERVAL '2 hours', NOW()-INTERVAL '1 hour', $3)`,
      [cid, type, 1200]
    );
    await q(
      `INSERT INTO app.integration_audit_log (company_id, integration_type, action, actor, detail)
       VALUES ($1,$2,'connected',$3,'Initial connection')`,
      [cid, type, owner]
    );
    return id;
  };
  await mkIntegration("googleAnalytics", { propertyId: `prop-${ref}`, propertyName: co.website }, `ga|${ref}`);
  await mkIntegration("googleSearchConsole", { siteUrl: co.website }, `gsc|${ref}`);
  if (co.commerce === "shopify") {
    await mkIntegration("shopify", { storeName: `${ref}.myshopify.com`, accessToken: "shpat_demo" }, `shopify|${ref}`);
  }
  // a queued + a running job so the Integrations sync panel shows activity
  await q(`INSERT INTO app.integration_sync_jobs (company_id, integration_type, status, triggered_by, started_at)
           VALUES ($1,'googleAnalytics','running','schedule', NOW()-INTERVAL '3 minutes')`, [cid]);

  // ── GA landing data ──────────────────────────────────────────────────────
  const sources = ["google / organic", "google / cpc", "facebook / paid", "(direct) / (none)", "newsletter / email"];
  const campaignsUtm = ["spring_sale", "brand_awareness", "retargeting", "(not set)"];
  const pages = ["/", "/products", "/pricing", "/about", "/contact", "/blog/getting-started"];
  const events = ["page_view", "session_start", "scroll", "form_start", "form_submit", "click", "file_download"];
  const countries = ["Hong Kong", "United States", "United Kingdom", "Singapore", "Australia"];

  for (let d = 0; d < 30; d++) {
    const date = ymd(daysAgo(d));
    await q(
      `INSERT INTO ga_landing.website_metrics (company_id, date, active_users, new_users, sessions, engaged_sessions, user_engagement_duration, page_views, capsuite_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cid, date, rint(80, 400, d + 1), rint(20, 120, d + 3), rint(120, 600, d + 5),
        rint(60, 300, d + 7), rint(4000, 20000, d + 9), rint(300, 1500, d + 11), ref]
    );
    for (let c = 0; c < countries.length; c++) {
      await q(
        `INSERT INTO ga_landing.country_performance (company_id, date, country, active_users, new_users, bounce_rate, engagement_rate, average_session_duration, sessions, capsuite_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [cid, date, countries[c], rint(10, 120, d + c), rint(5, 60, d + c + 1),
          0.3 + (c % 4) * 0.1, 0.5 + (c % 3) * 0.1, 40 + c * 12, rint(20, 200, d + c + 2), ref]
      );
    }
  }
  // UTM daily performance (drives Campaigns → Analytics)
  for (let d = 0; d < 14; d++) {
    const date = ymd(daysAgo(d));
    for (let s = 0; s < sources.length; s++) {
      const [src, med] = sources[s].split(" / ");
      await q(
        `INSERT INTO ga_landing.utm_daily_performance
           (company_id, date, session_source, session_medium, session_campaign_name, country, device,
            active_users, new_users, bounce_rate, engagement_rate, average_session_duration, sessions, capsuite_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [cid, date, src, med, pick(campaignsUtm, d + s), pick(countries, s), pick(["desktop", "mobile", "tablet"], s),
          rint(20, 150, d + s), rint(8, 60, d + s + 1), 0.25 + (s % 4) * 0.08, 0.55 + (s % 3) * 0.1,
          50 + s * 10, rint(30, 200, d + s + 2), ref]
      );
    }
  }
  // UTM daily full-param performance (drives the Analytics tab + distinct links)
  const utmContents = ["logolink", "textlink", "banner_top", "(not set)"];
  const utmTerms    = ["running+shoes", "discount", "free+trial", "(not set)"];
  for (let d = 0; d < 14; d++) {
    const date = ymd(daysAgo(d));
    for (let s = 0; s < sources.length; s++) {
      const [src, med] = sources[s].split(" / ");
      const utmId = `utm_${1000 + (s % 4)}`;
      await q(
        `INSERT INTO ga_landing.utm_daily_full_param_performance
           (company_id, date, session_source, session_medium, session_campaign_name, session_content, session_term,
            session_utm_id, country, device,
            active_users, new_users, bounce_rate, engagement_rate, average_session_duration, sessions, capsuite_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [cid, date, src, med, pick(campaignsUtm, d + s), pick(utmContents, d + s), pick(utmTerms, d + s + 1),
          utmId, pick(countries, s), pick(["desktop", "mobile", "tablet"], s),
          rint(20, 150, d + s), rint(8, 60, d + s + 1), 0.25 + (s % 4) * 0.08, 0.55 + (s % 3) * 0.1,
          50 + s * 10, rint(30, 200, d + s + 2), ref]
      );
    }
  }
  // UTM daily performance by UTM ID
  for (let d = 0; d < 14; d++) {
    const date = ymd(daysAgo(d));
    for (let u = 0; u < 4; u++) {
      await q(
        `INSERT INTO ga_landing.utm_daily_utm_id_performance
           (company_id, date, session_utm_id, active_users, new_users, bounce_rate, engagement_rate,
            average_session_duration, sessions, capsuite_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [cid, date, `utm_${1000 + u}`, rint(15, 120, d + u), rint(5, 50, d + u + 1),
          0.25 + (u % 4) * 0.08, 0.55 + (u % 3) * 0.1, 50 + u * 10, rint(25, 180, d + u + 2), ref]
      );
    }
  }
  // page metrics + keyword (GSC) + event list
  for (let p = 0; p < pages.length; p++) {
    await q(
      `INSERT INTO ga_landing.page_metrics (company_id, date, page_path, active_users, new_users, engagement_rate, page_views, sessions, engaged_sessions, capsuite_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [cid, ymd(daysAgo(1)), pages[p], rint(40, 300, p + 1), rint(10, 100, p + 2), 0.5 + (p % 3) * 0.1,
        rint(80, 900, p + 3), rint(60, 500, p + 4), rint(40, 300, p + 5), ref]
    );
  }
  const keywords = ["acme shop", "acme pricing", "buy acme online", "acme reviews", "acme vs competitor", "acme academy course"];
  for (let k = 0; k < keywords.length; k++) {
    await q(
      `INSERT INTO ga_landing.keyword_performance (company_id, query, date, clicks, impressions, ctr, position, rank_by_impressions, rank_by_clicks, capsuite_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [cid, keywords[k], ymd(daysAgo(1)), rint(5, 200, k + 1), rint(100, 5000, k + 2),
        0.02 + (k % 5) * 0.01, 1 + k, k + 1, k + 1, ref]
    );
  }
  for (let e = 0; e < events.length; e++) {
    await q(
      `INSERT INTO ga_landing.event_list (company_id, date, event_name, is_key_event, capsuite_ref)
       VALUES ($1,$2,$3,$4,$5)`,
      [cid, ymd(daysAgo(1)), events[e], e >= 4 ? "true" : "false", ref]
    );
  }

  // ── Path exploration events + anonymous visitors ─────────────────────────
  const visitorIds = Array.from({ length: 12 }, (_, i) => `${ref}_apid_${1000 + i}`);
  for (let v = 0; v < visitorIds.length; v++) {
    const apid = visitorIds[v];
    const evCount = rint(4, 24, v + 1);
    for (let e = 0; e < evCount; e++) {
      const dd = daysAgo(rint(0, 29, v + e + 1));
      await q(
        `INSERT INTO ga_landing.path_exploration
           (company_id, event_name, date_hour_minute, date, page_location, page_referrer,
            session_source_medium, session_campaign_name, capsuite_apid, capsuite_sid, capsuite_ref, property_name)
         VALUES ($1,$2,$3,$4,$5,'',$6,$7,$8,$9,$10,$11)`,
        [cid, pick(events, v + e), dd, ymd(dd), (co.website || "https://x") + pick(pages, v + e),
          pick(sources, v + e), pick(campaignsUtm, v + e), apid, `${ref}_sid_${v}`, ref, co.website]
      );
    }
  }
  // first 8 visitors are anonymous; last 4 will resolve to customers below
  for (let v = 0; v < visitorIds.length; v++) {
    const apid = visitorIds[v];
    await q(
      `INSERT INTO app.anonymous_profiles
         (company_id, visitor_id, first_seen, last_seen, total_events, page_views, sessions,
          form_starts, form_completes, top_source_medium, top_campaign, source_mediums, campaigns, events, pages_visited)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [cid, apid, daysAgo(29 - v), daysAgo(rint(0, 5, v + 1)),
        rint(5, 40, v + 1), rint(3, 25, v + 2), rint(1, 6, v + 3),
        rint(0, 3, v + 4), rint(0, 2, v + 5), pick(sources, v), pick(campaignsUtm, v),
        [pick(sources, v), pick(sources, v + 1)], [pick(campaignsUtm, v)],
        [pick(events, v), pick(events, v + 1)], [pick(pages, v), pick(pages, v + 1)]]
    );
  }

  // ── Source membership (shopify or manual) + products + sales ─────────────
  const firstNames = ["Alex", "Bella", "Chris", "Dana", "Evan", "Fiona", "George", "Hana", "Ian", "Jess"];
  const lastNames = ["Wong", "Smith", "Lee", "Patel", "Chan", "Garcia", "Kim", "Brown", "Lam", "Ng"];
  const memberCount = 10;
  // Shopify-commerce members live in the neutral commerce layer (what the DAGs
  // build and the app reads); manual members in the manual schema.
  const memPrefix = co.commerce === "shopify" ? "cust" : "man";

  let manualBatch = null;
  if (co.commerce === "manual") {
    manualBatch = (await q(
      `INSERT INTO manual.upload_batches (company_id, uploaded_by, entity_type, file_name, row_count)
       VALUES ($1,$2,'membership','members_import.csv',$3) RETURNING id`,
      [cid, owner, memberCount]
    )).rows[0].id;
  }

  const members = [];
  for (let m = 0; m < memberCount; m++) {
    const memberId = `${ref}_${memPrefix}_${100 + m}`;
    const fn = pick(firstNames, m), ln = pick(lastNames, m);
    const email = `${fn}.${ln}${m}@example.com`.toLowerCase();
    const phone = `8520000${String(1000 + m)}`;
    const optEmail = m % 4 !== 0;
    const joinDate = daysAgo(rint(30, 400, m + 1));
    const common = {
      memberId, email, phone, fn, ln, optEmail, joinDate,
      ageGroup: pick(["18-24", "25-34", "35-44", "45-54"], m),
      gender: pick(["male", "female"], m),
      nationality: pick(countries, m),
    };
    members.push(common);

    if (co.commerce === "shopify") {
      await q(
        `INSERT INTO commerce.customer
           (customer_id, company_id, capsuite_ref, source_platform, source_id, customer_no,
            join_date, last_update, customer_type, has_email, primary_email, has_phone, primary_phone,
            first_name, last_name, full_name, display_name, is_opt_in_email, is_opt_in_sms)
         VALUES ($1,$2,$3,'shopify',$4,$5,$6,$6,'Customer',true,$7,true,$8,$9,$10,$11,$11,$12,$13)`,
        [memberId, cid, ref, String(100 + m), `NO${100 + m}`, joinDate, email, phone,
          fn, ln, `${fn} ${ln}`, optEmail, m % 3 === 0]
      );
    } else {
      await q(
        `INSERT INTO manual.membership
           (member_id, company_id, upload_batch_id, member_no, member_join_date, member_reg_channel, member_type,
            has_email, primary_email, has_phone, primary_phone, gender, nationality, age_group,
            eng_first_name, eng_last_name, eng_full_name, display_name, is_opt_in_email, is_opt_in_sms,
            preferred_channel, preferred_language, anonymous_id, capsuite_ref)
         VALUES ($1,$2,$3,$4,$5,'manual','Customer',true,$6,true,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,'email','en',$16,$17)`,
        [memberId, cid, manualBatch, `NO${100 + m}`, joinDate, email, phone, common.gender, common.nationality,
          common.ageGroup, fn, ln, `${fn} ${ln}`, optEmail, m % 3 === 0,
          m < 4 ? visitorIds[8 + (m % 4)] : null, ref] // some manual rows carry an anonymous_id
      );
    }
  }

  // products (a handful) + sales for ~6 members
  const prods = [];
  for (let p = 0; p < 6; p++) {
    const pid = co.commerce === "shopify" ? `${ref}_product_${10 + p}` : `${ref}_prod_${10 + p}`;
    prods.push(pid);
    const cat = pick(["Apparel", "Accessories", "Footwear", "Courses"], p);
    if (co.commerce === "shopify") {
      await q(
        `INSERT INTO commerce.product (product_id, company_id, capsuite_ref, source_platform, source_id,
           product_sku, product_name, category, product_type, price)
         VALUES ($1,$2,$3,'shopify',$4,$5,$6,$7,'product',$8)`,
        [pid, cid, ref, String(10 + p), `SKU-${10 + p}`, `${cat} Item ${p + 1}`, cat, 100 + p * 25]
      );
    } else {
      await q(
        `INSERT INTO manual.product (prod_id, company_id, prod_sku, prod_name, prod_category, prod_type, prod_price, capsuite_ref)
         VALUES ($1,$2,$3,$4,$5,'product',$6,$7)`,
        [pid, cid, `SKU-${10 + p}`, `${cat} Item ${p + 1}`, cat, 100 + p * 25, ref]
      );
    }
  }
  for (let m = 0; m < 6; m++) {
    const member = members[m];
    const orders = rint(1, 4, m + 1);
    for (let o = 0; o < orders; o++) {
      const trxnId = co.commerce === "shopify" ? `${ref}_order_${m}_${o}` : `${ref}_trxn_${m}_${o}`;
      const amt = 100 + rint(0, 500, m + o + 1);
      const date = daysAgo(rint(1, 120, m + o + 2));
      if (co.commerce === "shopify") {
        await q(
          `INSERT INTO commerce."order" (order_id, company_id, capsuite_ref, source_platform, source_id,
             customer_id, order_ref, channel, order_date, order_year, order_month, order_day, order_week,
             net_amount, currency, exchange_rate, order_status)
           VALUES ($1,$2,$3,'shopify',$4,$5,$6,'web',$7::timestamptz,
                   EXTRACT(YEAR  FROM $7::timestamptz)::int, EXTRACT(MONTH FROM $7::timestamptz)::int,
                   EXTRACT(DAY   FROM $7::timestamptz)::int, EXTRACT(WEEK  FROM $7::timestamptz)::int,
                   $8,'HKD',1,'completed')`,
          [trxnId, cid, ref, `${m}_${o}`, member.memberId, `#${1000 + m * 10 + o}`, date, amt]
        );
        await q(
          `INSERT INTO commerce.order_line (order_line_id, company_id, capsuite_ref, source_platform,
             order_id, customer_id, order_date, line_type, product_id, product_name, product_type,
             qty, qty_ordered, unit_price_net, unit_price_gross, currency, channel)
           VALUES ($1,$2,$3,'shopify',$4,$5,$6,'line_item',$7,$8,'Apparel',1,1,$9,$9,'HKD','web')`,
          [`${ref}_orderline_${m}_${o}_0`, cid, ref, trxnId, member.memberId, date,
            pick(prods, m + o), `Item ${m}`, amt]
        );
      } else {
        const batch = (await q(
          `INSERT INTO manual.upload_batches (company_id, uploaded_by, entity_type, file_name, row_count)
           VALUES ($1,$2,'sale','orders.csv',1) RETURNING id`, [cid, owner])).rows[0].id;
        await q(
          `INSERT INTO manual.sale (trxn_id, company_id, upload_batch_id, member_id, trxn_ref, trxn_date,
             trxn_original_net_amt, trxn_original_net_currency, trxn_order_status, capsuite_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'HKD','completed',$8)`,
          [trxnId, cid, batch, member.memberId, `#${1000 + m * 10 + o}`, date, amt, ref]
        );
      }
    }
  }

  // ── Unified customer profiles + identity map ─────────────────────────────
  for (let m = 0; m < members.length; m++) {
    const member = members[m];
    // aggregate commerce
    const agg = (await q(
      co.commerce === "shopify"
        ? `SELECT COUNT(*) n, COALESCE(SUM(net_amount),0) spend,
                  MIN(order_date) first_o, MAX(order_date) last_o
           FROM commerce."order" WHERE company_id=$1 AND customer_id=$2`
        : `SELECT COUNT(*) n, COALESCE(SUM(trxn_original_net_amt),0) spend,
                  MIN(trxn_date) first_o, MAX(trxn_date) last_o
           FROM manual.sale WHERE company_id=$1 AND member_id=$2`,
      [cid, member.memberId]
    )).rows[0];
    const resolvedApid = co.commerce === "manual" && m < 4 ? visitorIds[8 + (m % 4)] : null;

    await q(
      `INSERT INTO app.customer_profiles
         (company_id, member_id, member_source, capsuite_ref, primary_email, eng_first_name, eng_last_name,
          eng_full_name, display_name, member_no, member_join_date, member_reg_channel, member_type,
          gender, age_group, nationality, has_email, has_phone, primary_phone, preferred_language,
          preferred_channel, is_opt_in_email, is_opt_in_sms, order_count, total_spend, first_order_date,
          last_order_date, is_manual, ga_visitor_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,'Customer',$12,$13,$14,true,true,$15,'en','email',$16,$17,$18,$19,$20,$21,$22,$23)`,
      [cid, member.memberId, co.commerce, ref, member.email, member.fn, member.ln, `${member.fn} ${member.ln}`,
        `NO${100 + m}`, member.joinDate, co.commerce, member.gender, member.ageGroup, member.nationality,
        member.phone, member.optEmail, m % 3 === 0, Number(agg.n), Number(agg.spend), agg.first_o, agg.last_o,
        co.commerce === "manual", resolvedApid ? [resolvedApid] : []]
    );

    // identities: email, phone, source member_id, and anonymous link if any
    const mkIdent = (type, val, src, srcId, primary = false) =>
      q(`INSERT INTO app.profile_identities (company_id, member_id, source, source_id, identity_type, identity_value, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [cid, member.memberId, src, srcId, type, val, primary]);
    await mkIdent("email", member.email, co.commerce, member.memberId, true);
    await mkIdent("phone", member.phone, co.commerce, member.memberId);
    await mkIdent("member_id", member.memberId, co.commerce, member.memberId);
    if (resolvedApid) {
      await mkIdent("anonymous_id", resolvedApid, "ga", resolvedApid);
      await q(`UPDATE app.anonymous_profiles SET resolved_member_id=$1, resolved_at=NOW()
               WHERE company_id=$2 AND visitor_id=$3`, [member.memberId, cid, resolvedApid]);
    }
  }

  // ── Segments (customer + anonymous) ──────────────────────────────────────
  const seg = async (name, type, crit, size) =>
    (await q(
      `INSERT INTO app.segments (company_id, created_by, visibility, name, description, segment_type, status, estimated_size, daily_refresh, filter_criteria)
       VALUES ($1,$2,'company',$3,$4,$5,'active',$6,true,$7) RETURNING id`,
      [cid, owner, name, `${name} for ${co.name}`, type, size, crit]
    )).rows[0].id;
  const segHighValue = await seg("High-Value Customers", "customer", { total_spend: { op: ">=", value: 300 } }, 4);
  await seg("Email Opt-in", "customer", { is_opt_in_email: true }, 7);
  await seg("Engaged Visitors", "anonymous_profile", { page_views: { op: ">=", value: 10 } }, 6);

  // ── UTM Campaigns ────────────────────────────────────────────────────────
  const utmNames = ["Spring Sale 2026", "Brand Awareness Q1", "Retargeting - Cart", "Newsletter Promo"];
  const utmIds = [];
  for (let i = 0; i < utmNames.length; i++) {
    const id = (await q(
      `INSERT INTO app.campaigns (company_id, created_by, visibility, name, status, base_url, utm_source, utm_medium, utm_campaign, utm_content)
       VALUES ($1,$2,'company',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [cid, owner, utmNames[i], pick(["active", "active", "paused", "completed"], i), co.website || "https://acme.test",
        pick(["google", "facebook", "newsletter", "google"], i), pick(["cpc", "paid", "email", "organic"], i),
        pick(campaignsUtm, i), `variant_${i}`]
    )).rows[0].id;
    utmIds.push(id);
  }

  // ── EDM ──────────────────────────────────────────────────────────────────
  const tpl = (await q(
    `INSERT INTO app.edm_templates (company_id, created_by, visibility, name, subject, preview_text, html_body, status, variables)
     VALUES ($1,$2,'company','Welcome Template','Welcome to ' || $3,'Glad you are here',
       '<h1>Welcome {{first_name}}</h1><p>Thanks for joining ' || $3 || '.</p>','published','["first_name"]')
     RETURNING id`,
    [cid, owner, co.name]
  )).rows[0].id;
  await q(
    `INSERT INTO app.edm_templates (company_id, created_by, visibility, name, subject, html_body, status)
     VALUES ($1,$2,'company','Promo Template','{{discount}} off this week','<h1>Sale!</h1>','published')`,
    [cid, owner]
  );

  const edmStatuses = ["sent", "sent", "scheduled", "draft"];
  for (let i = 0; i < edmStatuses.length; i++) {
    const status = edmStatuses[i];
    const ec = (await q(
      `INSERT INTO app.edm_campaigns
         (company_id, created_by, visibility, name, subject, from_name, from_email, template_id, segment_id,
          utm_campaign_id, html_body, status, scheduled_at, sent_at, total_recipients)
       VALUES ($1,$2,'company',$3,$4,$5,$6,$7,$8,$9,'<h1>Hi</h1>',$10,$11,$12,$13) RETURNING id`,
      [cid, owner, `Campaign ${i + 1} - ${co.name}`, pick(["Big news!", "Just for you", "Last chance", "Hello"], i),
        co.name, `news@${ref}.test`, tpl, segHighValue, pick(utmIds, i),
        status, status === "scheduled" ? daysAgo(-2) : null, status === "sent" ? daysAgo(i + 1) : null,
        status === "sent" ? 4 : 0]
    )).rows[0].id;

    if (status === "sent") {
      const recips = (await q(
        `SELECT member_id, primary_email FROM app.customer_profiles
         WHERE company_id=$1 AND is_opt_in_email=true LIMIT 4`, [cid]
      )).rows;
      for (let r = 0; r < recips.length; r++) {
        const send = (await q(
          `INSERT INTO app.edm_sends (company_id, edm_campaign_id, email, member_id, status, sent_at)
           VALUES ($1,$2,$3,$4,'delivered',$5) RETURNING id`,
          [cid, ec, recips[r].primary_email, recips[r].member_id, daysAgo(i + 1)]
        )).rows[0].id;
        await q(`INSERT INTO app.edm_events (company_id, edm_campaign_id, send_id, email, event_type)
                 VALUES ($1,$2,$3,$4,'delivered')`, [cid, ec, send, recips[r].primary_email]);
        if (r % 2 === 0)
          await q(`INSERT INTO app.edm_events (company_id, edm_campaign_id, send_id, email, event_type)
                   VALUES ($1,$2,$3,$4,'open')`, [cid, ec, send, recips[r].primary_email]);
        if (r % 3 === 0)
          await q(`INSERT INTO app.edm_events (company_id, edm_campaign_id, send_id, email, event_type, link_url)
                   VALUES ($1,$2,$3,$4,'click',$5)`, [cid, ec, send, recips[r].primary_email, co.website]);
      }
    }
  }
  // suppression (incl. one manual upload)
  await q(`INSERT INTO app.edm_suppression (company_id, created_by, email, reason, is_manual)
           VALUES ($1,$2,'bounced@example.com','bounced',false),
                  ($1,$2,'unsub@example.com','unsubscribed',false),
                  ($1,$2,'donotmail@example.com','manual',true)`, [cid, owner]);
  // automation
  const auto = (await q(
    `INSERT INTO app.edm_automations (company_id, created_by, visibility, name, trigger_type, status, segment_id)
     VALUES ($1,$2,'company','Welcome Series','segment_entry','active',$3) RETURNING id`,
    [cid, owner, segHighValue]
  )).rows[0].id;
  const step1 = (await q(
    `INSERT INTO app.edm_automation_steps (company_id, automation_id, created_by, step_order, step_type, step_config)
     VALUES ($1,$2,$3,0,'send_email',$4) RETURNING id`,
    [cid, auto, owner, JSON.stringify({ template_id: tpl })]
  )).rows[0].id;
  await q(`INSERT INTO app.edm_automation_steps (company_id, automation_id, created_by, step_order, step_type, step_config)
           VALUES ($1,$2,$3,1,'wait',$4)`, [cid, auto, owner, JSON.stringify({ wait_hours: 48 })]);
  await q(`INSERT INTO app.edm_automation_enrollments (company_id, automation_id, email, current_step_id, status)
           SELECT $1,$2, primary_email, $3, 'active' FROM app.customer_profiles WHERE company_id=$1 LIMIT 2`,
    [cid, auto, step1]);

  // ── Popups (+ interaction mirror) ────────────────────────────────────────
  await q(`INSERT INTO app.popup_templates (company_id, created_by, name, category, description, content, is_builtin)
           VALUES ($1,$2,'Lead Gen Modal','Lead Gen','Collect emails','<div>Subscribe</div>',true),
                  ($1,$2,'Promo Banner','Promotion','Top banner','<div>Sale</div>',true)`, [cid, owner]);
  // interaction-service mirror: one service company per workspace
  const isCompanyId = co.interaction_service_company_id;
  await q(`INSERT INTO interaction.companies (id, cdp_company_id, name) VALUES ($1,$2,$3)`,
    [isCompanyId, cid, co.name]);

  const popups = [];
  for (let i = 0; i < 3; i++) {
    const refId = `${ref}_pop_${i}`;
    const itype = pick(["banner", "modal", "slide_in"], i);
    const p = (await q(
      `INSERT INTO app.popups (company_id, created_by, name, interaction_service_id, interaction_type, cdp_reference_id, segment_id, content, is_active, status, start_time)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, $5, $6, '<div>Hi</div>', $7, $8, NOW()-INTERVAL '10 days') RETURNING id, interaction_service_id`,
      [cid, owner, `Popup ${i + 1}`, itype, refId,
        i === 0 ? segHighValue : null, i < 2, pick(["active", "active", "draft"], i)]
    )).rows[0];
    popups.push(p);
    // mirror interaction (id = service interaction id; cdp_reference_id ↔ the popup)
    await q(`INSERT INTO interaction.interactions (id, company_id, cdp_reference_id, name, interaction_type, status)
             VALUES ($1,$2,$3,$4,$5,'active')`,
      [p.interaction_service_id, isCompanyId, refId, `Popup ${i + 1}`, itype]);
    // activities: retrieve_interaction (impression) / click / close / email_collection
    for (let a = 0; a < 20; a++) {
      const action = a % 7 === 0 ? "email_collection"
                   : a % 3 === 0 ? "click_interaction"
                   : a % 5 === 0 ? "close_interaction"
                   : "retrieve_interaction";
      await q(
        `INSERT INTO interaction.activities (correlated_interaction_id, capsuite_sid, capsuite_apid, action, page_url, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [p.interaction_service_id, `${ref}_sid_${a}`, pick(visitorIds, a + i), action,
          (co.website || "") + pick(pages, a), daysAgo(rint(0, 9, a + i + 1))]
      );
    }
  }
  await q(`INSERT INTO interaction.sync_state (company_id, entity, last_synced_at, status)
           VALUES ($1,'interactions',NOW(),'idle'),($1,'activities',NOW(),'idle'),($1,'customers',NOW(),'idle')`, [cid]);
  // collected emails (leads) - some create profiles
  for (let i = 0; i < 8; i++) {
    const apid = pick(visitorIds, i);
    await q(
      `INSERT INTO app.popup_email_collected
         (company_id, popup_id, popup_name, popup_ref, email, first_name, source_url, visitor_id, utm_source, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'google',$9)`,
      [cid, popups[i % popups.length].id, `Popup ${(i % 3) + 1}`, `${ref}_pop_${i % 3}`,
        `lead${i}@example.com`, pick(firstNames, i), (co.website || "") + "/landing", apid,
        pick(["new", "new", "contacted", "converted"], i)]
    );
    await q(`INSERT INTO interaction.customers (company_id, capsuite_apid, email, first_name, created_at)
             VALUES ($1,$2,$3,$4, NOW()-INTERVAL '5 days')`,
      [isCompanyId, apid, `lead${i}@example.com`, pick(firstNames, i)]);
  }

  // ── Attributes (+ values + pages + tags + jobs) ──────────────────────────
  const attrDefs = [
    { name: "Product Interest", source: "web_content", values: ["Apparel", "Footwear", "Accessories"] },
    { name: "Study Intent", source: "web_content", values: ["High", "Medium", "Low"] },
    { name: "Lifecycle Stage", source: "rule", values: ["New", "Active", "At Risk"] },
  ];
  for (let a = 0; a < attrDefs.length; a++) {
    const def = attrDefs[a];
    const attrId = (await q(
      `INSERT INTO app.attributes (company_id, created_by, name, description, source, value_type, status, scope)
       VALUES ($1,$2,$3,$4,$5,'multi','active','both') RETURNING id`,
      [cid, owner, def.name, `Auto: ${def.name}`, def.source]
    )).rows[0].id;
    const valIds = [];
    for (let v = 0; v < def.values.length; v++) {
      const vid = (await q(
        `INSERT INTO app.attribute_values (company_id, attribute_id, value, display_label, is_approved, profile_count)
         VALUES ($1,$2,$3,$3,true,$4) RETURNING id`,
        [cid, attrId, def.values[v], rint(1, 8, a + v + 1)]
      )).rows[0].id;
      valIds.push(vid);
    }
    // tag some customer profiles + anonymous visitors
    const cust = (await q(`SELECT member_id FROM app.customer_profiles WHERE company_id=$1 LIMIT 5`, [cid])).rows;
    for (let c = 0; c < cust.length; c++) {
      await q(
        `INSERT INTO app.profile_attribute_values (company_id, entity_type, entity_id, attribute_id, attribute_value_id, source, score)
         VALUES ($1,'customer',$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [cid, cust[c].member_id, attrId, pick(valIds, c), def.source, rint(1, 5, c + 1)]
      );
    }
    for (let v = 0; v < 4; v++) {
      await q(
        `INSERT INTO app.profile_attribute_values (company_id, entity_type, entity_id, attribute_id, attribute_value_id, source, score)
         VALUES ($1,'anonymous',$2,$3,$4,$5,1) ON CONFLICT DO NOTHING`,
        [cid, visitorIds[v], attrId, pick(valIds, v), def.source]
      );
    }
    // a completed job per attribute
    await q(
      `INSERT INTO app.attribute_jobs (company_id, attribute_id, job_type, status, phase, started_at, completed_at, progress)
       VALUES ($1,$2,$3,'completed','done', NOW()-INTERVAL '1 hour', NOW()-INTERVAL '50 minutes', $4)`,
      [cid, attrId, def.source === "rule" ? "rule" : "behavioral", JSON.stringify({ tagged: 9, pages: 6 })]
    );
  }
  // web pages (valid + excluded, some manual)
  for (let p = 0; p < pages.length; p++) {
    await q(
      `INSERT INTO app.web_pages (company_id, url, title, excerpt, word_count, is_valid, is_excluded, is_manual, fetch_method, last_crawled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'http', NOW()-INTERVAL '1 day')`,
      [cid, (co.website || "https://acme.test") + pages[p], `Page ${pages[p]}`, "Sample content excerpt",
        rint(80, 800, p + 1), p !== 5, p === 5, p % 4 === 0]
    );
  }

  // ── Dashboard charts, reports, skills, conversations ─────────────────────
  const charts = [
    { t: "Traffic by Source", ty: "pie" },
    { t: "Daily Sessions", ty: "line" },
    { t: "Top Pages", ty: "bar" },
    { t: "Email Opens", ty: "area" },
  ];
  for (let c = 0; c < charts.length; c++) {
    await q(
      `INSERT INTO app.pinned_charts (company_id, created_by, visibility, title, chart_type, chart_config, description, last_refreshed)
       VALUES ($1,$2,'company',$3,$4,$5,$6, NOW())`,
      [cid, owner, charts[c].t, charts[c].ty, JSON.stringify({ source: "ga_landing", metric: "sessions" }), `Auto chart: ${charts[c].t}`]
    );
  }
  await q(
    `INSERT INTO app.saved_reports (company_id, created_by, visibility, title, content, tags)
     VALUES ($1,$2,'company','Monthly Performance','# Monthly Performance\n\nSessions are trending up.', '{"monthly","ga"}'),
            ($1,$2,'company','Segment Health','# Segment Health\n\nHigh-value segment grew 12%.', '{"segments"}')`,
    [cid, owner]
  );
  await q(
    `INSERT INTO app.skills (company_id, created_by, name, description, content, type)
     VALUES ($1,$2,'Brand Voice','Tone guidelines','Friendly, concise, data-led.','context'),
            ($1,$2,'Campaign Brief','Template for briefs','Audience / Goal / Offer / CTA','template')`,
    [cid, owner]
  );
  await q(
    `INSERT INTO app.conversations (company_id, created_by, visibility, title, messages)
     VALUES ($1,$2,'private','Who are my best customers?', $3)`,
    [cid, owner, JSON.stringify([
      { role: "user", content: "Who are my best customers?", created_date: daysAgo(2) },
      { role: "assistant", content: "Your High-Value Customers segment has the top spenders.", created_date: daysAgo(2) },
    ])]
  );

  // usage + data dictionary (Settings→Billing usage bars, Analyst dictionary)
  await q(`INSERT INTO app.usage_events (company_id, user_id, event_type, quantity)
           VALUES ($1,$2,'ai_token',1200),($1,$2,'ai_token',800),($1,$2,'profile_import',10)`, [cid, owner]);
  await q(`INSERT INTO app.data_dictionary (company_id, created_by, table_name, schema_name, description)
           VALUES ($1,$2,'customer_profiles','app','Unified customer golden records'),
                  ($1,$2,'path_exploration','ga_landing','Raw GA4 event log')`, [cid, owner]);

  // audit log - representative actions recorded via the helper
  const audit = (action, rtype, rid) =>
    q(`SELECT app.log_audit($1,$2,$3,$4,$5)`, [cid, owner, action, rtype, rid || null]);
  await audit("create", "workspace", cid);
  await audit("connect", "integration", "googleAnalytics");
  if (co.commerce === "manual") await audit("import", "upload", "members_import.csv");
  await audit("create", "segment", null);
  await audit("send", "edm_campaign", null);
  await audit("export", "profile", null);
}

main()
  .then(() => pool.end())
  .catch((e) => { console.error(e); pool.end(); process.exit(1); });
