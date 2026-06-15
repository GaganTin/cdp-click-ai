import { describe, it, expect, vi } from "vitest";
import { createAnalystMCPClient, toOpenAITools } from "../server/mcp/server.js";

// Order matches ALL_TOOLS in server/mcp/server.js:
// database, segments, utm, edm, analytics.
const EXPECTED_TOOLS = [
  "query_data",
  "list_tables",
  "describe_table",
  "list_segments",
  "preview_segment_size",
  "list_campaigns",
  "analyze_utm_performance",
  "suggest_edm_opportunities",
  "get_member_profile_breakdown",
  "list_edm_campaigns",
  "preview_edm_recipients",
  "analyze_edm_performance",
  "suggest_send_time",
  "score_rfm",
  "estimate_clv",
  "score_churn_risk",
  "analyze_cohort_retention",
  "cluster_members",
  "find_association_rules",
  "predict_next_event",
  "compute_channel_attribution",
  "detect_anomalies",
  "forecast_registrations",
];

function makeMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ count: "0" }], rowCount: 1 }),
  };
}

describe("MCP Server - tool discovery", () => {
  it("registers all 23 expected tools", async () => {
    const client = await createAnalystMCPClient(makeMockPool(), []);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it("every tool has a name, description, and inputSchema", async () => {
    const client = await createAnalystMCPClient(makeMockPool(), []);
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it("does NOT register create_segment or create_utm_link", async () => {
    const client = await createAnalystMCPClient(makeMockPool(), []);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("create_segment");
    expect(names).not.toContain("create_utm_link");
  });
});

describe("MCP Server - tool calls via client", () => {
  it("routes query_data to the DB connector and returns result", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ sessions: 999 }], rowCount: 1 }),
    };
    const client = await createAnalystMCPClient(pool, []);
    const result = await client.callTool({
      name: "query_data",
      arguments: { sql: "SELECT sessions FROM ga_landing.website_metrics" },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.rows[0].sessions).toBe(999);
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it("routes list_tables and returns dictionary entries", async () => {
    const dict = [{ table: "page_metrics", use_case: "Page data", granularity: "One row per page", fields: [] }];
    const client = await createAnalystMCPClient(makeMockPool(), dict);
    const result = await client.callTool({ name: "list_tables", arguments: {} });
    const data = JSON.parse(result.content[0].text);
    expect(data.tables[0].table_name).toBe("page_metrics");
  });

  it("routes list_segments and queries app.segments", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ name: "Seg A", segment_type: "customer" }], rowCount: 1 }),
    };
    const client = await createAnalystMCPClient(pool, []);
    const result = await client.callTool({ name: "list_segments", arguments: {} });
    const data = JSON.parse(result.content[0].text);
    expect(data.segments[0].name).toBe("Seg A");
  });

  it("routes list_campaigns and queries app.campaigns", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ name: "Google CPC", utm_source: "google" }], rowCount: 1 }),
    };
    const client = await createAnalystMCPClient(pool, []);
    const result = await client.callTool({ name: "list_campaigns", arguments: {} });
    const data = JSON.parse(result.content[0].text);
    expect(data.campaigns[0].name).toBe("Google CPC");
  });

  it("returns error content for unknown tool name (no throw)", async () => {
    const client = await createAnalystMCPClient(makeMockPool(), []);
    const result = await client.callTool({ name: "drop_all_tables", arguments: {} });
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/Unknown tool/);
  });
});

describe("toOpenAITools - format conversion", () => {
  it("converts MCP tools to OpenAI function format", async () => {
    const client = await createAnalystMCPClient(makeMockPool(), []);
    const { tools } = await client.listTools();
    const openAITools = toOpenAITools(tools);

    expect(openAITools).toHaveLength(EXPECTED_TOOLS.length);
    for (const t of openAITools) {
      expect(t.type).toBe("function");
      expect(t.function.name).toBeTruthy();
      expect(t.function.description).toBeTruthy();
      expect(t.function.parameters).toBeDefined();
    }
  });

  it("preserves tool names exactly", async () => {
    const client = await createAnalystMCPClient(makeMockPool(), []);
    const { tools } = await client.listTools();
    const openAITools = toOpenAITools(tools);
    const names = openAITools.map((t) => t.function.name);
    expect(names).toEqual(EXPECTED_TOOLS);
  });
});
