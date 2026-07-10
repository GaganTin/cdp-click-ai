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

// A reusable 6-digit-code email body so every code email (sign-up, login MFA)
// looks identical.
function codeEmailHtml({ heading, intro, code, ttl }) {
  return `<p>${heading}</p>
          ${intro ? `<p>${intro}</p>` : ""}
          <p>Your code is:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:8px;margin:12px 0">${code}</p>
          <p>This code expires in ${ttl}.</p>
          <p>If you didn't request this, you can safely ignore this email.</p>`;
}

export async function sendPasswordResetEmail(to, token) {
  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    ...authSender(),
    subject: "Reset your Meritma password",
    html: `<p>We received a request to reset your password.</p>
           <p><a href="${link}">Reset your password</a> - this link is valid for 1 hour.</p>
           <p>If you didn't request this, you can safely ignore this email.</p>`,
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
    html: `<p>${inviter} to join ${workspace} on Meritma.</p>
           <p><a href="${link}">Accept your invitation</a> - this link is valid for 7 days.</p>
           <p>If you don't have a Meritma account yet, you'll be able to create one first, then the invitation is applied automatically.</p>
           <p>If you weren't expecting this, you can safely ignore this email.</p>`,
  });
}

export async function sendVerificationEmail(to, token) {
  const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    ...authSender(),
    subject: "Verify your Meritma email",
    html: `<p>Welcome to Meritma!</p>
           <p><a href="${link}">Verify your email address</a> - this link is valid for 24 hours.</p>`,
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

// ── Trial / plan lifecycle emails ───────────────────────────────────────────
// Sent by the daily lifecycle job (server/lib/billingLifecycle.js) as an account
// moves through its trial/plan expiry and (if never converted) end-of-life data
// purge. All are transactional, so they use the verified auth sender.

// Human date like "September 3, 2026" (UTC-agnostic display).
function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch { return String(d); }
}

const greet = (name) => `<p>Hi${name ? ` ${name}` : ""},</p>`;

// Shared upgrade blurb - there is no in-app payment flow, upgrades are applied by
// sales, so every CTA routes to support / the app.
const upgradeBlurb = () =>
  `<p>To keep your account active, upgrade to a <strong>Lite</strong> ($100/mo) or
   <strong>Standard</strong> ($199/mo) plan. Reply to this email or contact
   <a href="mailto:support@clickcdp.com">support@clickcdp.com</a> and we'll get you set up.
   You can review the plans anytime at <a href="${appUrl()}">${appUrl()}</a>.</p>`;

// T-warning_days: the trial/plan is about to end.
export async function sendTrialEndingEmail(to, { ownerName, daysLeft, expiresAt } = {}) {
  const days = Number(daysLeft);
  const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return sendEmail({
    to,
    ...authSender(),
    subject: `Your Meritma trial ends ${when}`,
    html: `${greet(ownerName)}
           <p>Your Meritma free trial ends <strong>${when}</strong> (${fmtDate(expiresAt)}).</p>
           ${upgradeBlurb()}
           <p>When the trial ends your workspace becomes read-only, and if you don't
              upgrade your data is scheduled for permanent deletion.</p>`,
  });
}

// T-0: the trial/plan has ended; data will be deleted after the retention window.
export async function sendTrialEndedEmail(to, { ownerName, deletionDate } = {}) {
  return sendEmail({
    to,
    ...authSender(),
    subject: "Your Meritma trial has ended",
    html: `${greet(ownerName)}
           <p>Your Meritma free trial has ended and your workspace is now read-only.</p>
           <p>If you don't upgrade, <strong>all of your data will be permanently deleted on
              ${fmtDate(deletionDate)}</strong> (6 months from today).</p>
           ${upgradeBlurb()}`,
  });
}

// T+6mo-1day: final notice before the purge runs.
export async function sendDataDeletionWarningEmail(to, { ownerName, deletionDate } = {}) {
  return sendEmail({
    to,
    ...authSender(),
    subject: "Action required: your Meritma data is deleted tomorrow",
    html: `${greet(ownerName)}
           <p>This is a final reminder. Your Meritma trial ended more than 6 months ago,
              and <strong>all of your data will be permanently deleted on
              ${fmtDate(deletionDate)}</strong>.</p>
           <p>Subscribe now to keep everything - once deleted, your data cannot be recovered.</p>
           ${upgradeBlurb()}`,
  });
}

// T+6mo: the purge has run.
export async function sendDataDeletedEmail(to, { ownerName } = {}) {
  return sendEmail({
    to,
    ...authSender(),
    subject: "Your Meritma data has been deleted",
    html: `${greet(ownerName)}
           <p>Because your Meritma trial ended more than 6 months ago without a subscription,
              all of your workspace data has now been permanently deleted.</p>
           <p>Your account email remains registered. If you'd like to start again, contact
              <a href="mailto:support@clickcdp.com">support@clickcdp.com</a> to set up a plan.</p>`,
  });
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
