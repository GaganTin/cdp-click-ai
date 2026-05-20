import { describe, it, expect, vi } from "vitest";
import { edmTools, handleEdmTool } from "../server/mcp/tools/edm.js";

const EXPECTED_TOOLS = [
  "list_edm_campaigns",
  "preview_edm_recipients",
  "analyze_edm_performance",
  "suggest_send_time",
];

function makePool(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

// ── Tool registration ─────────────────────────────────────────────────────────

describe("EDM - tool registration", () => {
  it("exports exactly the expected 4 tools", () => {
    expect(edmTools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
  });

  it("does NOT export send_edm_campaign or create_edm_campaign (no autonomous sends)", () => {
    const names = edmTools.map((t) => t.name);
    expect(names).not.toContain("send_edm_campaign");
    expect(names).not.toContain("create_edm_campaign");
  });

  it("every tool has a description and inputSchema", () => {
    for (const tool of edmTools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

// ── list_edm_campaigns ────────────────────────────────────────────────────────

describe("EDM - list_edm_campaigns", () => {
  it("returns campaigns with no filter", async () => {
    const rows = [
      { id: "1", name: "Q1 Newsletter", status: "sent", segment_name: "All members" },
    ];
    const pool = makePool(rows);
    const result = await handleEdmTool("list_edm_campaigns", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.campaigns).toHaveLength(1);
    expect(data.campaigns[0].name).toBe("Q1 Newsletter");
  });

  it("passes status filter to query", async () => {
    const pool = makePool([]);
    await handleEdmTool("list_edm_campaigns", { status: "draft" }, pool);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE/);
    expect(params).toContain("draft");
  });

  it("defaults to limit 20", async () => {
    const pool = makePool([]);
    await handleEdmTool("list_edm_campaigns", {}, pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/LIMIT 20/);
  });

  it("caps limit at 50", async () => {
    const pool = makePool([]);
    await handleEdmTool("list_edm_campaigns", { limit: 9999 }, pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/LIMIT 50/);
  });

  it("returns error on DB failure", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("table not found")) };
    const result = await handleEdmTool("list_edm_campaigns", {}, pool);
    expect(JSON.parse(result.content[0].text).error).toBeTruthy();
  });
});

// ── preview_edm_recipients ────────────────────────────────────────────────────

describe("EDM - preview_edm_recipients", () => {
  function triplePool(countRow, sampleRows, suppressedRow) {
    return {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [countRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: sampleRows, rowCount: sampleRows.length })
        .mockResolvedValueOnce({ rows: [suppressedRow], rowCount: 1 }),
    };
  }

  it("returns eligible_recipients count", async () => {
    const pool = triplePool({ total: "450" }, [], { total: "12" });
    const result = await handleEdmTool("preview_edm_recipients", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.eligible_recipients).toBe(450);
    expect(data.suppression_list_size).toBe(12);
  });

  it("always includes opt-in and suppression filters in SQL", async () => {
    const pool = triplePool({ total: "100" }, [], { total: "5" });
    await handleEdmTool("preview_edm_recipients", {}, pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/is_opt_in_email/);
    expect(sql).toMatch(/edm_suppression/);
  });

  it("adds gender param when filter provided", async () => {
    const pool = triplePool({ total: "200" }, [], { total: "0" });
    await handleEdmTool("preview_edm_recipients", { filters: { gender: "Female" } }, pool);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/gender/);
    expect(params).toContain("Female");
  });

  it("adds has_seminar condition without param", async () => {
    const pool = triplePool({ total: "80" }, [], { total: "0" });
    await handleEdmTool("preview_edm_recipients", { filters: { has_seminar: true } }, pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/seminar_count > 0/);
  });

  it("adds min_ga_sessions param", async () => {
    const pool = triplePool({ total: "60" }, [], { total: "0" });
    await handleEdmTool("preview_edm_recipients", { filters: { min_ga_sessions: 3 } }, pool);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ga_sessions/);
    expect(params).toContain(3);
  });

  it("returns sample_recipients from second query", async () => {
    const sample = [{ eng_first_name: "Alice", primary_email: "a@b.com" }];
    const pool = triplePool({ total: "1" }, sample, { total: "0" });
    const result = await handleEdmTool("preview_edm_recipients", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.sample_recipients[0].eng_first_name).toBe("Alice");
  });
});

// ── analyze_edm_performance ───────────────────────────────────────────────────

describe("EDM - analyze_edm_performance", () => {
  it("returns enriched rows with rate percentages", async () => {
    const rows = [{
      id: "abc", name: "Q1", subject: "Hello", sent_at: "2025-01-01",
      total_recipients: "100", delivered: "95",
      unique_opens: "40", unique_clicks: "10", unsubscribes: "2", bounces: "3",
      total_opens: "50", total_clicks: "12",
    }];
    const pool = makePool(rows);
    const result = await handleEdmTool("analyze_edm_performance", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.campaigns[0].open_rate).toBe("42.1%");
    expect(data.campaigns[0].click_rate).toBe("10.5%");
    expect(data.campaigns[0].unsub_rate).toBe("2.1%");
    expect(data.days_analyzed).toBe(90);
  });

  it("defaults to 90 days", async () => {
    const pool = makePool([]);
    await handleEdmTool("analyze_edm_performance", {}, pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/90 days/);
  });

  it("uses parameterized query for campaign_id (no SQL injection)", async () => {
    const pool = makePool([]);
    const maliciousId = "'; DROP TABLE app.edm_campaigns; --";
    await handleEdmTool("analyze_edm_performance", { campaign_id: maliciousId }, pool);
    const [sql, params] = pool.query.mock.calls[0];
    // campaign_id must appear as a param ($N), never interpolated in the SQL
    expect(sql).not.toContain(maliciousId);
    expect(params).toContain(maliciousId);
    expect(sql).toMatch(/\$1/);
  });

  it("passes custom days value", async () => {
    const pool = makePool([]);
    await handleEdmTool("analyze_edm_performance", { days: 30 }, pool);
    const data = JSON.parse((await handleEdmTool("analyze_edm_performance", { days: 30 }, makePool([]))).content[0].text);
    expect(data.days_analyzed).toBe(30);
  });
});

// ── suggest_send_time ─────────────────────────────────────────────────────────

describe("EDM - suggest_send_time", () => {
  it("returns top_send_windows with day and hour", async () => {
    const rows = [
      { day_of_week: "2", hour_of_day: "10", open_count: "120" },
      { day_of_week: "4", hour_of_day: "9",  open_count: "95" },
    ];
    const pool = makePool(rows);
    const result = await handleEdmTool("suggest_send_time", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.top_send_windows[0].day).toBe("Tuesday");
    expect(data.top_send_windows[0].hour).toBe("10:00");
    expect(data.top_send_windows[0].open_count).toBe(120);
  });

  it("returns fallback recommendation when no history", async () => {
    const pool = makePool([]);
    const result = await handleEdmTool("suggest_send_time", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.recommendation).toMatch(/Tuesday|Thursday/);
  });

  it("recommendation references best window when data exists", async () => {
    const rows = [{ day_of_week: "1", hour_of_day: "9", open_count: "200" }];
    const pool = makePool(rows);
    const result = await handleEdmTool("suggest_send_time", {}, pool);
    const data = JSON.parse(result.content[0].text);
    expect(data.recommendation).toMatch(/Monday/);
    expect(data.recommendation).toMatch(/9:00/);
  });

  it("queries open events from last 180 days", async () => {
    const pool = makePool([]);
    await handleEdmTool("suggest_send_time", {}, pool);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/180 days/);
    expect(sql).toMatch(/event_type = 'open'/);
  });
});

// ── unknown tool ──────────────────────────────────────────────────────────────

describe("EDM - unknown tool", () => {
  it("returns error for unrecognised tool name", async () => {
    const result = await handleEdmTool("blast_everyone", {}, makePool());
    expect(JSON.parse(result.content[0].text).error).toMatch(/Unknown EDM tool/);
  });
});
