import { Router } from "express";
import { sendEmail, sendBatch } from "../services/email.js";
import { injectTracking, applyPersonalization, applyUtmToLinks, injectUnsubscribeFooter, getTrackingBase } from "../services/tracking.js";

export function createEdmRouter(pool) {
  const router = Router();

  // ── helpers ────────────────────────────────────────────────────────────────

  function ok(res, data, status = 200) { res.status(status).json(data); }
  function err(res, msg, status = 400) { res.status(status).json({ error: msg }); }
  function normalizeTs(row) {
    if (!row) return null;
    const r = { ...row };
    ["created_date","updated_date","sent_at","scheduled_at","enrolled_at","completed_at","added_at","occurred_at","sent_at"].forEach(k => {
      if (r[k] instanceof Date) r[k] = r[k].toISOString();
    });
    return r;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEMPLATES
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/templates", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.edm_templates ORDER BY created_date DESC LIMIT 100`
      );
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/templates", async (req, res) => {
    const { name, subject, preview_text, html_body, text_body, variables = [], status = "draft" } = req.body;
    if (!name || !subject || !html_body) return err(res, "name, subject, and html_body are required");
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.edm_templates (name, subject, preview_text, html_body, text_body, variables, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, subject, preview_text || null, html_body, text_body || null, variables, status]
      );
      ok(res, normalizeTs(rows[0]), 201);
    } catch (e) { err(res, e.message, 500); }
  });

  router.get("/templates/:id", async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM app.edm_templates WHERE id=$1`, [req.params.id]);
      if (!rows.length) return err(res, "Template not found", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  router.patch("/templates/:id", async (req, res) => {
    const allowed = ["name","subject","preview_text","html_body","text_body","variables","status"];
    const keys = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!keys.length) return err(res, "No valid fields to update");
    try {
      const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
      const vals = keys.map(k => req.body[k]);
      const { rows } = await pool.query(
        `UPDATE app.edm_templates SET ${sets} WHERE id=$1 RETURNING *`,
        [req.params.id, ...vals]
      );
      if (!rows.length) return err(res, "Template not found", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  router.delete("/templates/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM app.edm_templates WHERE id=$1`, [req.params.id]);
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CAMPAIGNS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/campaigns", async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT ec.*, s.name AS segment_name, t.name AS template_name, c.name AS utm_campaign_name
        FROM app.edm_campaigns ec
        LEFT JOIN app.segments s ON s.id = ec.segment_id
        LEFT JOIN app.edm_templates t ON t.id = ec.template_id
        LEFT JOIN app.campaigns c ON c.id = ec.utm_campaign_id
        ORDER BY ec.created_date DESC LIMIT 100
      `);
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/campaigns", async (req, res) => {
    const {
      name, subject, preview_text, from_name, from_email, reply_to,
      template_id, html_body, text_body, segment_id, utm_campaign_id,
      status = "draft", scheduled_at, ab_test_config = {}
    } = req.body;
    if (!name || !subject || !from_email) return err(res, "name, subject, and from_email are required");
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.edm_campaigns
           (name, subject, preview_text, from_name, from_email, reply_to,
            template_id, html_body, text_body, segment_id, utm_campaign_id,
            status, scheduled_at, ab_test_config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [name, subject, preview_text||null, from_name||"", from_email, reply_to||null,
         template_id||null, html_body||null, text_body||null,
         segment_id||null, utm_campaign_id||null,
         status, scheduled_at||null, JSON.stringify(ab_test_config)]
      );
      ok(res, normalizeTs(rows[0]), 201);
    } catch (e) { err(res, e.message, 500); }
  });

  router.get("/campaigns/:id", async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT ec.*, s.name AS segment_name, t.name AS template_name
        FROM app.edm_campaigns ec
        LEFT JOIN app.segments s ON s.id = ec.segment_id
        LEFT JOIN app.edm_templates t ON t.id = ec.template_id
        WHERE ec.id=$1`, [req.params.id]);
      if (!rows.length) return err(res, "Campaign not found", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  router.patch("/campaigns/:id", async (req, res) => {
    const allowed = ["name","subject","preview_text","from_name","from_email","reply_to",
                     "template_id","html_body","text_body","segment_id","utm_campaign_id",
                     "status","scheduled_at","ab_test_config"];
    const keys = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!keys.length) return err(res, "No valid fields to update");
    try {
      const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
      const vals = keys.map(k => req.body[k] ?? null);
      const { rows } = await pool.query(
        `UPDATE app.edm_campaigns SET ${sets} WHERE id=$1 RETURNING *`,
        [req.params.id, ...vals]
      );
      if (!rows.length) return err(res, "Campaign not found", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  router.delete("/campaigns/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM app.edm_campaigns WHERE id=$1`, [req.params.id]);
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── Standalone recipients preview (by segment_id query param) ───────────────
  router.get("/recipients/preview", async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT COUNT(*) AS total
        FROM app.customer_profiles cp
        WHERE cp.is_opt_in_email = true
          AND cp.primary_email IS NOT NULL
          AND cp.primary_email != ''
          AND cp.primary_email NOT IN (SELECT email FROM app.edm_suppression)
      `);
      ok(res, { count: Number(rows[0].total) });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── Standalone test send (no campaign required) ───────────────────────────
  router.post("/test-send", async (req, res) => {
    const { test_email, subject, html_body, from_name, from_email, reply_to } = req.body;
    if (!test_email) return err(res, "test_email is required");
    if (!subject)    return err(res, "subject is required");
    if (!html_body)  return err(res, "html_body is required");
    try {
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
        fromEmail: from_email || process.env.EDM_FROM_EMAIL || "onboarding@resend.dev",
        fromName: from_name || process.env.EDM_FROM_NAME || "Click AI",
        replyTo: reply_to || null,
      });
      ok(res, { success: true, message_id: result.id, simulated: result.simulated || false });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── Preview recipients before sending ──────────────────────────────────────
  router.get("/campaigns/:id/recipients/preview", async (req, res) => {
    try {
      const { rows: [campaign] } = await pool.query(
        `SELECT * FROM app.edm_campaigns WHERE id=$1`, [req.params.id]
      );
      if (!campaign) return err(res, "Campaign not found", 404);
      if (!campaign.segment_id) return ok(res, { count: 0, sample: [], message: "No segment assigned" });

      const { rows: segment } = await pool.query(
        `SELECT metadata FROM app.segments WHERE id=$1`, [campaign.segment_id]
      );

      const { rows } = await pool.query(`
        SELECT cp.member_id, cp.primary_email AS email, cp.eng_full_name AS name,
               cp.member_type, cp.is_opt_in_email
        FROM app.customer_profiles cp
        WHERE cp.is_opt_in_email = true
          AND cp.primary_email IS NOT NULL
          AND cp.primary_email != ''
          AND cp.primary_email NOT IN (SELECT email FROM app.edm_suppression)
        ORDER BY cp.member_join_date DESC
        LIMIT 500
      `);

      ok(res, {
        count: rows.length,
        sample: rows.slice(0, 10),
        segment: segment[0] || null,
      });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── SEND a campaign ────────────────────────────────────────────────────────
  router.post("/campaigns/:id/send", async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: [campaign] } = await client.query(
        `SELECT * FROM app.edm_campaigns WHERE id=$1`, [req.params.id]
      );
      if (!campaign) { await client.query("ROLLBACK"); return err(res, "Campaign not found", 404); }
      if (campaign.status === "sent") { await client.query("ROLLBACK"); return err(res, "Campaign already sent"); }

      // Resolve HTML body (template takes precedence)
      let html = campaign.html_body || "";
      if (campaign.template_id) {
        const { rows: [tpl] } = await client.query(
          `SELECT html_body FROM app.edm_templates WHERE id=$1`, [campaign.template_id]
        );
        if (tpl) html = tpl.html_body;
      }
      if (!html) { await client.query("ROLLBACK"); return err(res, "Campaign has no email body"); }

      // Fetch UTM params if linked
      let utmParams = null;
      if (campaign.utm_campaign_id) {
        const { rows: [utm] } = await client.query(
          `SELECT utm_source, utm_medium, utm_campaign, utm_term, utm_content
           FROM app.campaigns WHERE id=$1`, [campaign.utm_campaign_id]
        );
        utmParams = utm || null;
      }

      // Resolve recipients (opt-in, not suppressed, has email)
      const { rows: recipients } = await client.query(`
        SELECT cp.member_id, cp.primary_email AS email,
               cp.eng_first_name, cp.eng_last_name, cp.eng_full_name,
               cp.display_name, cp.member_type, cp.member_no
        FROM app.customer_profiles cp
        WHERE cp.is_opt_in_email = true
          AND cp.primary_email IS NOT NULL
          AND cp.primary_email != ''
          AND cp.primary_email NOT IN (SELECT email FROM app.edm_suppression)
        LIMIT 10000
      `);

      if (!recipients.length) {
        await client.query("ROLLBACK");
        return err(res, "No eligible recipients after opt-in and suppression filtering");
      }

      // Mark campaign as sending
      await client.query(
        `UPDATE app.edm_campaigns SET status='sending', total_recipients=$2 WHERE id=$1`,
        [campaign.id, recipients.length]
      );

      // Insert queued send records and build per-recipient payload
      const sendRows = await Promise.all(recipients.map(async (r) => {
        const { rows: [s] } = await client.query(
          `INSERT INTO app.edm_sends (edm_campaign_id, email, member_id, status)
           VALUES ($1,$2,$3,'queued') RETURNING id`,
          [campaign.id, r.email, r.member_id]
        );
        return s.id;
      }));

      await client.query("COMMIT");

      // Build per-recipient HTML (personalize + UTM + tracking) outside the transaction
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

      // Fire & don't wait — respond immediately, send in background
      res.json({
        success: true,
        campaign_id: campaign.id,
        total_recipients: recipients.length,
        message: "Send started — check campaign stats for delivery status",
      });

      // Background send
      const results = await sendBatch(sendPayloads, {
        subject: campaign.subject,
        from_email: campaign.from_email,
        from_name: campaign.from_name,
        reply_to: campaign.reply_to,
        id: campaign.id,
        unsubscribeUrl: `${TRACKING_BASE}/track/u/{{sendId}}`,
      });

      // Update send statuses
      const sentIds = [], failedResults = [];
      results.forEach(r => {
        if (r.error) failedResults.push(r);
        else sentIds.push(r.sendId);
      });

      if (sentIds.length) {
        await pool.query(
          `UPDATE app.edm_sends SET status='sent', sent_at=NOW()
           WHERE id = ANY($1::uuid[])`,
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

    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[EDM send error]", e);
      if (!res.headersSent) err(res, e.message, 500);
    } finally {
      client.release();
    }
  });

  // ── Cancel / archive ────────────────────────────────────────────────────────
  router.post("/campaigns/:id/cancel", async (req, res) => {
    try {
      await pool.query(
        `UPDATE app.edm_campaigns SET status='cancelled' WHERE id=$1 AND status IN ('draft','scheduled')`,
        [req.params.id]
      );
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── Campaign stats ──────────────────────────────────────────────────────────
  router.get("/campaigns/:id/stats", async (req, res) => {
    try {
      const { rows: [campaign] } = await pool.query(
        `SELECT id, name, status, total_recipients, sent_at FROM app.edm_campaigns WHERE id=$1`,
        [req.params.id]
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
        SELECT event_type, COUNT(*) AS count,
               COUNT(DISTINCT email) AS unique_count
        FROM app.edm_events WHERE edm_campaign_id=$1
        GROUP BY event_type
      `, [req.params.id]);

      const eventMap = {};
      events.forEach(e => { eventMap[e.event_type] = { total: Number(e.count), unique: Number(e.unique_count) }; });

      const delivered = Number(counts[0]?.delivered || counts[0]?.sent || 0);
      const opens   = eventMap.open?.unique   || 0;
      const clicks  = eventMap.click?.unique  || 0;
      const unsubs  = eventMap.unsubscribe?.unique || 0;

      ok(res, {
        campaign: normalizeTs(campaign),
        sends: counts[0],
        events: eventMap,
        rates: {
          open_rate:        delivered ? `${((opens / delivered) * 100).toFixed(1)}%` : "—",
          click_rate:       delivered ? `${((clicks / delivered) * 100).toFixed(1)}%` : "—",
          click_to_open:    opens ? `${((clicks / opens) * 100).toFixed(1)}%` : "—",
          unsubscribe_rate: delivered ? `${((unsubs / delivered) * 100).toFixed(1)}%` : "—",
        },
      });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── Per-send list ───────────────────────────────────────────────────────────
  router.get("/campaigns/:id/sends", async (req, res) => {
    try {
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

  router.get("/suppression", async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM app.edm_suppression ORDER BY added_at DESC LIMIT 500`);
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/suppression", async (req, res) => {
    const { email, reason = "manual" } = req.body;
    if (!email) return err(res, "email is required");
    try {
      await pool.query(
        `INSERT INTO app.edm_suppression (email, reason) VALUES ($1,$2)
         ON CONFLICT (email) DO UPDATE SET reason=$2, added_at=NOW()`,
        [email.toLowerCase(), reason]
      );
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  router.delete("/suppression/:email", async (req, res) => {
    try {
      await pool.query(`DELETE FROM app.edm_suppression WHERE email=$1`, [req.params.email]);
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // AUTOMATIONS
  // ══════════════════════════════════════════════════════════════════════════

  router.get("/automations", async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM app.edm_automations ORDER BY created_date DESC LIMIT 100`);
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/automations", async (req, res) => {
    const { name, trigger_type = "manual", trigger_config = {}, status = "draft" } = req.body;
    if (!name) return err(res, "name is required");
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.edm_automations (name, trigger_type, trigger_config, status)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [name, trigger_type, JSON.stringify(trigger_config), status]
      );
      ok(res, normalizeTs(rows[0]), 201);
    } catch (e) { err(res, e.message, 500); }
  });

  router.patch("/automations/:id", async (req, res) => {
    const allowed = ["name","trigger_type","trigger_config","status"];
    const keys = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!keys.length) return err(res, "No valid fields");
    try {
      const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
      const { rows } = await pool.query(
        `UPDATE app.edm_automations SET ${sets} WHERE id=$1 RETURNING *`,
        [req.params.id, ...keys.map(k => req.body[k])]
      );
      if (!rows.length) return err(res, "Not found", 404);
      ok(res, normalizeTs(rows[0]));
    } catch (e) { err(res, e.message, 500); }
  });

  router.delete("/automations/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM app.edm_automations WHERE id=$1`, [req.params.id]);
      ok(res, { success: true });
    } catch (e) { err(res, e.message, 500); }
  });

  // ── Automation steps ────────────────────────────────────────────────────────
  router.get("/automations/:id/steps", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.edm_automation_steps WHERE automation_id=$1 ORDER BY step_order`,
        [req.params.id]
      );
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  router.post("/automations/:id/steps", async (req, res) => {
    const { step_order = 0, step_type = "send_email", step_config = {} } = req.body;
    try {
      const { rows } = await pool.query(
        `INSERT INTO app.edm_automation_steps (automation_id, step_order, step_type, step_config)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.params.id, step_order, step_type, JSON.stringify(step_config)]
      );
      ok(res, normalizeTs(rows[0]), 201);
    } catch (e) { err(res, e.message, 500); }
  });

  // ── Automation enrollments ──────────────────────────────────────────────────
  router.get("/automations/:id/enrollments", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM app.edm_automation_enrollments WHERE automation_id=$1 ORDER BY enrolled_at DESC LIMIT 200`,
        [req.params.id]
      );
      ok(res, rows.map(normalizeTs));
    } catch (e) { err(res, e.message, 500); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ESP WEBHOOK (Resend → update send status)
  // ══════════════════════════════════════════════════════════════════════════
  router.post("/webhooks/resend", async (req, res) => {
    const event = req.body;
    const { type, data } = event;
    if (!type || !data) return ok(res, { received: true });

    const email = data.email_id || data.to?.[0];
    const resendId = data.email_id;

    try {
      // Map Resend event types to our schema
      const typeMap = {
        "email.delivered": "delivered",
        "email.bounced":   "bounced",
        "email.complained":"complaint",
        "email.opened":    "open",
        "email.clicked":   "click",
      };
      const ourType = typeMap[type];
      if (!ourType) return ok(res, { received: true, skipped: true });

      // Find the send record
      const { rows: [send] } = await pool.query(
        `SELECT id, edm_campaign_id, email FROM app.edm_sends
         WHERE email=$1 AND status != 'failed'
         ORDER BY sent_at DESC LIMIT 1`,
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
          await pool.query(
            `INSERT INTO app.edm_suppression (email, reason) VALUES ($1,'bounced')
             ON CONFLICT (email) DO UPDATE SET reason='bounced', added_at=NOW()`,
            [email]
          );
        }
        if (ourType === "complaint") {
          await pool.query(
            `INSERT INTO app.edm_suppression (email, reason) VALUES ($1,'complained')
             ON CONFLICT (email) DO UPDATE SET reason='complained', added_at=NOW()`,
            [email]
          );
        }
      }

      ok(res, { received: true });
    } catch (e) {
      console.error("[EDM webhook error]", e.message);
      ok(res, { received: true }); // always 200 to ESP
    }
  });

  return router;
}
