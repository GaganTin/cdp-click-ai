// Shared slug helpers for tenancy roots (accounts, companies).
// Single source of truth so auth.js and company.js stay in sync.

// Lowercase, hyphenate non-alphanumerics, trim leading/trailing hyphens.
export function slugify(str) {
  return String(str ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Find a slug unique within `table.column` (case-insensitive), appending
// -1, -2, … on collision. `excludeId` skips a row when updating in place.
export async function uniqueSlug(
  pool,
  base,
  { table = "app.companies", column = "slug", fallback = "company", excludeId = null } = {}
) {
  const slug = slugify(base) || fallback;
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i}`;
    const { rows } = await pool.query(
      `SELECT id FROM ${table} WHERE LOWER(${column}) = LOWER($1) AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [candidate, excludeId]
    );
    if (!rows.length) return candidate;
  }
}
