// MCP Tool Group 1: Database Connector
// Gives the AI the ability to understand and query the data in the DB.

export const databaseTools = [
  {
    name: "query_data",
    description:
      "Execute a read-only SELECT query against the PostgreSQL database. " +
      "Use this whenever you need actual data to answer a question or estimate numbers. " +
      "Always prefix table names with their schema (e.g. ga_landing.utm_daily_performance, public.membership, app.segments).",
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
          description: "The schema name (ga_landing, public, app, metadata). Optional — if omitted, searches all schemas.",
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
    const tables = dataDictionary.map((t) => ({
      schema_name: t.schema_name,
      table_name: t.table_name,
      description: t.description || "",
      column_count: Array.isArray(t.columns) ? t.columns.length : 0,
    }));
    return { content: [{ type: "text", text: JSON.stringify({ tables }) }] };
  }

  if (name === "describe_table") {
    const entry = dataDictionary.find(
      (t) =>
        t.table_name === args.table_name &&
        (!args.schema_name || t.schema_name === args.schema_name)
    );
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
