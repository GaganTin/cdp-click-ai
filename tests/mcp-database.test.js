import { describe, it, expect, vi, beforeEach } from "vitest";
import { databaseTools, handleDatabaseTool } from "../server/mcp/tools/database.js";

const EXPECTED_TOOLS = ["query_data", "list_tables", "describe_table"];

const mockDictionary = [
  {
    schema_name: "ga_landing",
    table_name: "website_metrics",
    description: "Daily website traffic metrics",
    columns: [
      { name: "date", type: "text" },
      { name: "sessions", type: "integer" },
    ],
  },
  {
    schema_name: "public",
    table_name: "membership",
    description: "Member profiles",
    columns: [
      { name: "member_id", type: "text" },
      { name: "eng_full_name", type: "text" },
    ],
  },
];

function makePool(rows = [], rowCount = null) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rowCount ?? rows.length }) };
}

describe("DB Connector — tool registration", () => {
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

describe("DB Connector — query_data", () => {
  it("executes SELECT and returns rows", async () => {
    const pool = makePool([{ sessions: 100 }]);
    const result = await handleDatabaseTool("query_data", { sql: "SELECT sessions FROM ga_landing.website_metrics" }, pool, []);
    const data = JSON.parse(result.content[0].text);
    expect(data.rows).toEqual([{ sessions: 100 }]);
    expect(data.rowCount).toBe(1);
    expect(pool.query).toHaveBeenCalledOnce();
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
    const result = await handleDatabaseTool("query_data", { sql: "SELECT 1" }, pool, []);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/connection refused/);
  });
});

describe("DB Connector — list_tables", () => {
  it("returns all tables from dictionary", async () => {
    const result = await handleDatabaseTool("list_tables", {}, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.tables).toHaveLength(2);
    expect(data.tables[0].table_name).toBe("website_metrics");
    expect(data.tables[0].schema_name).toBe("ga_landing");
    expect(data.tables[0].column_count).toBe(2);
  });

  it("returns empty array for empty dictionary", async () => {
    const result = await handleDatabaseTool("list_tables", {}, null, []);
    const data = JSON.parse(result.content[0].text);
    expect(data.tables).toEqual([]);
  });
});

describe("DB Connector — describe_table", () => {
  it("returns full table definition by name", async () => {
    const result = await handleDatabaseTool("describe_table", { table_name: "membership" }, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.table_name).toBe("membership");
    expect(data.columns).toHaveLength(2);
  });

  it("filters by schema when schema_name provided", async () => {
    const result = await handleDatabaseTool("describe_table", { table_name: "membership", schema_name: "public" }, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.schema_name).toBe("public");
  });

  it("returns error for unknown table", async () => {
    const result = await handleDatabaseTool("describe_table", { table_name: "nonexistent" }, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/not found/);
  });

  it("returns error when schema mismatch", async () => {
    const result = await handleDatabaseTool("describe_table", { table_name: "membership", schema_name: "ga_landing" }, null, mockDictionary);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeTruthy();
  });
});

describe("DB Connector — unknown tool", () => {
  it("returns an error for an unrecognised tool name", async () => {
    const result = await handleDatabaseTool("does_not_exist", {}, null, []);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/Unknown database tool/);
  });
});
