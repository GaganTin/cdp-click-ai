import { describe, it, expect, vi } from "vitest";
import { utmTools, handleUtmTool } from "../server/mcp/tools/utm.js";

const CO = "00000000-0000-0000-0000-000000000001";

function makePool(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

// Every handler call must carry a workspace id (injected by the server as
// args._company_id); the isolation guard refuses to run without it.
function call(name, args, pool) {
  return handleUtmTool(name, { ...args, _company_id: CO }, pool);
}

describe("UTM - tool registration", () => {
  it("exports list_campaigns and analyze_utm_performance", () => {
    const names = utmTools.map((t) => t.name);
    expect(names).toContain("list_campaigns");
    expect(names).toContain("analyze_utm_performance");
  });

  it("does NOT export create_utm_link (no writes without user approval)", () => {
    const names = utmTools.map((t) => t.name);
    expect(names).not.toContain("create_utm_link");
  });

  it("status enum in list_campaigns covers draft, active, archived", () => {
    const tool = utmTools.find((t) => t.name === "list_campaigns");
    const prop = tool.inputSchema.properties.status;
    expect(prop.enum).toEqual(expect.arrayContaining(["draft", "active", "archived"]));
  });

  it("group_by enum in analyze_utm_performance covers all options", () => {
    const tool = utmTools.find((t) => t.name === "analyze_utm_performance");
    const prop = tool.inputSchema.properties.group_by;
    expect(prop.enum).toEqual(expect.arrayContaining(["source_medium", "campaign", "full"]));
  });
});

describe("UTM - isolation guard", () => {
  it("refuses to run without a workspace context", async () => {
    const pool = makePool([]);
    const result = await handleUtmTool("list_campaigns", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/workspace/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("UTM - list_campaigns", () => {
  it("returns campaigns with no filter", async () => {
    const rows = [
      { id: 1, name: "Google CPC Q1", utm_source: "google", utm_medium: "cpc" },
      { id: 2, name: "Email Newsletter", utm_source: "email", utm_medium: "newsletter" },
    ];
    const pool = makePool(rows);
    const result = await call("list_campaigns", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.campaigns).toHaveLength(2);
  });

  it("passes status filter to query", async () => {
    const pool = makePool([{ id: 1, name: "Active campaign", status: "active" }]);
    await call("list_campaigns", { status: "active" }, pool);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE/);
    expect(params).toContain("active");
  });

  it("defaults to limit 20", async () => {
    const pool = makePool([]);
    await call("list_campaigns", {}, pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/LIMIT 20/);
  });

  it("caps limit at 100", async () => {
    const pool = makePool([]);
    await call("list_campaigns", { limit: 9999 }, pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/LIMIT 100/);
  });

  it("returns error on DB failure", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("timeout")) };
    const result = await call("list_campaigns", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeTruthy();
  });
});

describe("UTM - analyze_utm_performance", () => {
  it("queries acquisition_session_daily with default 30 days", async () => {
    const rows = [{ utm_source: "google", utm_medium: "cpc", total_sessions: 500 }];
    const pool = makePool(rows);
    const result = await call("analyze_utm_performance", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.rows).toHaveLength(1);
    expect(data.days_analyzed).toBe(30);
    const [sql] = pool.query.mock.calls[0];
    // GA cube redesign: reads acquisition_session_daily (utm_daily_performance retired).
    expect(sql).toMatch(/acquisition_session_daily/);
    expect(sql).toMatch(/30 days/);
  });

  it("applies utm_source filter when provided", async () => {
    const pool = makePool([{ utm_source: "facebook", total_sessions: 200 }]);
    await call("analyze_utm_performance", { utm_source: "facebook" }, pool);
    const [sql, params] = pool.query.mock.calls[0];
    // Filters on source split from session_source_medium (aliased to utm_source in output).
    expect(sql).toMatch(/split_part\(session_source_medium, ' \/ ', 1\) =/);
    expect(params).toContain("facebook");
  });

  it("applies utm_medium filter when provided", async () => {
    const pool = makePool([]);
    await call("analyze_utm_performance", { utm_medium: "email" }, pool);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/split_part\(session_source_medium, ' \/ ', 2\) =/);
    expect(params).toContain("email");
  });

  it("groups by source_medium by default", async () => {
    const pool = makePool([]);
    await call("analyze_utm_performance", {}, pool);
    const [sql] = pool.query.mock.calls[0];
    // Groups by the combined session_source_medium; output is split/aliased to utm_source/utm_medium.
    expect(sql).toMatch(/GROUP BY session_source_medium/);
    expect(sql).toMatch(/AS utm_source/);
  });

  it("groups by campaign when group_by=campaign", async () => {
    const pool = makePool([]);
    await call("analyze_utm_performance", { group_by: "campaign" }, pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/session_campaign_name AS utm_campaign/);
    expect(sql).toMatch(/GROUP BY session_campaign_name/);
  });

  it("returns error on DB failure (no invented numbers)", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("column does not exist")) };
    const result = await call("analyze_utm_performance", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeTruthy();
    expect(data.rows).toBeUndefined();
  });

  it("respects custom days parameter", async () => {
    const pool = makePool([]);
    await call("analyze_utm_performance", { days: 90 }, pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/90 days/);
    const data = JSON.parse((await call("analyze_utm_performance", { days: 90 }, makePool([]))).content[0].text);
    expect(data.days_analyzed).toBe(90);
  });
});

describe("UTM - unknown tool", () => {
  it("returns error for unrecognised tool name", async () => {
    const result = await call("nuke_campaigns", {}, makePool());
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/Unknown UTM tool/);
  });
});
