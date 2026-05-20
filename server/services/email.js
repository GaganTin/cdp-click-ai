import { Resend } from "resend";

let _resend = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const DEFAULT_FROM_EMAIL = process.env.EDM_FROM_EMAIL || "onboarding@resend.dev";
const DEFAULT_FROM_NAME  = process.env.EDM_FROM_NAME  || "Click AI";

/**
 * Send a single email via Resend.
 * Returns { id, simulated } where simulated=true when API key is missing (dev mode).
 */
export async function sendEmail({ to, subject, html, text, fromEmail, fromName, replyTo, headers = {} }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[EDM] RESEND_API_KEY not set - email simulated, not sent.");
    return { id: `sim_${Date.now()}`, simulated: true };
  }

  const from = `${fromName || DEFAULT_FROM_NAME} <${fromEmail || DEFAULT_FROM_EMAIL}>`;

  const result = await getResend().emails.send({
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text: text || stripHtml(html),
    reply_to: replyTo || undefined,
    headers,
  });

  if (result.error) throw new Error(result.error.message || "Resend error");
  return result.data;
}

/**
 * Send to many recipients in controlled batches.
 * Returns array of { email, sendId, resendId, error } results.
 */
export async function sendBatch(recipients, campaignPayload, batchSize = 50, delayMs = 200) {
  const results = [];
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(async (r) => {
        try {
          const data = await sendEmail({
            to: r.email,
            subject: campaignPayload.subject,
            html: r.html,
            text: r.text,
            fromEmail: campaignPayload.from_email,
            fromName: campaignPayload.from_name,
            replyTo: campaignPayload.reply_to,
            headers: {
              "List-Unsubscribe": campaignPayload.unsubscribeUrl
                ? `<${campaignPayload.unsubscribeUrl}>`
                : undefined,
              "X-EDM-Campaign": campaignPayload.id,
            },
          });
          return { email: r.email, sendId: r.sendId, resendId: data.id, error: null };
        } catch (err) {
          return { email: r.email, sendId: r.sendId, resendId: null, error: err.message };
        }
      })
    );
    settled.forEach((s) => results.push(s.status === "fulfilled" ? s.value : { ...s.reason, error: s.reason?.message }));
    if (i + batchSize < recipients.length) await sleep(delayMs);
  }
  return results;
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
