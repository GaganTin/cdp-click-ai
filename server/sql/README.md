# `server/sql/` - rebuilt CDP schema

A clean, modular, **account → workspace → member** multi-tenant schema that
replaces the old `server/schema.sql` + `auth_schema.sql` + `shopify_schema.sql`
trio and drops the `public.*` test data entirely.

> **Nothing here has been run.** These files are a proposal/build artifact. The
> live DB is Neon cloud - apply them deliberately (see below). They are written
> to run **once against an empty database**, not as idempotent startup migrations.

## Run order

| # | File | Schema(s) | What |
|---|------|-----------|------|
| 00 | `00_teardown.sql` | all | **DESTRUCTIVE** drop of app/manual/ga_landing/shopify/shopline/odoo/commerce/interaction/public. Gated behind `-v confirm=YES`. |
| 01 | `01_extensions.sql` | - | pgcrypto, the schemas, `set_updated_date()`, `credential_fingerprint()`, `url_decode()`, `norm_url()`. |
| 02 | `02_accounts_auth.sql` | app | plans, accounts, users, companies (workspaces), company_members, invitations, user_preferences, api_keys, audit_log, support_tickets. |
| 03 | `03_app_core.sql` | app | campaigns (UTM), segments, saved_reports, pinned_charts, chart_summaries, conversations, skills, settings, company_report_config, web_content_html_elements. |
| 04 | `04_edm.sql` | app | edm_templates / campaigns / sends / events / suppression / automations (+steps +enrollments). |
| 05 | `05_popups.sql` | app | popups, popup_templates, popup_email_collected. |
| 06 | `06_attributes.sql` | app | attributes, attribute_values, web_pages, page_attribute_values, profile_attribute_values, attribute_jobs. |
| 07 | `07_integrations.sql` | app | data_integrations (+credential fingerprint uniqueness), integration_sync_jobs, integration_audit_log. |
| 08 | `08_manual.sql` | manual | upload_batches, membership, sale, sale_order_line, product (Manual Upload source). |
| 09 | `09_ga_landing.sql` | ga_landing | path_exploration(+duration), utm_*_performance, page_*/country/website metrics, event_list, keyword_performance (GA + GSC). |
| 10 | `10_shopify.sql` | shopify | RAW Shopify landing, mirrors the DAG transforms 1:1: customer, "order", order_line, product(+detail/image), inventory_level, refund(+line), shopify_sync_control. |
| 11 | `11_interaction.sql` | interaction | local MIRROR of the interaction-service (interactions, customers, activities, sync_state). |
| 12 | `12_profiles_identity.sql` | app | **customer_profiles** (golden record), **profile_identities** (identity map), **anonymous_profiles**, profile_merge_candidates. |
| 14 | `14_commerce.sql` | commerce | NEUTRAL commerce layer combining shopify/shopline/odoo raw: customer, product(+detail/image), "order", order_line, inventory_level, refund(+line). What the app + AI analyst read. |

Then seed: `node scripts/seed_all.cjs`.

### Apply from scratch (psql)

```bash
psql "$POSTGRESQL_CONN" -v confirm=YES -f server/sql/00_teardown.sql
for f in server/sql/01_*.sql server/sql/02_*.sql server/sql/03_*.sql \
         server/sql/04_*.sql server/sql/05_*.sql server/sql/06_*.sql \
         server/sql/07_*.sql server/sql/08_*.sql server/sql/09_*.sql \
         server/sql/10_*.sql server/sql/11_*.sql server/sql/12_*.sql \
         server/sql/13_*.sql server/sql/14_*.sql; do
  psql "$POSTGRESQL_CONN" -v ON_ERROR_STOP=1 -f "$f"
done
node scripts/seed_all.cjs
```

## Key design points

- **Tenancy:** `app.accounts` (signup/billing root) → `app.companies` (workspaces,
  each with a unique `capsuite_ref` + its own `interaction_service_company_id`) →
  `app.company_members` (per-company role = which workspaces a user can see).
- **One schema per source:** `manual` (CSV upload), `ga_landing` (GA + GSC),
  `shopify` (commerce), `interaction` (local mirror of the microservice). All
  source tables are `company_id`-scoped - no data shared across workspaces.
- **Unified profile:** `app.customer_profiles` is the golden record;
  `app.profile_identities` maps it to every source (email / phone / member_id /
  anonymous_id), which is how manual membership, Shopify members, GA anonymous
  ids, and popup-collected emails resolve to one person.
- **Integration uniqueness:** `data_integrations` carries `account_id` +
  `credential_fingerprint`; a unique `(account_id, integration_type,
  credential_fingerprint)` index blocks reusing the same credentials in a second
  workspace of the same account.
- **Type fixes:** opt-in flags are native `BOOLEAN` (were TEXT);
  `pinned_charts.chart_config` is `JSONB` (was TEXT-holding-JSON).

## ⚠️ Companion code refactor still required

The server still reads the OLD tables (`public.membership`,
unscoped `ga_landing.*`, the global `refreshProfiles()` in `server/index.js`, and
the `initDb()` that loads the three old `.sql` files). Booting the app against
this schema requires:

1. Point `initDb()` at `server/sql/01..12` (or drop schema-on-boot and apply via
   the script above).
2. Rewrite `refreshProfiles()` to build per-company from `manual`/`shopify`/
   `ga_landing` + `profile_identities` instead of `public.*`.
3. Repoint `server/routes/popup.js`, `server/lib/attributeManual.js`,
   `server/mcp/tools/*.js`, `server/lib/webCrawler.js` to the new schemas and add
   `company_id` filters.
4. Add `account_id` resolution to auth + the per-company access checks.

This is intentionally **not** done yet (decision: "write scripts, don't run").
See `server/SCHEMA_CLEANUP_PLAN.md` §8 for the full list.
