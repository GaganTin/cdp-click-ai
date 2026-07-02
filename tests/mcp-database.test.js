import { describe, it, expect, vi, beforeEach } from "vitest";
import { databaseTools, handleDatabaseTool } from "../server/mcp/tools/database.js";

const EXPECTED_TOOLS = ["query_data", "list_tables", "describe_table"];
const CO = "00000000-0000-0000-0000-000000000001";

// Data-dictionary entries: { table, schema, use_case, granularity, fields[] }.
// Every entry carries its schema; describe_table uses schema only to
// disambiguate a bare name shared across schemas (e.g. commerce/manual product).
const mockDictionary = [
  {
    table: "website_metrics",
    schema: "ga_landing",
    use_case: "Daily website traffic metrics",
    granularity: "One row per date",
    fields: [
      { name: "date", type: "string" },
      { name: "sessions", type: "int" },
    ],
  },
  {
    table: "membership",
    schema: "manual",
    use_case: "Member profiles",
    granularity: "One row per member",
    fields: [
      { name: "member_id", type: "string" },
      { name: "eng_full_name", type: "string" },
    ],
  },
  // Same bare name in two schemas - exercises disambiguation.
  {
    table: "product",
    schema: "commerce",
    use_case: "Synced-store product catalogue",
    granularity: "One row per product",
    fields: [{ name: "prod_id", type: "string" }],
  },
  {
    table: "product",
    schema: "manual",
    use_case: "CSV-uploaded product catalogue",
    granularity: "One row per product",
    fields: [{ name: "prod_id", type: "string" }, { name: "prod_sku", type: "string" }],
  },
];

function makePool(rows = [], rowCount = null) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rowCount ?? rows.length }) };
}

describe("DB Connector - tool registration", () => {
  it("exports exactly the expected tool names", () => {
    const names = databaseTools.map((t) => t.name);
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it("every tool has a name, description, and inputSchema", () => {
    for (const tool of databaseTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("query_data marks sql as required", () => {
    const tool = databaseTools.find((t) => t.name === "query_data");
    expect(tool.inputSchema.required).toContain("sql");
  });

  it("describe_table marks table_name as required", () => {
    const tool = databaseTools.find((t) => t.name === "describe_table");
    expect(tool.inputSchema.required).toContain("table_name");
  });
});

describe("DB Connector - query_data", () => {
  it("executes SELECT and returns rows", async () => {
    const pool = makePool([{ sessions: 100 }]);
    const result = await handleDatabaseTool(
      "query_data",
      { sql: `SELECT sessions FROM ga_landing.website_metrics WHERE company_id = '${CO}'`, _company_id: CO },
      pool,
      []
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.rows).toEqual([{ sessions: 100 }]);
    expect(data.rowCount).toBe(1);
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it("refuses to run without a workspace context (isolation guard)", async () => {
    const pool = makePool([{ sessions: 100 }]);
    const result = await handleDatabaseTool("query_data", { sql: "SELECT sessions FROM ga_landing.website_metrics" }, pool, []);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/workspace/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects non-SELECT SQL", async () => {
    const pool = makePool();
    const result = await handleDatabaseTool("query_data", { sql: "DROP TABLE membership" }, pool, []);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/Only SELECT/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects INSERT statements", async () => {
    const pool = makePool();
    const result = await handleDatabaseTool("query_data", { sql: "INSERT INTO foo VALUES (1)" }, pool, []);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeTruthy();
  });

  it("returns error on DB failure without throwing", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("connection refused")) };
    const result = await handleDatabaseTool("query_data", { sql: "SELECT 1", _company_id: CO }, pool, []);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/connection refused/);
  });
});

describe("DB Connector - list_tables", () => {
  it("returns all tables from dictionary", async () => {
    const result = await handleDatabaseTool("list_tables", {}, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.tables).toHaveLength(mockDictionary.length);
    expect(data.tables[0].table_name).toBe("website_metrics");
    expect(data.tables[0].use_case).toMatch(/traffic/);
    expect(data.tables[0].column_count).toBe(2);
    // Schema-qualified name is exposed so the model uses the correct prefix.
    expect(data.tables[0].qualified_name).toBe("ga_landing.website_metrics");
  });

  it("returns empty array for empty dictionary", async () => {
    const result = await handleDatabaseTool("list_tables", {}, null, []);
    const data = JSON.parse(result.content[0].text);
    expect(data.tables).toEqual([]);
  });
});

describe("DB Connector - describe_table", () => {
  it("returns full table definition by name", async () => {
    const result = await handleDatabaseTool("describe_table", { table_name: "membership" }, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.table).toBe("membership");
    expect(data.fields).toHaveLength(2);
  });

  it("resolves a uniquely-named table even when schema_name does not match", async () => {
    // membership exists only in one schema, so a wrong/absent schema_name still resolves it.
    const result = await handleDatabaseTool("describe_table", { table_name: "membership", schema_name: "public" }, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.table).toBe("membership");
    expect(data.schema).toBe("manual");
  });

  it("returns error for unknown table", async () => {
    const result = await handleDatabaseTool("describe_table", { table_name: "nonexistent" }, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/not found/);
  });

  it("errors ambiguously when a bare name spans multiple schemas", async () => {
    const result = await handleDatabaseTool("describe_table", { table_name: "product" }, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/[Aa]mbiguous/);
    expect(data.error).toMatch(/commerce/);
    expect(data.error).toMatch(/manual/);
  });

  it("disambiguates a shared bare name via schema_name", async () => {
    const result = await handleDatabaseTool("describe_table", { table_name: "product", schema_name: "manual" }, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.table).toBe("product");
    expect(data.schema).toBe("manual");
    expect(data.fields).toHaveLength(2);
  });

  it("disambiguates via a schema-qualified table_name", async () => {
    const result = await handleDatabaseTool("describe_table", { table_name: "commerce.product" }, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.table).toBe("product");
    expect(data.schema).toBe("commerce");
    expect(data.fields).toHaveLength(1);
  });
});

describe("DB Connector - unknown tool", () => {
  it("returns an error for an unrecognised tool name", async () => {
    const result = await handleDatabaseTool("does_not_exist", {}, null, []);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/Unknown database tool/);
  });
});
