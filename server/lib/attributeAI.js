// AI tagging for behavioral attributes.
// Given a crawled page and the set of active web_content attributes, asks the
// model which values apply. One call per page covers ALL attributes (cheap).
// Mirrors the Azure OpenAI wiring used in server/index.js.

import OpenAI from "openai";

// Lazy init: env is read on first use, NOT at import time. (This module is
// imported before index.js calls dotenv.config(), so reading env eagerly here
// would see empty values and wrongly report "AI not configured".)
// Attribute tagging/grouping/suggestions are NOT the analyst, so they run on the
// cheaper FAST model (falls back to the analyst model, then the nano default).
const deployment = () =>
  process.env.AZURE_OPENAI_DEPLOYMENT_FAST || process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-nano";

let _client = null;
function getClient() {
  if (_client) return _client;
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/$/, "");
  const key = process.env.AZURE_OPENAI_KEY || "";
  if (!key || !endpoint) return null;
  _client = new OpenAI({
    baseURL: `${endpoint}/openai/deployments/${deployment()}`,
    apiKey: key,
    defaultHeaders: { "api-key": key },
    defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview" },
    // Tagging runs many pages concurrently; lean on the SDK's built-in backoff
    // (honours Retry-After) so transient 429/5xx don't drop a page's tags.
    maxRetries: Math.max(2, Number(process.env.AZURE_OPENAI_MAX_RETRIES) || 5),
  });
  return _client;
}

export function isAIConfigured() {
  return !!getClient();
}

const MAX_CONTENT_CHARS = 6000;

// Hand the token split to an optional usage callback (used by callers to ledger
// AI cost). Never lets a tracking error break the tagging itself.
function reportUsage(onUsage, resp) {
  if (!onUsage || !resp?.usage) return;
  try {
    onUsage({
      input: resp.usage.prompt_tokens || 0,
      cached: resp.usage.prompt_tokens_details?.cached_tokens || 0,
      output: resp.usage.completion_tokens || 0,
      model: deployment(),
    });
  } catch { /* tracking is best-effort */ }
}

/**
 * Tag one page against a list of attributes.
 * @param {{title?:string, url?:string, content?:string}} page
 * @param {Array<{id:string, name:string, description:string, value_type:string, enumValues:string[]}>} attributes
 * @returns {Promise<Array<{attribute_id:string, values:string[]}>>}
 */
export async function tagPage(page, attributes, onUsage = null) {
  const client = getClient();
  if (!client) throw new Error("Azure OpenAI is not configured.");
  if (!attributes?.length) return [];

  // The URL slug is always a signal (e.g. .../university-of-essex-biomedical-science/),
  // so the title and URL are ALWAYS provided. The page body is only included when at
  // least one attribute needs it: "title" = look at title + URL only; "both"/"content"
  // = also read the body. Omitting the body for title-only runs saves tokens too.
  const anyContent = attributes.some((a) => a.extract_from !== "title");

  const fieldDocs = attributes.map((a) => {
    const kind = a.value_type === "single" ? "a single string" : "an array of strings";
    const sourceHint = a.extract_from === "title"
      ? " Look ONLY at the page title and URL."
      : a.extract_from === "content"
      ? " Look at the page URL and body, not the title."
      : " Look at the page title, URL, and body.";
    const enumHint = a.enumValues?.length
      ? ` Prefer these existing values when they fit: ${a.enumValues.slice(0, 60).join(", ")}.`
      : "";
    return `- "${a.name}": ${kind}.${sourceHint} ${a.description || ""}${enumHint} Return [] if nothing clearly matches.`;
  }).join("\n");

  const content = (page.content || "").slice(0, MAX_CONTENT_CHARS);

  const prompt = `You are tagging a web page with marketing attributes for a Customer Data Platform.
Read the page and, for EACH attribute, extract the values that genuinely appear in or are clearly the subject of the page. The URL slug often names the subject (product, place, topic) - use it. Do not guess or pad. Use the page's own wording.

ATTRIBUTES:
${fieldDocs}

PAGE TITLE: ${page.title || "(none)"}
PAGE URL: ${page.url || "(none)"}${anyContent ? `\nPAGE CONTENT:\n${content}` : ""}

Respond with a JSON object whose keys are the exact attribute names above and whose values are arrays of strings (use a single-element array for single-value attributes; use [] when nothing matches). Return ONLY the JSON object.`;

  const resp = await client.chat.completions.create({
    model: deployment(),
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 1200,
    // gpt-5 models only accept the default temperature (1); omit it.
  });

  reportUsage(onUsage, resp);

  let parsed = {};
  try {
    parsed = JSON.parse(resp.choices[0].message.content || "{}");
  } catch {
    parsed = {};
  }

  return attributes.map((a) => {
    let raw = parsed[a.name];
    if (typeof raw === "string") raw = raw.trim() ? [raw] : [];
    if (!Array.isArray(raw)) raw = [];
    const values = [...new Set(
      raw.map((v) => String(v ?? "").trim()).filter(Boolean)
    )];
    return {
      attribute_id: a.id,
      values: a.value_type === "single" ? values.slice(0, 1) : values.slice(0, 25),
    };
  });
}

/**
 * Group a list of values under a grouping dimension.
 * @param {string} groupLabel e.g. "Continent"
 * @param {string[]} values e.g. ["England", "Japan", "France"]
 * @returns {Promise<Record<string,string>>} { England: "Europe", Japan: "Asia", ... }
 */
export async function groupValues(groupLabel, values, onUsage = null) {
  const client = getClient();
  if (!client) throw new Error("Azure OpenAI is not configured.");
  if (!values?.length) return {};

  const prompt = `Group each value below by its "${groupLabel}".
Values: ${values.join(", ")}

Return ONLY a JSON object that maps each value (spelled exactly as given) to a concise ${groupLabel} name. Put anything that doesn't fit under "Other". Group names may be in English or Chinese to match the values.`;

  const resp = await client.chat.completions.create({
    model: deployment(),
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 1500,
    // gpt-5 models only accept the default temperature (1); omit it.
  });

  reportUsage(onUsage, resp);

  try {
    const parsed = JSON.parse(resp.choices[0].message.content || "{}");
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      const g = String(v ?? "").trim();
      if (g) out[k] = g;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Propose new targeting attributes by reading a sample of the site's pages.
 * @param {Array<{title?:string, url?:string, content?:string}>} pages sample crawled pages
 * @param {string[]} existing names of attributes that already exist (so we don't repeat them)
 * @returns {Promise<Array<{name:string, description:string, value_type:'single'|'multi', example_values:string[]}>>}
 */
export async function suggestAttributes(pages, existing = [], onUsage = null) {
  const client = getClient();
  if (!client) throw new Error("Azure OpenAI is not configured.");
  if (!pages?.length) return [];

  const sample = pages.slice(0, 12).map((p, i) => {
    const body = (p.content || "").replace(/\s+/g, " ").slice(0, 700);
    return `[${i + 1}] ${p.title || "(untitled)"} - ${p.url || ""}\n${body}`;
  }).join("\n\n");

  const avoid = existing.length ? `\nDo NOT propose any of these existing attributes: ${existing.join(", ")}.` : "";

  const prompt = `You design custom targeting attributes for a Customer Data Platform. Below are sample pages from a company's website. Propose 3-6 useful attributes a marketer could segment, pop-up, or email on - dimensions that vary meaningfully across these pages (e.g. Product Category, Topic, Country of Interest, Buyer Stage).${avoid}

For each attribute give:
- "name": a short title-case name
- "description": a one-sentence AI extraction instruction ("If any ... is found in the text, extract it.")
- "value_type": "multi" if a page can have several values, else "single"
- "example_values": 2-4 concrete example values you actually saw in the pages

SAMPLE PAGES:
${sample}

Return ONLY a JSON object of the form {"attributes":[{"name":...,"description":...,"value_type":...,"example_values":[...]}]}.`;

  const resp = await client.chat.completions.create({
    model: deployment(),
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 1500,
    // gpt-5 models only accept the default temperature (1); omit it.
  });

  reportUsage(onUsage, resp);

  try {
    const parsed = JSON.parse(resp.choices[0].message.content || "{}");
    const list = Array.isArray(parsed.attributes) ? parsed.attributes : [];
    const taken = new Set(existing.map((e) => e.toLowerCase()));
    return list
      .map((a) => ({
        name: String(a.name ?? "").trim(),
        description: String(a.description ?? "").trim(),
        value_type: a.value_type === "single" ? "single" : "multi",
        example_values: Array.isArray(a.example_values)
          ? [...new Set(a.example_values.map((v) => String(v ?? "").trim()).filter(Boolean))].slice(0, 6)
          : [],
      }))
      .filter((a) => a.name && !taken.has(a.name.toLowerCase()));
  } catch {
    return [];
  }
}
