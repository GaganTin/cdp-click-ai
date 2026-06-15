import { Resend } from "resend";

let _resend = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// Read at call time (NOT module load): in ESM, imports are evaluated before the
// entrypoint runs dotenv.config(), so capturing these at top-level would freeze
// them to "" and break the `from` field. Same reason APP_URL is a function below.
const defaultFromEmail = () => process.env.EDM_FROM_EMAIL || "";
const defaultFromName  = () => process.env.EDM_FROM_NAME  || "";

/**
 * Send a single email via Resend.
 * Returns { id, simulated } where simulated=true when API key is missing (dev mode).
 */
export async function sendEmail({ to, subject, html, text, fromEmail, fromName, replyTo, headers = {} }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[EDM] RESEND_API_KEY not set - email simulated, not sent.");
    return { id: `sim_${Date.now()}`, simulated: true };
  }

  const from = `${fromName || defaultFromName()} <${fromEmail || defaultFromEmail()}>`;

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

// ── Transactional auth emails ───────────────────────────────────────────────
// Reuse the same Resend transport (simulated when RESEND_API_KEY is unset).
// Resolved at call time for the same dotenv-timing reason as the sender above.
const appUrl = () => (process.env.APP_BASE_URL || process.env.CDP_ENDPOINT || "http://localhost:5173").replace(/\/$/, "");

export async function sendPasswordResetEmail(to, token) {
  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: "Reset your Click CDP password",
    html: `<p>We received a request to reset your password.</p>
           <p><a href="${link}">Reset your password</a> - this link is valid for 1 hour.</p>
           <p>If you didn't request this, you can safely ignore this email.</p>`,
  });
}

export async function sendVerificationEmail(to, token) {
  const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: "Verify your Click CDP email",
    html: `<p>Welcome to Click CDP!</p>
           <p><a href="${link}">Verify your email address</a> - this link is valid for 24 hours.</p>`,
  });
}

// Code-based sign-up verification: a 6-digit code the user types on the
// dedicated verify page to finish creating their account.
export async function sendVerificationCodeEmail(to, code) {
  return sendEmail({
    to,
    subject: "Your Click CDP verification code",
    html: `<p>Welcome to Click CDP!</p>
           <p>Your verification code is:</p>
           <p style="font-size:28px;font-weight:700;letter-spacing:8px;margin:12px 0">${code}</p>
           <p>Enter it on the verification page to finish creating your account. This code expires in 15 minutes.</p>
           <p>If you didn't request this, you can safely ignore this email.</p>`,
  });
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
