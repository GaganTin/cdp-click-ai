import { Router } from "express";
import { authenticate, resolveCompanyId } from "../middleware/auth.js";
import { getEmailQuota, recordEmailsSent } from "../lib/addons.js";
import { sendEmail, sendBatch } from "../services/email.js";
import { notifyCompany } from "../lib/notifications.js";
import { injectTracking, applyPersonalization, applyUtmToLinks, injectUnsubscribeFooter, getTrackingBase } from "../services/tracking.js";

// Eligible EDM recipients for a company ($1 = company_id): opted in, has a real
// email, belongs to the company, and is not on the company's suppression list.
const ELIGIBLE_RECIPIENTS_WHERE = `WHERE cp.is_opt_in_email = true
          AND cp.primary_email IS NOT NULL
          AND cp.primary_email != ''
          AND cp.company_id = $1
          AND cp.primary_email NOT IN (
            SELECT email FROM app.edm_suppression WHERE company_id = $1
          )`;

export function createEdmRouter(pool) {
  const router = Router();

  // ── helpers ────────────────────────────────────────────────────────────────

  function ok(res, data, status = 200) { res.status(status).json(data); }
  function err(res, msg, status = 400) { res.status(status).json({ error: msg }); }

  // Coerce a value to a valid UUID or null - rejects strings like "undefined" or ""
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function uuidOrNull(v) { return (v && UUID_RE.test(v)) ? v : null; }

  function normalizeTs(row) {
    if (!row) return null;
    const r = { ...row };
    ["created_date","updated_date","sent_at","scheduled_at","enrolled_at","completed_at","added_at","occurred_at"].forEach(k => {
      if (r[k] instanceof Date) r[k] = r[k].toISOString();
    });
    return r;
  }

  // Every authenticated route requires the caller to be an active member of the
  // x-company-id workspace (verified) - viewers are read-only.
  const getCompanyId = (req, res) => resolveCompanyId(pool, req, res);

  // ══════════════════════════════════════════════════════════════════════════
  // TEMPLATES
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/templates", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.edm_templates WHERE company_id=$1 ORDER BY created_date DESC LIMIT 100`,
        [companyId]
      );
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/templates", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const { name, subject, preview_text, html_body, text_body, variables = {}, status = "draft" } = req.body;
    if (!name || !subject || !html_body) return err(res, "name, subject, and html_body are required");
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.edm_templates (company_id, name, subject, preview_text, html_body, text_body, variables, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [companyId, name, subject, preview_text||null, html_body, text_body||null, JSON.stringify(variables), status]
      );
      ok(res, normalizeTs(rows[0]), 201);
    } catch (e) { err(res, e.message, 500); }
  });

  router.get("/templates/:id", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.edm_templates WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (!rows.length) return err(res, "Template not found", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  router.patch("/templates/:id", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const allowed = ["name","subject","preview_text","html_body","text_body","variables","status"];
    const keys = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!keys.length) return err(res, "No valid fields to update");
    try {
      const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(", ");
      const vals = keys.map(k => k === "variables" ? JSON.stringify(req.body[k]) : req.body[k]);
      const { rows } = await pool.query(
        `UPDATE app.edm_templates SET ${sets} WHERE id=$1 AND company_id=$2 RETURNING *`,
        [req.params.id, companyId, ...vals]
      );
      if (!rows.length) return err(res, "Template not found", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  router.delete("/templates/:id", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      await pool.query(`DELETE FROM app.edm_templates WHERE id=$1 AND company_id=$2`, [req.params.id, companyId]);
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/templates/:id/duplicate", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows: [src] } = await pool.query(
        `SELECT * FROM app.edm_templates WHERE id=$1 AND company_id=$2`, [req.params.id, companyId]
      );
      if (!src) return err(res, "Template not found", 404);
      const { rows: [copy] } = await pool.query(
        `INSERT INTO app.edm_templates (company_id, name, subject, preview_text, html_body, text_body, variables, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'draft') RETURNING *`,
        [companyId, `${src.name} (copy)`, src.subject, src.preview_text, src.html_body, src.text_body, JSON.stringify(src.variables || {})]
      );
      ok(res, normalizeTs(copy), 201);
    } catch (e) { err(res, e.message, 500); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CAMPAIGNS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/campaigns", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows } = await pool.query(`
        SELECT ec.*,
          s.name AS segment_name, t.name AS template_name, c.name AS utm_campaign_name,
          COALESCE(SUM(CASE WHEN ev.event_type='open'        THEN 1 END), 0)::int AS open_count,
          COALESCE(SUM(CASE WHEN ev.event_type='click'       THEN 1 END), 0)::int AS click_count,
          COALESCE(SUM(CASE WHEN ev.event_type='bounce'      THEN 1 END), 0)::int AS bounce_count,
          COALESCE(SUM(CASE WHEN ev.event_type='unsubscribe' THEN 1 END), 0)::int AS unsubscribe_count,
          COALESCE(SUM(CASE WHEN ev.event_type='delivered'   THEN 1 END), 0)::int AS delivered_count
        FROM app.edm_campaigns ec
        LEFT JOIN app.segments s ON s.id = ec.segment_id
        LEFT JOIN app.edm_templates t ON t.id = ec.template_id AND t.company_id = ec.company_id
        LEFT JOIN app.campaigns c ON c.id = ec.utm_campaign_id AND c.company_id = ec.company_id
        LEFT JOIN app.edm_events ev ON ev.edm_campaign_id = ec.id
        WHERE ec.company_id=$1
        GROUP BY ec.id, s.name, t.name, c.name
        ORDER BY ec.created_date DESC LIMIT 100
      `, [companyId]);
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/campaigns", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const {
      name, subject, preview_text, from_name, from_email, reply_to,
      template_id, html_body, text_body, segment_id, utm_campaign_id,
      status = "draft", scheduled_at, ab_test_config = {}
    } = req.body;
    if (!name || !subject || !from_email) return err(res, "name, subject, and from_email are required");
    try {
      // Drafts are free to create; the emails-sent quota is enforced at SEND time
      // (POST /campaigns/:id/send) against the monthly counter + prepaid add-ons.
      const { rows } = await pool.query(
        `INSERT INTO app.edm_campaigns
           (company_id, name, subject, preview_text, from_name, from_email, reply_to,
            template_id, html_body, text_body, segment_id, utm_campaign_id,
            status, scheduled_at, ab_test_config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [companyId, name, subject, preview_text||null, from_name||"", from_email, reply_to||null,
         uuidOrNull(template_id), html_body||null, text_body||null,
         uuidOrNull(segment_id), uuidOrNull(utm_campaign_id),
         status, scheduled_at||null, JSON.stringify(ab_test_config)]
      );
      ok(res, normalizeTs(rows[0]), 201);
    } catch (e) { err(res, e.message, 500); }
  });

  router.get("/campaigns/:id", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows } = await pool.query(`
        SELECT ec.*, s.name AS segment_name, t.name AS template_name
        FROM app.edm_campaigns ec
        LEFT JOIN app.segments s ON s.id = ec.segment_id
        LEFT JOIN app.edm_templates t ON t.id = ec.template_id AND t.company_id = ec.company_id
        WHERE ec.id=$1 AND ec.company_id=$2`, [req.params.id, companyId]);
      if (!rows.length) return err(res, "Campaign not found", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  router.patch("/campaigns/:id", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const allowed = ["name","subject","preview_text","from_name","from_email","reply_to",
                     "template_id","html_body","text_body","segment_id","utm_campaign_id",
                     "status","scheduled_at","ab_test_config"];
    const UUID_FIELDS = new Set(["segment_id", "utm_campaign_id", "template_id"]);
    const keys = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!keys.length) return err(res, "No valid fields to update");
    try {
      const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(", ");
      const vals = keys.map(k => {
        if (UUID_FIELDS.has(k)) return uuidOrNull(req.body[k]);
        if (k === "ab_test_config") return JSON.stringify(req.body[k] ?? {});
        return req.body[k] ?? null;
      });
      const { rows } = await pool.query(
        `UPDATE app.edm_campaigns SET ${sets} WHERE id=$1 AND company_id=$2 RETURNING *`,
        [req.params.id, companyId, ...vals]
      );
      if (!rows.length) return err(res, "Campaign not found", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  // Only draft emails can be deleted. Anything that has been scheduled, sent, or
  // is otherwise in-flight must be archived instead (see /archive below), so the
  // historical record and its analytics are preserved.
  router.delete("/campaigns/:id", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows: [campaign] } = await pool.query(
        `SELECT status FROM app.edm_campaigns WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (!campaign) return err(res, "Campaign not found", 404);
      if (campaign.status !== "draft") {
        return err(res, "Only draft emails can be deleted. Archive it instead.", 409);
      }
      await pool.query(`DELETE FROM app.edm_campaigns WHERE id=$1 AND company_id=$2`, [req.params.id, companyId]);
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  // Archive a non-draft email. Archived emails stay visible (in the Archived
  // group) but are removed from the active workflow. Sending campaigns can't be
  // archived mid-flight.
  router.post("/campaigns/:id/archive", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `UPDATE app.edm_campaigns SET status='archived'
         WHERE id=$1 AND company_id=$2 AND status <> 'sending'
         RETURNING *`,
        [req.params.id, companyId]
      );
      if (!rows.length) return err(res, "Campaign not found or cannot be archived while sending", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  // ── Standalone recipients preview ───────────────────────────────────────────
  router.get("/recipients/preview", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows } = await pool.query(`
        SELECT COUNT(*) AS total
        FROM app.customer_profiles cp
        ${ELIGIBLE_RECIPIENTS_WHERE}
      `, [companyId]);
      ok(res, { count: Number(rows[0].total) });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── EDM settings (sender defaults from company DB settings + env fallback) ──
  router.get("/settings", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows: [company] } = await pool.query(
        `SELECT settings FROM app.companies WHERE id = $1`, [companyId]
      );
      const s = company?.settings || {};
      ok(res, {
        from_name:  s.edm_from_name  || process.env.EDM_FROM_NAME  || "",
        from_email: s.edm_from_email || process.env.EDM_FROM_EMAIL || "",
        reply_to:   s.edm_reply_to   || "",
      });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── Standalone test send ───────────────────────────────────────────────────
  router.post("/test-send", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const { test_email, subject, html_body, from_name, from_email, reply_to } = req.body;
    if (!test_email) return err(res, "test_email is required");
    if (!subject)    return err(res, "subject is required");
    if (!html_body)  return err(res, "html_body is required");
    try {
      const { rows: [company] } = await pool.query(
        `SELECT settings FROM app.companies WHERE id = $1`, [companyId]
      );
      const s = company?.settings || {};
      const effectiveFromEmail = from_email || s.edm_from_email || process.env.EDM_FROM_EMAIL || "";
      const effectiveFromName  = from_name  || s.edm_from_name  || process.env.EDM_FROM_NAME  || "";
      const testMember = {
        eng_first_name: "Test", eng_last_name: "Recipient",
        eng_full_name: "Test Recipient", email: test_email,
        member_type: "Member", member_no: "TEST001",
      };
      const personalised = applyPersonalization(html_body, testMember);
      const result = await sendEmail({
        to: test_email,
        subject: `[TEST] ${subject}`,
        html: personalised,
        fromEmail: effectiveFromEmail,
        fromName: effectiveFromName,
        replyTo: reply_to || null,
      });
      ok(res, { success: true, message_id: result.id, simulated: result.simulated || false });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── Preview recipients before sending ─────────────────────────────────────
  router.get("/campaigns/:id/recipients/preview", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows: [campaign] } = await pool.query(
        `SELECT * FROM app.edm_campaigns WHERE id=$1 AND company_id=$2`, [req.params.id, companyId]
      );
      if (!campaign) return err(res, "Campaign not found", 404);
      if (!campaign.segment_id) return ok(res, { count: 0, sample: [], message: "No segment assigned" });

      const { rows: segment } = await pool.query(
        `SELECT metadata FROM app.segments WHERE id=$1 AND company_id=$2`, [campaign.segment_id, companyId]
      );

      const { rows } = await pool.query(`
        SELECT cp.member_id, cp.primary_email AS email, cp.eng_full_name AS name,
               cp.member_type, cp.is_opt_in_email
        FROM app.customer_profiles cp
        ${ELIGIBLE_RECIPIENTS_WHERE}
        ORDER BY cp.member_join_date DESC
        LIMIT 500
      `, [companyId]);

      ok(res, { count: rows.length, sample: rows.slice(0, 10), segment: segment[0] || null });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── SEND a campaign ────────────────────────────────────────────────────────
  router.post("/campaigns/:id/send", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: [campaign] } = await client.query(
        `SELECT * FROM app.edm_campaigns WHERE id=$1 AND company_id=$2`, [req.params.id, companyId]
      );
      if (!campaign) { await client.query("ROLLBACK"); return err(res, "Campaign not found", 404); }
      if (campaign.status === "sent") { await client.query("ROLLBACK"); return err(res, "Campaign already sent"); }

      let html = campaign.html_body || "";
      if (campaign.template_id) {
        const { rows: [tpl] } = await client.query(
          `SELECT html_body FROM app.edm_templates WHERE id=$1 AND company_id=$2`,
          [campaign.template_id, companyId]
        );
        if (tpl) html = tpl.html_body;
      }
      if (!html) { await client.query("ROLLBACK"); return err(res, "Campaign has no email body"); }

      let utmParams = null;
      if (campaign.utm_campaign_id) {
        const { rows: [utm] } = await client.query(
          `SELECT utm_source, utm_medium, utm_campaign, utm_term, utm_content
           FROM app.campaigns WHERE id=$1 AND company_id=$2`,
          [campaign.utm_campaign_id, companyId]
        );
        utmParams = utm || null;
      }

      const { rows: recipients } = await client.query(`
        SELECT cp.member_id, cp.primary_email AS email,
               cp.eng_first_name, cp.eng_last_name, cp.eng_full_name,
               cp.display_name, cp.member_type, cp.member_no
        FROM app.customer_profiles cp
        ${ELIGIBLE_RECIPIENTS_WHERE}
        LIMIT 10000
      `, [companyId]);

      if (!recipients.length) {
        await client.query("ROLLBACK");
        return err(res, "No eligible recipients after opt-in and suppression filtering");
      }

      // Emails-sent quota: monthly base (plan.limits.campaigns) + prepaid
      // email_credits add-ons. Add-ons are frozen when the plan lapses.
      const { rows: [acc] } = await client.query(
        "SELECT account_id FROM app.companies WHERE id=$1", [companyId]
      );
      const accountId = acc?.account_id;
      if (accountId) {
        const q = await getEmailQuota(pool, accountId);
        if (!q.planActive) {
          await client.query("ROLLBACK");
          return err(res, "Your plan has ended - resubscribe to send emails and use add-ons.", 403);
        }
        if (q.limit != null && q.used + recipients.length > q.limit) {
          await client.query("ROLLBACK");
          return err(res, `Sending ${recipients.length.toLocaleString()} emails would exceed your monthly limit of ${q.limit.toLocaleString()} (used ${q.used.toLocaleString()}). Buy an email add-on or upgrade.`, 403);
        }
      }

      await client.query(
        `UPDATE app.edm_campaigns SET status='sending', total_recipients=$2 WHERE id=$1`,
        [campaign.id, recipients.length]
      );

      const sendRows = await Promise.all(recipients.map(async (r) => {
        const { rows: [s] } = await client.query(
          `INSERT INTO app.edm_sends (edm_campaign_id, email, member_id, status)
           VALUES ($1,$2,$3,'queued') RETURNING id`,
          [campaign.id, r.email, r.member_id]
        );
        return s.id;
      }));

      await client.query("COMMIT");

      // Meter the send against the monthly emails-sent counter + draw the overflow
      // from prepaid email_credits add-ons (best-effort; never blocks delivery).
      if (accountId) {
        await recordEmailsSent(pool, {
          accountId, companyId, userId: req.user?.id || null,
          count: recipients.length, metadata: { campaign_id: campaign.id },
        });
      }

      const TRACKING_BASE = getTrackingBase();
      const sendPayloads = recipients.map((r, i) => {
        const sendId = sendRows[i];
        let recipientHtml = applyPersonalization(html, r);
        if (utmParams) recipientHtml = applyUtmToLinks(recipientHtml, utmParams);
        const unsubUrl = `${TRACKING_BASE}/track/u/${sendId}`;
        recipientHtml = injectUnsubscribeFooter(recipientHtml, unsubUrl);
        recipientHtml = injectTracking(recipientHtml, sendId);
        return { email: r.email, sendId, html: recipientHtml };
      });

      res.json({
        success: true,
        campaign_id: campaign.id,
        total_recipients: recipients.length,
        message: "Send started - check campaign stats for delivery status",
      });

      const results = await sendBatch(sendPayloads, {
        subject: campaign.subject,
        from_email: campaign.from_email,
        from_name: campaign.from_name,
        reply_to: campaign.reply_to,
        id: campaign.id,
        unsubscribeUrl: `${TRACKING_BASE}/track/u/{{sendId}}`,
      });

      const sentIds = [], failedResults = [];
      results.forEach(r => {
        if (r.error) failedResults.push(r);
        else sentIds.push(r.sendId);
      });

      if (sentIds.length) {
        await pool.query(
          `UPDATE app.edm_sends SET status='sent', sent_at=NOW() WHERE id = ANY($1::uuid[])`,
          [sentIds]
        );
      }
      for (const f of failedResults) {
        await pool.query(
          `UPDATE app.edm_sends SET status='failed', error_message=$2 WHERE id=$1`,
          [f.sendId, f.error]
        );
      }
      await pool.query(
        `UPDATE app.edm_campaigns SET status='sent', sent_at=NOW() WHERE id=$1`,
        [campaign.id]
      );

      // In-app notification (best-effort; never blocks the send).
      const failedCount = failedResults.length;
      await notifyCompany(pool, {
        companyId,
        type: "campaign_completed",
        title: `Campaign "${campaign.name}" sent`,
        body: failedCount
          ? `Delivered to ${sentIds.length} recipient${sentIds.length === 1 ? "" : "s"} · ${failedCount} failed.`
          : `Delivered to ${sentIds.length} recipient${sentIds.length === 1 ? "" : "s"}.`,
        link: "/edm",
        metadata: { campaign_id: campaign.id, sent: sentIds.length, failed: failedCount },
      });

    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[EDM send error]", e);
      if (!res.headersSent) err(res, e.message, 500);
    } finally {
      client.release();
    }
  });

  router.post("/campaigns/:id/cancel", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      await pool.query(
        `UPDATE app.edm_campaigns SET status='cancelled'
         WHERE id=$1 AND company_id=$2 AND status IN ('draft','scheduled')`,
        [req.params.id, companyId]
      );
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  router.get("/campaigns/:id/stats", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows: [campaign] } = await pool.query(
        `SELECT id, name, status, total_recipients, sent_at FROM app.edm_campaigns WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (!campaign) return err(res, "Not found", 404);

      const { rows: counts } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status='sent')       AS sent,
          COUNT(*) FILTER (WHERE status='delivered')  AS delivered,
          COUNT(*) FILTER (WHERE status='bounced')    AS bounced,
          COUNT(*) FILTER (WHERE status='failed')     AS failed
        FROM app.edm_sends WHERE edm_campaign_id=$1
      `, [req.params.id]);

      const { rows: events } = await pool.query(`
        SELECT event_type, COUNT(*) AS count, COUNT(DISTINCT email) AS unique_count
        FROM app.edm_events WHERE edm_campaign_id=$1
        GROUP BY event_type
      `, [req.params.id]);

      const eventMap = {};
      events.forEach(e => { eventMap[e.event_type] = { total: Number(e.count), unique: Number(e.unique_count) }; });
      const delivered = Number(counts[0]?.delivered || counts[0]?.sent || 0);
      const opens  = eventMap.open?.unique  || 0;
      const clicks = eventMap.click?.unique || 0;
      const unsubs = eventMap.unsubscribe?.unique || 0;

      ok(res, {
        campaign: normalizeTs(campaign),
        sends: counts[0],
        events: eventMap,
        rates: {
          open_rate:        delivered ? `${((opens  / delivered) * 100).toFixed(1)}%` : "-",
          click_rate:       delivered ? `${((clicks / delivered) * 100).toFixed(1)}%` : "-",
          click_to_open:    opens     ? `${((clicks / opens)     * 100).toFixed(1)}%` : "-",
          unsubscribe_rate: delivered ? `${((unsubs / delivered) * 100).toFixed(1)}%` : "-",
        },
      });
    } catch (e) { err(res, e.message, 500); }
  });

  router.get("/campaigns/:id/sends", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      // Verify campaign belongs to this company first
      const { rows: [cam] } = await pool.query(
        `SELECT id FROM app.edm_campaigns WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (!cam) return err(res, "Not found", 404);

      const { rows } = await pool.query(`
        SELECT s.*, array_agg(e.event_type) FILTER (WHERE e.event_type IS NOT NULL) AS events
        FROM app.edm_sends s
        LEFT JOIN app.edm_events e ON e.send_id = s.id
        WHERE s.edm_campaign_id=$1
        GROUP BY s.id ORDER BY s.sent_at DESC NULLS LAST LIMIT 200
      `, [req.params.id]);
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUPPRESSION
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/suppression", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.edm_suppression WHERE company_id=$1 ORDER BY added_at DESC LIMIT 500`,
        [companyId]
      );
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/suppression", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const { email, reason = "manual" } = req.body;
    if (!email) return err(res, "email is required");
    try {
      await pool.query(
        `INSERT INTO app.edm_suppression (company_id, email, reason)
         VALUES ($1,$2,$3)
         ON CONFLICT (company_id, email) WHERE company_id IS NOT NULL
         DO UPDATE SET reason=$3, added_at=NOW()`,
        [companyId, email.toLowerCase(), reason]
      );
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  router.delete("/suppression/:email", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      await pool.query(
        `DELETE FROM app.edm_suppression WHERE email=$1 AND company_id=$2`,
        [req.params.email, companyId]
      );
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  // POST /suppression/bulk  (body: { entries: [{ email, reason }] })
  router.post("/suppression/bulk", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const { entries } = req.body;
    if (!Array.isArray(entries) || !entries.length) return err(res, "entries array required");

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const seen = new Set();
    const valid = [];
    const invalid = [];

    for (const e of entries) {
      const email = String(e.email || "").trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email)) { invalid.push(e.email || "(empty)"); continue; }
      if (seen.has(email)) continue;         // dedup within file
      seen.add(email);
      valid.push({ email, reason: String(e.reason || "manual").trim() || "manual" });
    }

    if (!valid.length) return err(res, "No valid email addresses found in the file");

    try {
      // Batch upsert using unnest - single round-trip regardless of size
      const emails  = valid.map(v => v.email);
      const reasons = valid.map(v => v.reason);
      await pool.query(
        `INSERT INTO app.edm_suppression (company_id, email, reason)
         SELECT $1, unnest($2::text[]), unnest($3::text[])
         ON CONFLICT (company_id, email) WHERE company_id IS NOT NULL
         DO UPDATE SET reason = EXCLUDED.reason, added_at = NOW()`,
        [companyId, emails, reasons]
      );
      ok(res, { added: valid.length, invalid_count: invalid.length, invalid });
    } catch (e) { err(res, e.message, 500); }
  });

  // DELETE /suppression  (bulk - body: { emails: string[] })
  router.delete("/suppression", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const { emails } = req.body;
    if (!Array.isArray(emails) || !emails.length) return err(res, "emails array is required");
    try {
      await pool.query(
        `DELETE FROM app.edm_suppression WHERE company_id=$1 AND email = ANY($2::text[])`,
        [companyId, emails.map(e => e.toLowerCase())]
      );
      ok(res, { success: true, removed: emails.length });
    } catch (e) { err(res, e.message, 500); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // AUTOMATIONS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/automations", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.edm_automations WHERE company_id=$1 ORDER BY created_date DESC LIMIT 100`,
        [companyId]
      );
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/automations", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const { name, trigger_type = "manual", trigger_config = {}, status = "draft" } = req.body;
    if (!name) return err(res, "name is required");
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.edm_automations (company_id, name, trigger_type, trigger_config, status)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [companyId, name, trigger_type, JSON.stringify(trigger_config), status]
      );
      ok(res, normalizeTs(rows[0]), 201);
    } catch (e) { err(res, e.message, 500); }
  });

  router.patch("/automations/:id", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const allowed = ["name","trigger_type","trigger_config","status"];
    const keys = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!keys.length) return err(res, "No valid fields");
    try {
      const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(", ");
      const { rows } = await pool.query(
        `UPDATE app.edm_automations SET ${sets} WHERE id=$1 AND company_id=$2 RETURNING *`,
        [req.params.id, companyId, ...keys.map(k => req.body[k])]
      );
      if (!rows.length) return err(res, "Not found", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  router.delete("/automations/:id", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      await pool.query(
        `DELETE FROM app.edm_automations WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  router.get("/automations/:id/steps", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      // Verify automation belongs to this company
      const { rows: [auto] } = await pool.query(
        `SELECT id FROM app.edm_automations WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (!auto) return err(res, "Not found", 404);
      const { rows } = await pool.query(
        `SELECT * FROM app.edm_automation_steps WHERE automation_id=$1 ORDER BY step_order`,
        [req.params.id]
      );
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/automations/:id/steps", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    const { step_order = 0, step_type = "send_email", step_config = {} } = req.body;
    try {
      // Verify automation belongs to this company
      const { rows: [auto] } = await pool.query(
        `SELECT id FROM app.edm_automations WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (!auto) return err(res, "Not found", 404);
      const { rows } = await pool.query(
        `INSERT INTO app.edm_automation_steps (automation_id, step_order, step_type, step_config)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.params.id, step_order, step_type, JSON.stringify(step_config)]
      );
      ok(res, normalizeTs(rows[0]), 201);
    } catch (e) { err(res, e.message, 500); }
  });

  router.get("/automations/:id/enrollments", authenticate, async (req, res) => {
    const companyId = await getCompanyId(req, res); if (!companyId) return;
    try {
      const { rows: [auto] } = await pool.query(
        `SELECT id FROM app.edm_automations WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (!auto) return err(res, "Not found", 404);
      const { rows } = await pool.query(
        `SELECT * FROM app.edm_automation_enrollments WHERE automation_id=$1 ORDER BY enrolled_at DESC LIMIT 200`,
        [req.params.id]
      );
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ESP WEBHOOK (Resend → update send status)
  // No auth - called by Resend's servers. Company scoping via campaign lookup.
  // ══════════════════════════════════════════════════════════════════════════
  router.post("/webhooks/resend", async (req, res) => {
    const { type, data } = req.body;
    if (!type || !data) return ok(res, { received: true });

    const email = data.email_id || data.to?.[0];
    const typeMap = {
      "email.delivered": "delivered",
      "email.bounced":   "bounced",
      "email.complained":"complaint",
      "email.opened":    "open",
      "email.clicked":   "click",
    };
    const ourType = typeMap[type];
    if (!ourType) return ok(res, { received: true, skipped: true });

    try {
      const { rows: [send] } = await pool.query(
        `SELECT s.id, s.edm_campaign_id, s.email, c.company_id
         FROM app.edm_sends s
         JOIN app.edm_campaigns c ON c.id = s.edm_campaign_id
         WHERE s.email=$1 AND s.status != 'failed'
         ORDER BY s.sent_at DESC LIMIT 1`,
        [email]
      );

      if (send) {
        await pool.query(
          `INSERT INTO app.edm_events (edm_campaign_id, send_id, email, event_type, metadata)
           VALUES ($1,$2,$3,$4,$5)`,
          [send.edm_campaign_id, send.id, send.email, ourType, JSON.stringify(data)]
        );

        if (ourType === "delivered") {
          await pool.query(`UPDATE app.edm_sends SET status='delivered' WHERE id=$1`, [send.id]);
        }
        if (ourType === "bounced") {
          await pool.query(`UPDATE app.edm_sends SET status='bounced' WHERE id=$1`, [send.id]);
          if (send.company_id) {
            await pool.query(
              `INSERT INTO app.edm_suppression (company_id, email, reason)
               VALUES ($1,$2,'bounced')
               ON CONFLICT (company_id, email) WHERE company_id IS NOT NULL
               DO UPDATE SET reason='bounced', added_at=NOW()`,
              [send.company_id, email]
            );
          }
        }
        if (ourType === "complaint") {
          if (send.company_id) {
            await pool.query(
              `INSERT INTO app.edm_suppression (company_id, email, reason)
               VALUES ($1,$2,'complained')
               ON CONFLICT (company_id, email) WHERE company_id IS NOT NULL
               DO UPDATE SET reason='complained', added_at=NOW()`,
              [send.company_id, email]
            );
          }
        }
      }

      ok(res, { received: true });
    } catch (e) {
      console.error("[EDM webhook error]", e.message);
      ok(res, { received: true });
    }
  });

  return router;
}


