// ── Email HTML generation ──────────────────────────────────────────────────────
// Pure functions that turn the block model into the HTML that is ultimately
// rendered in preview iframes AND sent to recipients.
//
// IMPORTANT: this output must render identically to the live "Build" canvas in
// EmailBuilder.jsx. The canvas renders inside the app DOM, so it inherits
// Tailwind's preflight reset (box-sizing:border-box, zeroed element margins,
// block-level images, ...). A srcDoc iframe gets NONE of that, so we ship an
// equivalent reset in <head> and use layout primitives (tables, not raw
// inline-block %) that don't depend on the host box model. Keep the two in sync.

// Global/canvas settings for the whole email. Every field has a sensible default
// so old templates saved without a container still render exactly as before
// (600px centred white body on a light-grey page).
export const DEFAULT_EMAIL_CONTAINER = {
  contentWidth: 600,      // px — the email body column width (draggable on canvas)
  bgColor: "#f9fafb",     // page background behind the email body
  contentBg: "#ffffff",   // the email body background
  fontFamily: "sans-serif",
  paddingY: 0,            // padding inside the body column
  paddingX: 0,
};

// Column-ratio presets → [leftFlexPercent, rightFlexPercent]
const COLUMN_RATIOS = {
  "50-50": [50, 50],
  "60-40": [60, 40],
  "40-60": [40, 60],
  "70-30": [70, 30],
  "30-70": [30, 70],
};

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function renderBlockHtml(block) {
  const c = block.config;
  switch (block.type) {
    case "header": {
      const weight = c.fontWeight || 700;
      const lh = c.lineHeight || 1.2;
      const ls = c.letterSpacing ? `letter-spacing:${c.letterSpacing}px;` : "";
      return `<div style="background:${c.bgColor};padding:${c.padding}px;text-align:${c.align}">
  <h1 style="font-family:inherit;font-size:${c.fontSize}px;font-weight:${weight};color:${c.color};margin:0;line-height:${lh};${ls}">${c.title}</h1>
  ${c.subtitle ? `<p style="font-family:inherit;font-size:${c.subtitleSize || 15}px;color:${c.subtitleColor};margin:8px 0 0;line-height:1.5">${c.subtitle}</p>` : ""}
</div>`;
    }
    case "text": {
      const weight = c.fontWeight || 400;
      const align = c.align || "left";
      const bg = c.bgColor && c.bgColor !== "transparent" ? `background:${c.bgColor};` : "";
      return `<div style="padding:${c.padding}px;${bg}">
  <p style="font-family:inherit;font-size:${c.fontSize}px;font-weight:${weight};line-height:${c.lineHeight};color:${c.color};margin:0;text-align:${align}">${c.content.replace(/\n/g, "<br>")}</p>
</div>`;
    }
    case "button": {
      const weight = c.fontWeight || 600;
      const fullWidth = c.fullWidth ? "display:block;text-align:center;" : "display:inline-block;";
      const border = c.borderWidth ? `border:${c.borderWidth}px solid ${c.borderColor || c.bgColor};` : "";
      return `<div style="padding:${c.padding}px;text-align:${c.align}">
  <a href="${c.url}" style="${fullWidth}background:${c.bgColor};color:${c.color};padding:${c.paddingV}px ${c.paddingH}px;text-decoration:none;border-radius:${c.radius}px;font-family:inherit;font-size:${c.fontSize}px;font-weight:${weight};${border}">${c.text}</a>
</div>`;
    }
    case "image": {
      if (!c.url) return `<div style="padding:16px;text-align:center;background:#f8fafc;color:#94a3b8;font-family:inherit;font-size:13px">[ Image ]</div>`;
      const shadow = c.shadow ? "box-shadow:0 4px 16px rgba(0,0,0,0.15);" : "";
      const border = c.borderWidth ? `border:${c.borderWidth}px solid ${c.borderColor || "#e5e7eb"};` : "";
      return `<div style="padding:${c.padding}px;text-align:${c.align}">
  ${c.link ? `<a href="${c.link}">` : ""}
  <img src="${c.url}" alt="${c.alt}" style="max-width:${c.width}%;border-radius:${c.radius}px;display:block;${shadow}${border}${c.align === "center" ? "margin:0 auto" : c.align === "right" ? "margin:0 0 0 auto" : ""}"/>
  ${c.link ? "</a>" : ""}
</div>`;
    }
    case "divider": {
      const style = c.style || "solid";
      const widthPct = num(c.widthPct, 100);
      const mAuto = widthPct < 100 ? "margin-left:auto;margin-right:auto;" : "";
      return `<div style="padding:0 24px"><hr style="border:none;border-top:${c.thickness}px ${style} ${c.color};margin:${c.margin}px 0;width:${widthPct}%;${mAuto}"/></div>`;
    }
    case "spacer":
      return `<div style="height:${c.height}px;line-height:${c.height}px;font-size:1px">&nbsp;</div>`;
    case "columns": {
      // A presentation table renders identically across clients and never
      // collapses/wraps the way bare inline-block % columns do without a reset.
      const [lw, rw] = COLUMN_RATIOS[c.ratio] || COLUMN_RATIOS["50-50"];
      const gap = num(c.gap, 16);
      const half = Math.round(gap / 2);
      const valign = c.valign || "top";
      const bg = c.bgColor && c.bgColor !== "transparent" ? `background:${c.bgColor};` : "";
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;${bg}">
  <tr>
    <td valign="${valign}" style="width:${lw}%;padding:${c.padding}px;padding-right:${half}px">
      <p style="font-family:inherit;font-size:${c.fontSize}px;color:${c.color};margin:0;line-height:1.6">${c.leftContent.replace(/\n/g, "<br>")}</p>
    </td>
    <td valign="${valign}" style="width:${rw}%;padding:${c.padding}px;padding-left:${half}px">
      <p style="font-family:inherit;font-size:${c.fontSize}px;color:${c.color};margin:0;line-height:1.6">${c.rightContent.replace(/\n/g, "<br>")}</p>
    </td>
  </tr>
</table>`;
    }
    default: return "";
  }
}

export function blocksToHtml(blocks, wrapEmail = true, container = null) {
  const inner = (blocks || []).map(b => renderBlockHtml(b)).join("\n");
  if (!wrapEmail) return inner;
  const ct = { ...DEFAULT_EMAIL_CONTAINER, ...(container || {}) };
  const bodyPad = (ct.paddingY || ct.paddingX)
    ? `padding:${ct.paddingY || 0}px ${ct.paddingX || 0}px;`
    : "";
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email</title>
<style>
  *,*::before,*::after{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{background:${ct.bgColor};font-family:${ct.fontFamily};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  img{border:0;display:block;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
  table{border-collapse:collapse;}
  p,h1,h2,h3,h4{margin:0;}
</style>
</head>
<body>
<div style="max-width:${ct.contentWidth}px;margin:0 auto;background:${ct.contentBg};${bodyPad}">
${inner}
</div></body></html>`;
}
