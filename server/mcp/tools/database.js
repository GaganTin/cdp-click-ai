// MCP Tool Group 1: Database Connector
// Gives the AI the ability to understand and query the data in the DB.

export const databaseTools = [
  {
    name: "query_data",
    description:
      "Execute a read-only SELECT query against the PostgreSQL database. " +
      "Use this whenever you need actual data to answer a question or estimate numbers. " +
      "Always prefix table names with their schema (e.g. ga_landing.utm_daily_performance, app.customer_profiles, app.segments). All data tables are company-scoped - filter by company_id.",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description:
            "A valid SELECT SQL statement. Must start with SELECT. No semicolons at end. " +
            "Always include schema prefix on table names.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "list_tables",
    description:
      "List all available database tables with their schema, description, and column count. " +
      "Use this to discover what data is available before writing queries.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "describe_table",
    description:
      "Get the full column definitions and description for a specific database table. " +
      "Use this to understand a table's structure before querying it.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: {
          type: "string",
          description: "The table name (without schema prefix)",
        },
        schema_name: {
          type: "string",
          description: "The schema name (ga_landing, public, app, metadata). Optional - if omitted, searches all schemas.",
        },
      },
      required: ["table_name"],
    },
  },
];

export async function handleDatabaseTool(name, args, pool, dataDictionary) {
  if (name === "query_data") {
    const sql = (args.sql || "").trim();
    if (!sql.toUpperCase().startsWith("SELECT")) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Only SELECT queries are allowed" }) }] };
    }
    // Email (EDM) is a coming-soon feature: the analyst must not read email data.
    // Block any reference to the app.edm_* tables (campaigns, sends, events,
    // suppression, templates, automations). is_opt_in_email / primary_email on
    // customer_profiles are member attributes, not email-feature data, so allowed.
    if (/\bedm_[a-z_]+/i.test(sql)) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Email campaign data is not available yet — email is a coming-soon feature. Query member, web analytics, commerce, or segment data instead." }) }] };
    }

    // ── Workspace isolation (fail CLOSED) ────────────────────────────────────
    // The analyst may only read the ACTIVE workspace's data. companyId is
    // injected by the server (args._company_id) and is NOT model-controllable.
    const companyId = args._company_id;
    if (!companyId) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No workspace context - refusing to run query (isolation guard)." }) }] };
    }
    // 1) Reject any company_id filter that targets a DIFFERENT workspace.
    const companyRefs = [...sql.matchAll(/company_id\s*=\s*'([0-9a-fA-F-]{36})'/gi)].map((m) => m[1]);
    if (companyRefs.some((id) => id.toLowerCase() !== String(companyId).toLowerCase())) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Cross-workspace access denied. You may only query the current workspace (company_id = '${companyId}'). Remove any other company_id filter.` }) }] };
    }
    // 2) Any query touching tenant-scoped data MUST filter by the current
    //    workspace. Every data table carries company_id, so require the exact
    //    scoping predicate to be present.
    const touchesTenantData = /\b(ga_landing|commerce|manual)\s*\.|\bapp\s*\.\s*(customer_profiles|anonymous_profiles|segments|campaigns|profile_identities|saved_reports|pinned_charts)/i.test(sql);
    const hasCurrentScope = new RegExp(`company_id\\s*=\\s*'${companyId}'`, "i").test(sql);
    if (touchesTenantData && !hasCurrentScope) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Workspace scoping required. Add company_id = '${companyId}' to the WHERE clause of every table in this query (all data tables are workspace-scoped).` }) }] };
    }
    try {
      const result = await pool.query(sql);
      return {
        content: [{ type: "text", text: JSON.stringify({ rows: result.rows, rowCount: result.rowCount }) }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message, sql }) }] };
    }
  }

  if (name === "list_tables") {
    // Dictionary entries are { table, use_case, granularity, fields[] }. Schema
    // prefixes are given in the system prompt (ga_landing.* for GA/GSC reports).
    const tables = dataDictionary.map((t) => ({
      table_name: t.table,
      use_case: t.use_case || "",
      granularity: t.granularity || "",
      column_count: Array.isArray(t.fields) ? t.fields.length : 0,
    }));
    return { content: [{ type: "text", text: JSON.stringify({ tables }) }] };
  }

  if (name === "describe_table") {
    const entry = dataDictionary.find((t) => t.table === args.table_name);
    if (!entry) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: `Table '${args.table_name}' not found in data dictionary` }),
        }],
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(entry) }] };
  }

  return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown database tool: ${name}` }) }] };
}
