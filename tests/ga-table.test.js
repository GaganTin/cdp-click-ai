import { describe, it, expect } from "vitest";
import { gaRowKey, gaDeltaPct, distinctValues, rowMatchesFilters } from "../src/lib/gaTable.js";

// ── gaRowKey ──────────────────────────────────────────────────────────────────
describe("gaRowKey", () => {
  // GA cube redesign: the /links grid groups by source / medium / campaign only.
  // content / term / utm_id are no longer fetched by any cube, so they are not
  // part of the key (and any such fields on a row are ignored).
  const base = {
    session_source: "google", session_medium: "cpc", session_campaign_name: "q1",
  };

  it("distinguishes rows that differ by campaign", () => {
    const a = gaRowKey(base);
    const b = gaRowKey({ ...base, session_campaign_name: "q2" });
    expect(a).not.toBe(b);
  });

  it("ignores dropped columns (content / term / utm_id) - they no longer key the row", () => {
    const a = gaRowKey(base);
    const b = gaRowKey({ ...base, session_content: "banner", session_term: "shoes", session_utm_id: "A2" });
    expect(a).toBe(b);
  });

  it("is stable for identical rows", () => {
    expect(gaRowKey(base)).toBe(gaRowKey({ ...base }));
  });

  it("treats null/undefined values as empty segments (no collisions across shapes)", () => {
    expect(gaRowKey({ session_source: "x" })).toBe("x||");
    expect(gaRowKey({})).toBe("||");
  });
});

// ── gaDeltaPct (comparison / delta correctness) ───────────────────────────────
describe("gaDeltaPct", () => {
  it("computes positive relative change", () => {
    expect(gaDeltaPct(150, 100)).toBeCloseTo(50);
  });

  it("computes negative relative change", () => {
    expect(gaDeltaPct(50, 100)).toBeCloseTo(-50);
  });

  it("works for 0..1 rate metrics (bounce / engagement)", () => {
    expect(gaDeltaPct(0.6, 0.5)).toBeCloseTo(20);
    expect(gaDeltaPct(0.4, 0.5)).toBeCloseTo(-20);
  });

  it("returns null when previous is 0 (division undefined)", () => {
    expect(gaDeltaPct(10, 0)).toBeNull();
  });

  it("returns null when the change rounds to 0% (noise suppressed)", () => {
    expect(gaDeltaPct(100, 100)).toBeNull();
    expect(gaDeltaPct(1002, 1000)).toBeNull(); // 0.2% -> rounds to 0
  });

  it("returns a badge value once the change rounds to >= 1%", () => {
    expect(gaDeltaPct(1010, 1000)).toBeCloseTo(1);
  });

  it("returns null for non-finite inputs", () => {
    expect(gaDeltaPct(undefined, undefined)).toBeNull();
    expect(gaDeltaPct(100, undefined)).toBeNull();
    expect(gaDeltaPct("abc", 100)).toBeNull();
    expect(gaDeltaPct(NaN, 100)).toBeNull();
  });

  it("uses |prev| so sign reflects direction even with negative baselines", () => {
    // curr rose from -100 to -50 => +50% relative to magnitude
    expect(gaDeltaPct(-50, -100)).toBeCloseTo(50);
  });
});

// ── distinctValues (dropdown option derivation) ───────────────────────────────
describe("distinctValues", () => {
  const rows = [
    { session_source: "google" },
    { session_source: "facebook" },
    { session_source: "google" },
    { session_source: "" },
    { session_source: null },
    { session_source: "  " },
    { session_source: "apple" },
  ];

  it("returns unique, sorted, non-empty values", () => {
    expect(distinctValues(rows, "session_source")).toEqual(["apple", "facebook", "google"]);
  });

  it("drops null, empty and whitespace-only values", () => {
    expect(distinctValues(rows, "session_source")).not.toContain("");
    expect(distinctValues(rows, "session_source")).not.toContain("  ");
  });

  it("handles empty / missing input safely", () => {
    expect(distinctValues([], "x")).toEqual([]);
    expect(distinctValues(undefined, "x")).toEqual([]);
  });
});

// ── rowMatchesFilters (multi-select + text filtering) ─────────────────────────
describe("rowMatchesFilters", () => {
  const row = { session_source: "google", session_medium: "cpc", session_campaign_name: "Spring Sale" };

  it("matches everything when no filters are active", () => {
    expect(rowMatchesFilters(row, {})).toBe(true);
    expect(rowMatchesFilters(row, { session_source: [] })).toBe(true);
    expect(rowMatchesFilters(row, { session_source: "" })).toBe(true);
  });

  it("array filter uses exact membership", () => {
    expect(rowMatchesFilters(row, { session_source: ["google", "bing"] })).toBe(true);
    expect(rowMatchesFilters(row, { session_source: ["bing"] })).toBe(false);
  });

  it("does not partial-match array values", () => {
    expect(rowMatchesFilters(row, { session_source: ["goog"] })).toBe(false);
  });

  it("string filter uses case-insensitive substring (legacy text filter)", () => {
    expect(rowMatchesFilters(row, { session_campaign_name: "spring" })).toBe(true);
    expect(rowMatchesFilters(row, { session_campaign_name: "winter" })).toBe(false);
  });

  it("combines multiple filters with AND", () => {
    expect(rowMatchesFilters(row, { session_source: ["google"], session_medium: ["cpc"] })).toBe(true);
    expect(rowMatchesFilters(row, { session_source: ["google"], session_medium: ["email"] })).toBe(false);
  });

  it("treats a missing column as empty string for matching", () => {
    expect(rowMatchesFilters(row, { session_term: ["anything"] })).toBe(false);
    expect(rowMatchesFilters({ ...row, session_term: "" }, { session_term: [""] })).toBe(true);
  });
});
