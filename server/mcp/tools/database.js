// MCP Tool Group 1: Database Connector
// Gives the AI the ability to understand and query the data in the DB.

export const databaseTools = [
  {
    name: "query_data",
    description:
      "Execute a read-only SELECT query against the PostgreSQL database. " +
      "Use this whenever you need actual data to answer a question or estimate numbers. " +
      "Always prefix table names with their schema (e.g. ga_landing.acquisition_session_daily, app.customer_profiles, app.segments). All data tables are company-scoped - filter by company_id.",
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
      return { content: [{ type: "text", text: JSON.stringify({ error: "Email campaign data is not available yet - email is a coming-soon feature. Query member, web analytics, commerce, or segment data instead." }) }] };
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
    //    workspace. Default-DENY by schema: EVERY table in ga_landing / ga_gold /
    //    commerce / manual / app carries company_id, so any reference to one of
    //    those schemas requires the scoping predicate. (Previously this listed a
    //    handful of app.* tables by name, which let unlisted ones - app.users,
    //    app.companies, app.popups, app.skills, … - be read across ALL workspaces.)
    const touchesTenantData = /\b(ga_landing|ga_gold|commerce|manual|app)\s*\.\s*"?[a-z_]/i.test(sql);
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
    // Dictionary entries are { table, schema, use_case, granularity, fields[] }.
    // Emit both the bare name and the schema-qualified name so the model always
    // knows the correct prefix to use in query_data (e.g. manual.product vs
    // commerce.product, which share the bare name "product").
    const tables = dataDictionary.map((t) => ({
      table_name: t.table,
      schema: t.schema || "",
      qualified_name: t.schema ? `${t.schema}.${t.table}` : t.table,
      use_case: t.use_case || "",
      granularity: t.granularity || "",
      column_count: Array.isArray(t.fields) ? t.fields.length : 0,
    }));
    return { content: [{ type: "text", text: JSON.stringify({ tables }) }] };
  }

  if (name === "describe_table") {
    // Accept either a schema_name arg or a schema-qualified table_name
    // ("manual.product"). When neither is given and the bare name is ambiguous
    // (e.g. commerce.product vs manual.product), ask the model to disambiguate
    // instead of silently returning the wrong table.
    let wantTable = (args.table_name || "").trim();
    let wantSchema = (args.schema_name || "").trim();
    if (wantTable.includes(".")) {
      const [s, ...rest] = wantTable.split(".");
      wantSchema = wantSchema || s;
      wantTable = rest.join(".");
    }

    const matches = dataDictionary.filter((t) => t.table === wantTable);
    if (matches.length === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: `Table '${wantTable}' not found in data dictionary` }),
        }],
      };
    }

    // Schema is used ONLY to disambiguate a bare name shared by >1 schema; a
    // uniquely-named table always resolves (a wrong/absent schema_name never
    // rejects it).
    let entry;
    if (matches.length === 1) {
      entry = matches[0];
    } else if (wantSchema) {
      entry = matches.find((t) => (t.schema || "") === wantSchema);
      if (!entry) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: `Table '${wantTable}' not found in schema '${wantSchema}'. It exists in: ${matches.map((t) => t.schema || "(no schema)").join(", ")}.`,
            }),
          }],
        };
      }
    } else {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `Ambiguous table name '${wantTable}' - it exists in multiple schemas: ${matches.map((t) => t.schema).join(", ")}. Re-call with schema_name (or pass "schema.table").`,
          }),
        }],
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(entry) }] };
  }

  return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown database tool: ${name}` }) }] };
}
