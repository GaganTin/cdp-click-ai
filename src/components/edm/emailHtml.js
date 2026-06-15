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

export function renderBlockHtml(block) {
  const c = block.config;
  switch (block.type) {
    case "header":
      return `<div style="background:${c.bgColor};padding:${c.padding}px;text-align:${c.align}">
  <h1 style="font-family:sans-serif;font-size:${c.fontSize}px;font-weight:700;color:${c.color};margin:0;line-height:1.2">${c.title}</h1>
  ${c.subtitle ? `<p style="font-family:sans-serif;font-size:15px;color:${c.subtitleColor};margin:8px 0 0;line-height:1.5">${c.subtitle}</p>` : ""}
</div>`;
    case "text":
      return `<div style="padding:${c.padding}px">
  <p style="font-family:sans-serif;font-size:${c.fontSize}px;line-height:${c.lineHeight};color:${c.color};margin:0">${c.content.replace(/\n/g, "<br>")}</p>
</div>`;
    case "button":
      return `<div style="padding:${c.padding}px;text-align:${c.align}">
  <a href="${c.url}" style="display:inline-block;background:${c.bgColor};color:${c.color};padding:${c.paddingV}px ${c.paddingH}px;text-decoration:none;border-radius:${c.radius}px;font-family:sans-serif;font-size:${c.fontSize}px;font-weight:600">${c.text}</a>
</div>`;
    case "image":
      if (!c.url) return `<div style="padding:16px;text-align:center;background:#f8fafc;color:#94a3b8;font-family:sans-serif;font-size:13px">[ Image ]</div>`;
      return `<div style="padding:${c.padding}px;text-align:${c.align}">
  ${c.link ? `<a href="${c.link}">` : ""}
  <img src="${c.url}" alt="${c.alt}" style="max-width:${c.width}%;border-radius:${c.radius}px;display:block;${c.align === "center" ? "margin:0 auto" : ""}"/>
  ${c.link ? "</a>" : ""}
</div>`;
    case "divider":
      return `<hr style="border:none;border-top:${c.thickness}px solid ${c.color};margin:${c.margin}px 24px"/>`;
    case "spacer":
      return `<div style="height:${c.height}px;line-height:${c.height}px;font-size:1px">&nbsp;</div>`;
    case "columns":
      // Matches the flex canvas (two equal columns, 16px gutter). A presentation
      // table renders identically across clients and never collapses/wraps the
      // way bare inline-block % columns do without a box-sizing reset.
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse">
  <tr>
    <td valign="top" style="width:50%;padding:${c.padding}px;padding-right:8px">
      <p style="font-family:sans-serif;font-size:${c.fontSize}px;color:${c.color};margin:0;line-height:1.6">${c.leftContent.replace(/\n/g, "<br>")}</p>
    </td>
    <td valign="top" style="width:50%;padding:${c.padding}px;padding-left:8px">
      <p style="font-family:sans-serif;font-size:${c.fontSize}px;color:${c.color};margin:0;line-height:1.6">${c.rightContent.replace(/\n/g, "<br>")}</p>
    </td>
  </tr>
</table>`;
    default: return "";
  }
}

export function blocksToHtml(blocks, wrapEmail = true) {
  const inner = (blocks || []).map(b => renderBlockHtml(b)).join("\n");
  if (!wrapEmail) return inner;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email</title>
<style>
  *,*::before,*::after{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{background:#f9fafb;font-family:sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  img{border:0;display:block;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
  table{border-collapse:collapse;}
  p,h1,h2,h3,h4{margin:0;}
</style>
</head>
<body>
<div style="max-width:600px;margin:0 auto;background:#ffffff">
${inner}
</div></body></html>`;
}
