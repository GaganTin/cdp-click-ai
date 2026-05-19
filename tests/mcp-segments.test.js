import { describe, it, expect, vi } from "vitest";
import { segmentTools, handleSegmentTool } from "../server/mcp/tools/segments.js";

function makePool(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

describe("Segments — tool registration", () => {
  it("exports list_segments and preview_segment_size", () => {
    const names = segmentTools.map((t) => t.name);
    expect(names).toContain("list_segments");
    expect(names).toContain("preview_segment_size");
  });

  it("does NOT export create_segment (no writes without user approval)", () => {
    const names = segmentTools.map((t) => t.name);
    expect(names).not.toContain("create_segment");
  });

  it("preview_segment_size requires segment_type and sql_where", () => {
    const tool = segmentTools.find((t) => t.name === "preview_segment_size");
    expect(tool.inputSchema.required).toContain("segment_type");
    expect(tool.inputSchema.required).toContain("sql_where");
  });

  it("segment_type enum allows customer and anonymous_profile", () => {
    const tool = segmentTools.find((t) => t.name === "list_segments");
    const prop = tool.inputSchema.properties.segment_type;
    expect(prop.enum).toContain("customer");
    expect(prop.enum).toContain("anonymous_profile");
  });
});

describe("Segments — list_segments", () => {
  it("returns all segments when no type filter", async () => {
    const rows = [
      { id: 1, name: "High-value members", segment_type: "customer" },
      { id: 2, name: "Seminar visitors", segment_type: "anonymous_profile" },
    ];
    const pool = makePool(rows);
    const result = await handleSegmentTool("list_segments", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.segments).toHaveLength(2);
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it("passes segment_type param when filter provided", async () => {
    const pool = makePool([{ id: 1, name: "Test", segment_type: "customer" }]);
    await handleSegmentTool("list_segments", { segment_type: "customer" }, pool);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE segment_type/);
    expect(params).toContain("customer");
  });

  it("returns error object on DB failure", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("DB error")) };
    const result = await handleSegmentTool("list_segments", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeTruthy();
  });
});

describe("Segments — preview_segment_size", () => {
  it("queries public.membership for customer segments", async () => {
    const pool = makePool([{ count: "342" }]);
    const result = await handleSegmentTool(
      "preview_segment_size",
      { segment_type: "customer", sql_where: "member_reg_channel = 'Seminar'" },
      pool
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.estimated_count).toBe(342);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/public\.membership/);
    expect(sql).toMatch(/member_reg_channel = 'Seminar'/);
  });

  it("queries path_exploration for anonymous_profile and excludes mapped members", async () => {
    const pool = makePool([{ count: "1500" }]);
    const result = await handleSegmentTool(
      "preview_segment_size",
      { segment_type: "anonymous_profile", sql_where: "session_source_medium = 'google / cpc'" },
      pool
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.estimated_count).toBe(1500);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/path_exploration/);
    expect(sql).toMatch(/membership_ap_mapping/); // excludes known members
  });

  it("returns error with attempted SQL when DB query fails", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("syntax error")) };
    const result = await handleSegmentTool(
      "preview_segment_size",
      { segment_type: "customer", sql_where: "1=1" },
      pool
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/syntax error/);
    expect(data.attempted_sql).toBeTruthy();
  });

  it("parses count as integer", async () => {
    const pool = makePool([{ count: "99" }]);
    const result = await handleSegmentTool(
      "preview_segment_size",
      { segment_type: "customer", sql_where: "1=1" },
      pool
    );
    const data = JSON.parse(result.content[0].text);
    expect(typeof data.estimated_count).toBe("number");
    expect(data.estimated_count).toBe(99);
  });
});

describe("Segments — unknown tool", () => {
  it("returns an error for unrecognised tool name", async () => {
    const result = await handleSegmentTool("delete_all_segments", {}, makePool());
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/Unknown segment tool/);
  });
});
