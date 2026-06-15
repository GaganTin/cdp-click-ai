// Shared Postgres pool factory for one-off scripts.
// Loads .env, then reads POSTGRESQL_CONN (or DATABASE_URL); exits with a clear
// message if neither is set. Keeps connection handling identical across scripts.
require("dotenv").config();
const { Pool } = require("pg");

function getPool({ max = 2 } = {}) {
  const conn = process.env.POSTGRESQL_CONN || process.env.DATABASE_URL;
  if (!conn) {
    console.error("Set POSTGRESQL_CONN (or DATABASE_URL) before running.");
    process.exit(1);
  }
  return new Pool({ connectionString: conn, max });
}

module.exports = { getPool };
