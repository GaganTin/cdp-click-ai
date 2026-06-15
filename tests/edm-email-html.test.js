import { describe, it, expect } from "vitest";
import { blocksToHtml, renderBlockHtml } from "../src/components/edm/emailHtml.js";

// Mirrors EmailBuilder BLOCK_DEFS defaults closely enough to exercise rendering.
const block = (type, config = {}) => ({ id: `${type}_1`, type, config });

const HEADER = block("header", { title: "Hi {{first_name}},", subtitle: "Welcome", bgColor: "#ffffff", color: "#111111", subtitleColor: "#6b7280", align: "left", fontSize: 26, padding: 24 });
const TEXT = block("text", { content: "Line one\nLine two", color: "#374151", fontSize: 15, lineHeight: 1.6, padding: 16 });
const BUTTON = block("button", { text: "Click here", url: "https://example.com", bgColor: "#2563eb", color: "#ffffff", align: "center", fontSize: 14, paddingV: 12, paddingH: 28, radius: 6, padding: 16 });
const IMAGE = block("image", { url: "https://img/x.png", alt: "Hero", link: "https://ex.com", width: 100, radius: 0, align: "center", padding: 0 });
const IMAGE_EMPTY = block("image", { url: "", alt: "", link: "", width: 100, radius: 0, align: "center", padding: 0 });
const DIVIDER = block("divider", { color: "#e5e7eb", thickness: 1, margin: 16 });
const SPACER = block("spacer", { height: 32 });
const COLUMNS = block("columns", { leftContent: "Left\ntext", rightContent: "Right text", color: "#374151", fontSize: 14, padding: 16 });

const ALL_BLOCKS = [HEADER, TEXT, BUTTON, IMAGE, DIVIDER, SPACER, COLUMNS];

// ── renderBlockHtml: per-block output ─────────────────────────────────────────

describe("renderBlockHtml - per block", () => {
  it("header keeps title/subtitle and personalisation tokens verbatim", () => {
    const html = renderBlockHtml(HEADER);
    expect(html).toContain("<h1");
    expect(html).toContain("Hi {{first_name}},");
    expect(html).toContain("Welcome");
    expect(html).toContain("font-size:26px");
    expect(html).toContain("text-align:left");
  });

  it("header omits the subtitle <p> when there is no subtitle", () => {
    const html = renderBlockHtml(block("header", { ...HEADER.config, subtitle: "" }));
    expect(html).toContain("<h1");
    // only the heading paragraph-less header - no subtitle paragraph
    expect(html).not.toContain("margin:8px 0 0");
  });

  it("text converts newlines to <br> and preserves content", () => {
    const html = renderBlockHtml(TEXT);
    expect(html).toContain("Line one<br>Line two");
    expect(html).toContain("line-height:1.6");
    expect(html).toContain("font-size:15px");
  });

  it("button renders an anchor with href, no underline, and label", () => {
    const html = renderBlockHtml(BUTTON);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("text-decoration:none");
    expect(html).toContain("Click here");
    expect(html).toContain("border-radius:6px");
    expect(html).toContain("display:inline-block");
  });

  it("image renders an <img> (and optional link) when a url is set", () => {
    const html = renderBlockHtml(IMAGE);
    expect(html).toContain("<img");
    expect(html).toContain('src="https://img/x.png"');
    expect(html).toContain('alt="Hero"');
    expect(html).toContain('<a href="https://ex.com">');
  });

  it("image renders a placeholder (no <img>) when url is empty", () => {
    const html = renderBlockHtml(IMAGE_EMPTY);
    expect(html).not.toContain("<img");
    expect(html).toContain("[ Image ]");
  });

  it("divider renders a styled <hr>", () => {
    const html = renderBlockHtml(DIVIDER);
    expect(html).toContain("<hr");
    expect(html).toContain("border-top:1px solid #e5e7eb");
  });

  it("spacer reserves vertical space and is not collapsible-empty", () => {
    const html = renderBlockHtml(SPACER);
    expect(html).toContain("height:32px");
    // Outlook collapses truly-empty divs; a spacer must carry content.
    expect(html).toContain("&nbsp;");
  });
});

// ── Columns regression: must not depend on host box-sizing ─────────────────────

describe("renderBlockHtml - columns layout (regression)", () => {
  const html = renderBlockHtml(COLUMNS);

  it("uses a presentation table, not bare inline-block percentage columns", () => {
    expect(html).toContain("<table");
    expect(html).toContain('role="presentation"');
    expect(html).not.toContain("display:inline-block");
  });

  it("splits into two equal 50% columns (no overflow/wrap)", () => {
    const cells = html.match(/width:50%/g) || [];
    expect(cells).toHaveLength(2);
    // The old, broken layout used 48% which wrapped without a box-sizing reset.
    expect(html).not.toContain("48%");
  });

  it("keeps both columns' content with newline handling", () => {
    expect(html).toContain("Left<br>text");
    expect(html).toContain("Right text");
  });
});

// ── blocksToHtml: document wrapper + reset (the core parity fix) ───────────────

describe("blocksToHtml - document wrapper", () => {
  it("emits a full HTML document with the 600px email container", () => {
    const html = blocksToHtml([HEADER]);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("max-width:600px");
    expect(html).toContain("margin:0 auto");
  });

  it("ships a CSS reset so the iframe matches the Tailwind build canvas", () => {
    const html = blocksToHtml([HEADER]);
    // box-sizing:border-box is what the build canvas relies on (Tailwind preflight)
    // but a srcDoc iframe does not get for free.
    expect(html).toContain("box-sizing:border-box");
    expect(html).toMatch(/<style>[\s\S]*<\/style>/);
    expect(html).toContain("margin:0;padding:0");
  });

  it("renders every block type into the body in order", () => {
    const html = blocksToHtml(ALL_BLOCKS);
    expect(html).toContain("<h1");        // header
    expect(html).toContain("<a href");    // button
    expect(html).toContain("<img");       // image
    expect(html).toContain("<hr");        // divider
    expect(html).toContain("<table");     // columns
    expect(html.indexOf("<h1")).toBeLessThan(html.indexOf("<table"));
  });

  it("returns inner-only HTML (no document chrome) when wrapEmail is false", () => {
    const html = blocksToHtml([HEADER], false);
    expect(html).not.toContain("<!DOCTYPE html>");
    expect(html).not.toContain("<body");
    expect(html).toContain("<h1");
  });

  it("handles empty and null block lists without throwing", () => {
    expect(() => blocksToHtml([])).not.toThrow();
    expect(() => blocksToHtml(null)).not.toThrow();
    expect(blocksToHtml([])).toContain("<!DOCTYPE html>");
  });

  it("preserves personalisation tokens for send-time replacement", () => {
    const html = blocksToHtml([HEADER]);
    expect(html).toContain("{{first_name}}");
  });
});
