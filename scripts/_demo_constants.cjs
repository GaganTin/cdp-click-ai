// Stable identifiers for the shared demo workspace, used by the seeders so the
// demo company keeps a fixed id / slug / capsuite_ref across reseeds (users'
// saved cdp_company_id stays valid). The server never needs these - it resolves
// the demo purely by the app.companies.is_demo flag (see server/lib/demoWorkspace.js).
module.exports = {
  // Valid v4-shaped UUID (hex only). Kept constant so reseeds preserve the id.
  DEMO_COMPANY_ID: "00000000-0000-4000-8000-000000000de0",
  DEMO_COMPANY_SLUG: "demo",
  DEMO_CAPSUITE_REF: "demo",
  DEMO_ACCOUNT_SLUG: "capsuite-demo",
};
