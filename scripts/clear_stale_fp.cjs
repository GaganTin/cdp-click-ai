// One-off: release credential_fingerprint from truly-disconnected integrations
// across all integration types and all workspaces. Truly-disconnected = the
// DELETE handler reset config to '{}'. Configured-but-health-failing rows
// (config still populated) intentionally keep their reservation.
const { getPool } = require("./_db.cjs");
const pool = getPool({ max: 2 });

const WHERE = `
  di.is_connected = false
  AND di.credential_fingerprint IS NOT NULL
  AND (di.config IS NULL OR di.config = '{}'::jsonb)
`;

(async () => {
  try {
    const preview = await pool.query(
      `SELECT di.company_id, c.name AS workspace, di.integration_type
         FROM app.data_integrations di
         JOIN app.companies c ON c.id = di.company_id
        WHERE ${WHERE}
        ORDER BY c.name, di.integration_type`
    );
    console.log(`Rows to update: ${preview.rowCount}`);
    for (const r of preview.rows) {
      console.log(`  - workspace="${r.workspace}"  type=${r.integration_type}  company_id=${r.company_id}`);
    }
    if (preview.rowCount === 0) { console.log("Nothing to clear. Exiting."); return; }

    const upd = await pool.query(
      `UPDATE app.data_integrations di SET credential_fingerprint = NULL WHERE ${WHERE}`
    );
    console.log(`\nUpdated ${upd.rowCount} row(s). Credential reservations released.`);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
