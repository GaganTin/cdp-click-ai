const TRACKING_BASE = (process.env.EDM_TRACKING_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

/**
 * Rewrite all href links in html to pass through click-tracking redirect,
 * then inject a 1x1 open-tracking pixel before </body>.
 */
export function injectTracking(html, sendId) {
  if (!html) return html;

  // Wrap every http(s) link - skip mailto: and tracking redirects already applied
  const clickTracked = html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_, url) => {
      const encoded = encodeURIComponent(url);
      return `href="${TRACKING_BASE}/track/c/${sendId}/${encoded}"`;
    }
  );

  const pixel = `<img src="${TRACKING_BASE}/track/o/${sendId}" width="1" height="1" border="0" style="display:none;height:1px;width:1px;" alt="" />`;

  return clickTracked.includes("</body>")
    ? clickTracked.replace("</body>", `${pixel}\n</body>`)
    : clickTracked + pixel;
}

/**
 * Replace {{token}} placeholders with member data.
 * Falls back gracefully when the field is missing.
 */
export function applyPersonalization(html, member) {
  if (!html || !member) return html;
  const v = (val, fallback = "") => String(val ?? fallback);
  return html
    .replace(/\{\{first_name\}\}/gi,   v(member.eng_first_name || member.display_name, "there"))
    .replace(/\{\{last_name\}\}/gi,    v(member.eng_last_name))
    .replace(/\{\{full_name\}\}/gi,    v(member.eng_full_name  || member.display_name))
    .replace(/\{\{email\}\}/gi,        v(member.primary_email))
    .replace(/\{\{member_type\}\}/gi,  v(member.member_type))
    .replace(/\{\{member_no\}\}/gi,    v(member.member_no));
}

/**
 * Inject UTM query params onto every http(s) link.
 * Skips links that already have utm_ params.
 */
export function applyUtmToLinks(html, utmParams) {
  if (!html || !utmParams) return html;
  const params = Object.fromEntries(
    Object.entries(utmParams).filter(([k, v]) => k.startsWith("utm_") && v)
  );
  if (!Object.keys(params).length) return html;

  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url) => {
    try {
      if (url.includes("utm_source")) return match; // already has UTM
      const u = new URL(url);
      Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
      return `href="${u.toString()}"`;
    } catch {
      return match;
    }
  });
}

/**
 * Inject a plain-text unsubscribe footer and the mandatory physical address
 * required by CAN-SPAM / GDPR regulations.
 */
export function injectUnsubscribeFooter(html, unsubscribeUrl, orgAddress = "") {
  const footer = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;font-family:sans-serif;">
  <p style="margin:0 0 8px;">
    You received this email because you opted in to marketing communications.
  </p>
  ${unsubscribeUrl ? `<p style="margin:0 0 8px;"><a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a></p>` : ""}
  ${orgAddress ? `<p style="margin:0;">${orgAddress}</p>` : ""}
</div>`;

  return html.includes("</body>")
    ? html.replace("</body>", `${footer}\n</body>`)
    : html + footer;
}

export function getTrackingBase() {
  return TRACKING_BASE;
}
