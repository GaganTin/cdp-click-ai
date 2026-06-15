import jwt from "jsonwebtoken";

// ── Google service-account JWT → access token ─────────────────────────────────
async function getGoogleAccessToken(serviceAccountJson, scope) {
  const key =
    typeof serviceAccountJson === "string"
      ? JSON.parse(serviceAccountJson)
      : serviceAccountJson;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: key.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const signed = jwt.sign(claim, key.private_key, { algorithm: "RS256" });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signed,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Google token exchange failed: ${text}`);
  }

  const { access_token } = await resp.json();
  return access_token;
}

// ── Google Analytics 4 ────────────────────────────────────────────────────────
export async function testGoogleAnalytics({ propertyId, propertyName }) {
  const saJson = process.env.GA_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error("GA_SERVICE_ACCOUNT_JSON is not configured on the server.");

  const token = await getGoogleAccessToken(
    saJson,
    "https://www.googleapis.com/auth/analytics.readonly"
  );

  const startDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const resp = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: "today" }],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "activeUsers" }],
        limit: 1,
      }),
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    const msg = body?.error?.message || resp.statusText;
    if (resp.status === 403)
      throw new Error(
        `Access denied on Property ID ${propertyId}. Make sure the Property ID and URL are correct, then grant both service account emails the Editor role in GA Admin → Property access management.`
      );
    if (resp.status === 400)
      throw new Error(
        `Invalid Property ID "${propertyId}". Find it in GA Admin → Property Details (top-right corner).`
      );
    throw new Error(msg);
  }

  const data = await resp.json();
  if (!data.rowCount)
    throw new Error(
      "No data returned from GA in the last 7 days. The property may be new or have no traffic- if access was just granted, wait a few minutes and retry."
    );

  return { propertyId, propertyName };
}

// ── Google Search Console ─────────────────────────────────────────────────────
export async function testGoogleSearchConsole({ siteUrl }) {
  const saJson = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error("GSC_SERVICE_ACCOUNT_JSON is not configured on the server.");

  const token = await getGoogleAccessToken(
    saJson,
    "https://www.googleapis.com/auth/webmasters.readonly"
  );

  const startDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const endDate   = new Date().toISOString().slice(0, 10);
  const encoded   = encodeURIComponent(siteUrl);

  const resp = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startDate, endDate, dimensions: ["query"], rowLimit: 1 }),
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    const msg = body?.error?.message || resp.statusText;
    if (resp.status === 403)
      throw new Error(
        `Access denied for "${siteUrl}". Double-check that the Site URL is correct, then grant both service account emails Full permission in GSC Settings → Users and permissions.`
      );
    if (resp.status === 404)
      throw new Error(
        `Site "${siteUrl}" not found in Search Console. Use a trailing slash for URL-prefix (https://www.example.com/) or "sc-domain:example.com" for domain properties.`
      );
    throw new Error(msg);
  }

  const data = await resp.json();
  if (!data.rows?.length)
    throw new Error(
      "No search data found for the last 7 days. The site may have no impressions yet, or GSC data processing may be delayed."
    );

  return { siteUrl };
}

// ── Shopify ───────────────────────────────────────────────────────────────────
export async function testShopify({ storeName, accessToken }) {
  const resp = await fetch(
    `https://${storeName}.myshopify.com/admin/api/2024-04/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "{ shop { name } }" }),
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (resp.status === 401)
    throw new Error(
      "Invalid access token."
    );
  if (resp.status === 404)
    throw new Error(
      `Store "${storeName}" not found. Enter only the subdomain without .myshopify.com.`
    );
  if (!resp.ok)
    throw new Error(`Shopify API responded with status ${resp.status}.`);

  const { data, errors } = await resp.json();
  if (errors?.length) throw new Error(errors[0].message);
  if (!data?.shop?.name)
    throw new Error(
      "No store data returned. Verify API scopes include orders, products, and customers."
    );

  return { storeName };
}

// ── Dispatch: run the correct test by type ────────────────────────────────────
export async function runConnectionTest(type, config) {
  switch (type) {
    case "googleAnalytics":    return testGoogleAnalytics(config);
    case "googleSearchConsole": return testGoogleSearchConsole(config);
    case "shopify":             return testShopify(config);
    default:
      throw new Error(`No connection test available for integration type "${type}".`);
  }
}
