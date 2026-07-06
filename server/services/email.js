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
const appUrl = () => (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || process.env.CDP_ENDPOINT || "http://localhost:5173").replace(/\/$/, "");

// Transactional auth mail should come from the VERIFIED domain (meritma.com),
// NOT the EDM campaign sender (which may be a shared resend.dev address). Falls
// back to the EDM sender so dev keeps working if AUTH_FROM_EMAIL is unset.
const authFromEmail = () => process.env.AUTH_FROM_EMAIL || defaultFromEmail();
const authFromName  = () => process.env.AUTH_FROM_NAME  || defaultFromName() || "Meritma";
const authSender = () => ({ fromEmail: authFromEmail(), fromName: authFromName() });

// Logo shown at the top of every branded (transactional) email. Uses a HOSTED
// URL, not a data: URI — Gmail and many clients strip inline base64 images.
// public/logo-light.png ships to dist/ at build time, so it's served at the app
// root; EMAIL_LOGO_URL overrides that if the app URL isn't publicly reachable.
const logoUrl = () => process.env.EMAIL_LOGO_URL || `${appUrl()}/logo-light.png`;

// Wrap a transactional email body in a consistent, branded layout: a centered
// content column with the Meritma logo in the header. All inline styles + a
// table for the logo row so it renders reliably across email clients (Outlook,
// Gmail, Apple Mail). width/height on the <img> keep the logo from reflowing
// while the image loads and cap it at a tasteful ~120px.
function emailLayout(bodyHtml) {
  return `<div style="background:#f6f7f9;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;color:#1a1a1a;font-size:15px;line-height:1.55">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr><td>
      <img src="${logoUrl()}" alt="Meritma" width="120" height="93" style="display:block;width:120px;height:auto;border:0;outline:none;text-decoration:none" />
    </td></tr></table>
    ${bodyHtml}
  </div>
</div>`;
}

// A reusable 6-digit-code email body so every code email (sign-up, login MFA)
// looks identical.
function codeEmailHtml({ heading, intro, code, ttl }) {
  return emailLayout(`<p style="margin:0 0 12px"><strong>${heading}</strong></p>
          ${intro ? `<p style="margin:0 0 12px">${intro}</p>` : ""}
          <p style="margin:0 0 4px">Your code is:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:8px;margin:12px 0">${code}</p>
          <p style="margin:0 0 12px">This code expires in ${ttl}.</p>
          <p style="margin:0;color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>`);
}

export async function sendPasswordResetEmail(to, token) {
  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    ...authSender(),
    subject: "Reset your Meritma password",
    html: emailLayout(`<p style="margin:0 0 12px">We received a request to reset your password.</p>
           <p style="margin:0 0 12px"><a href="${link}" style="color:#1a1a1a;font-weight:600">Reset your password</a> - this link is valid for 1 hour.</p>
           <p style="margin:0;color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>`),
  });
}

// Workspace invitation: emailed to a teammate an admin invited. The link lands on
// the /join/:token page, which accepts the invite once the recipient is signed in
// (registering first if they don't have an account yet).
export async function sendInvitationEmail(to, token, { companyName, inviterName } = {}) {
  const link = `${appUrl()}/join/${encodeURIComponent(token)}`;
  const workspace = companyName ? `<strong>${companyName}</strong>` : "a workspace";
  const inviter = inviterName ? `${inviterName} invited you` : "You've been invited";
  return sendEmail({
    to,
    ...authSender(),
    subject: companyName ? `You're invited to join ${companyName} on Meritma` : "You're invited to join a workspace on Meritma",
    html: emailLayout(`<p style="margin:0 0 12px">${inviter} to join ${workspace} on Meritma.</p>
           <p style="margin:0 0 12px"><a href="${link}" style="color:#1a1a1a;font-weight:600">Accept your invitation</a> - this link is valid for 7 days.</p>
           <p style="margin:0 0 12px">If you don't have a Meritma account yet, you'll be able to create one first, then the invitation is applied automatically.</p>
           <p style="margin:0;color:#6b7280;font-size:13px">If you weren't expecting this, you can safely ignore this email.</p>`),
  });
}

export async function sendVerificationEmail(to, token) {
  const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    ...authSender(),
    subject: "Verify your Meritma email",
    html: emailLayout(`<p style="margin:0 0 12px"><strong>Welcome to Meritma!</strong></p>
           <p style="margin:0"><a href="${link}" style="color:#1a1a1a;font-weight:600">Verify your email address</a> - this link is valid for 24 hours.</p>`),
  });
}

// Code-based sign-up verification: a 6-digit code the user types on the
// dedicated verify page to finish creating their account.
export async function sendVerificationCodeEmail(to, code) {
  return sendEmail({
    to,
    ...authSender(),
    subject: "Your Meritma verification code",
    html: codeEmailHtml({
      heading: "Welcome to Meritma!",
      intro: "Enter this code on the verification page to finish creating your account.",
      code,
      ttl: "15 minutes",
    }),
  });
}

// Two-factor login: a 6-digit code emailed during sign-in when the user has MFA
// enabled, OR when confirming they can receive codes while turning MFA on.
export async function sendLoginCodeEmail(to, code, { purpose = "login" } = {}) {
  const enabling = purpose === "enable";
  return sendEmail({
    to,
    ...authSender(),
    subject: enabling ? "Confirm two-factor authentication" : "Your Meritma sign-in code",
    html: codeEmailHtml({
      heading: enabling ? "Turn on two-factor authentication" : "Sign-in verification",
      intro: enabling
        ? "Enter this code to confirm and turn on two-factor authentication."
        : "Enter this code to finish signing in to your account.",
      code,
      ttl: "10 minutes",
    }),
  });
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
