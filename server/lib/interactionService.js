/**
 * Shared helpers for the Interaction Service microservice.
 * Called at company creation time (registration + company.js) so every company
 * has an interaction_service_company_id from day one.
 */

const INTERACTION_SERVICE_URL =
  process.env.INTERACTION_SERVICE_URL || "http://localhost:8080";

/**
 * Registers a CDP company with the interaction service and persists the
 * returned ID to app.companies.interaction_service_company_id.
 *
 * Safe to call multiple times - the interaction service deduplicates by
 * cdpCompanyId and returns the existing record if it already exists.
 *
 * @param {import('pg').Pool} pool
 * @param {string} cdpCompanyId  UUID from app.companies.id
 * @param {string} companyName   Display name sent to the interaction service
 * @returns {Promise<string|null>} interaction service company UUID, or null on failure
 */
export async function registerCompanyWithInteractionService(pool, cdpCompanyId, companyName) {
  try {
    const res = await fetch(`${INTERACTION_SERVICE_URL}/company/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: companyName || cdpCompanyId, cdpCompanyId }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    });

    if (!res.ok) {
      console.warn(
        `[interactionService] registerCompany failed for ${cdpCompanyId}: HTTP ${res.status}`
      );
      return null;
    }

    const data = await res.json();
    const isCompanyId = data?.id;
    if (!isCompanyId) return null;

    await pool.query(
      `UPDATE app.companies
       SET interaction_service_company_id = $1,
           interaction_service_synced_at  = NOW()
       WHERE id = $2`,
      [isCompanyId, cdpCompanyId]
    );

    return isCompanyId;
  } catch (err) {
    console.warn(
      `[interactionService] registerCompany error for ${cdpCompanyId}:`,
      err.message
    );
    return null;
  }
}

/**
 * Returns the interaction service company ID for a CDP company.
 * Uses the dedicated column first; falls back to creating the record if
 * it was never registered (e.g. companies created before this feature).
 *
 * @param {import('pg').Pool} pool
 * @param {string} cdpCompanyId
 * @returns {Promise<string>} interaction service company UUID
 */
export async function getInteractionServiceCompanyId(pool, cdpCompanyId) {
  const { rows } = await pool.query(
    `SELECT name, interaction_service_company_id FROM app.companies WHERE id = $1`,
    [cdpCompanyId]
  );
  if (!rows.length) throw new Error("Company not found");

  const { name, interaction_service_company_id } = rows[0];

  if (interaction_service_company_id) return interaction_service_company_id;

  // Company predates the feature - register now (lazy back-fill)
  const newId = await registerCompanyWithInteractionService(pool, cdpCompanyId, name);
  if (!newId) throw new Error("Interaction service unavailable and no company ID on record");
  return newId;
}
