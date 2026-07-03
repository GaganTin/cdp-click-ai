// Pure helpers for the GA Traffic Performance table (Campaigns / UTM page).
// Kept free of React/DOM so they can be unit-tested directly.

// Composite identity for a GA link row. MUST include every column the /links
// query groups by (session_source, medium, campaign) so that (a) row selection is
// unambiguous and (b) the previous-period delta lookup matches the exact same
// grouped row. (content / term / utm_id were dropped with the GA cube redesign -
// no cube fetches them, so the /links grid no longer carries them.)
export function gaRowKey(row) {
  return [
    row.session_source,
    row.session_medium,
    row.session_campaign_name,
  ].map((v) => (v == null ? "" : String(v))).join("|");
}

// Relative % change of a metric vs the comparison period.
// Returns null when it can't be computed (non-finite inputs, prev = 0) or when it
// rounds to 0% (no badge shown for noise). Works for counts and 0..1 rate metrics.
export function gaDeltaPct(curr, prev) {
  const c = Number(curr);
  const p = Number(prev);
  if (!isFinite(c) || !isFinite(p) || p === 0) return null;
  const pct = ((c - p) / Math.abs(p)) * 100;
  if (!isFinite(pct) || Math.round(pct) === 0) return null;
  return pct;
}

// Distinct, sorted, non-empty string values of `key` across `rows` - used to
// populate the searchable dropdown filters from the data actually in the table.
export function distinctValues(rows, key) {
  const set = new Set();
  for (const r of rows || []) {
    const v = r?.[key];
    if (v != null && String(v).trim() !== "") set.add(String(v));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Does a row satisfy every active filter?
//  - array value  -> exact membership (multi-select dropdown); [] means "no filter"
//  - string value -> case-insensitive substring (legacy text filter)
export function rowMatchesFilters(row, filters) {
  for (const [key, val] of Object.entries(filters || {})) {
    if (Array.isArray(val)) {
      if (val.length && !val.includes(String(row[key] ?? ""))) return false;
    } else if (val) {
      if (!String(row[key] ?? "").toLowerCase().includes(String(val).toLowerCase())) return false;
    }
  }
  return true;
}
