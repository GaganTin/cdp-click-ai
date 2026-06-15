// MCP Tool Group 4: EDM (Email Direct Marketing)
// Read-only + draft tools - AI suggests content and previews recipients.
// The AI never sends or saves campaigns autonomously; the user approves via the UI.

export const edmTools = [
  {
    name: "suggest_edm_opportunities",
    description:
      "Proactively analyze member and engagement data to surface the highest-impact email campaign opportunities. " +
      "Run this when the user asks for email ideas, campaign suggestions, or 'what should I send?'. " +
      "Returns opportunity segments with counts, engagement context, and recommended campaign types. " +
      "Use these results to decide which edm block(s) to draft next.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_member_profile_breakdown",
    description:
      "Get a demographic or behavioral breakdown of email-eligible members for targeting. " +
      "Use before drafting a campaign to understand the audience size and composition. " +
      "Helps the AI choose the right segment, subject line tone, and content angle.",
    inputSchema: {
      type: "object",
      properties: {
        breakdown_by: {
          type: "string",
          enum: ["member_type", "age_group", "education_level", "gender", "income_level", "employment_status"],
          description: "The demographic dimension to break down by.",
        },
      },
      required: ["breakdown_by"],
    },
  },
  {
    name: "list_edm_campaigns",
    description:
      "List existing EDM email campaigns saved in the app. " +
      "Check this before suggesting a new campaign to avoid duplicates and understand what's already been sent.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "scheduled", "sending", "sent", "cancelled"],
          description: "Filter by campaign status. Omit to return all.",
        },
        limit: { type: "number", description: "Max results. Defaults to 20." },
      },
    },
  },
  {
    name: "preview_edm_recipients",
    description:
      "Preview how many opted-in recipients a campaign would reach from a given segment. " +
      "Filters out suppressed emails and those without is_opt_in_email=true. " +
      "Always call this before suggesting an edm campaign block to get a real count.",
    inputSchema: {
      type: "object",
      properties: {
        segment_description: {
          type: "string",
          description:
            "Description of the target audience (e.g. 'members who attended seminars', 'high-income females aged 30-45'). " +
            "Used to determine which customer_profile filters apply.",
        },
        filters: {
          type: "object",
          description: "Optional SQL-safe filters to narrow the audience from app.customer_profiles.",
          properties: {
            member_type:       { type: "string" },
            gender:            { type: "string" },
            age_group:         { type: "string" },
            education_level:   { type: "string" },
            income_level:      { type: "string" },
            employment_status: { type: "string" },
            min_ga_sessions:   { type: "number", description: "Minimum GA sessions (web activity level)" },
            has_seminar:       { type: "boolean", description: "Attended at least one seminar" },
          },
        },
      },
    },
  },
  {
    name: "analyze_edm_performance",
    description:
      "Analyze sent EDM campaign performance - open rates, click rates, unsubscribe rates, and bounces. " +
      "Use this to identify what content and segments perform best, and justify future campaign recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: {
          type: "string",
          description: "Specific campaign UUID to analyze. Omit to analyze all recent campaigns.",
        },
        days: {
          type: "number",
          description: "How many days back to look. Defaults to 90.",
        },
      },
    },
  },
  {
    name: "suggest_send_time",
    description:
      "Suggest the best day and time to send an EDM based on historical open patterns for a given segment. " +
      "Analyzes the edm_events table to find when recipients historically engage most.",
    inputSchema: {
      type: "object",
      properties: {
        segment_description: {
          type: "string",
          description: "The target audience description to tailor the timing recommendation.",
        },
      },
    },
  },
];

// ── Recipient eligibility (shared across opportunity/preview queries) ──────────
// A profile is an eligible EDM recipient when it has opted in, has a real email,
// and is not on the (global) suppression list.
const NOT_SUPPRESSED = "cp.primary_email NOT IN (SELECT email FROM app.edm_suppression)";
const ELIGIBLE_RECIPIENT = `cp.is_opt_in_email = true
          AND cp.primary_email IS NOT NULL AND cp.primary_email != ''
          AND ${NOT_SUPPRESSED}`;

export async function handleEdmTool(name, args, pool) {

  if (name === "suggest_edm_opportunities") {
    try {
      // New joiners (last 30 days)
      const { rows: newJoiners } = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM app.customer_profiles cp
        WHERE ${ELIGIBLE_RECIPIENT}
          AND cp.member_join_date >= NOW() - INTERVAL '30 days'
      `);

      // Inactive 90+ days
      const { rows: inactive90 } = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM app.customer_profiles cp
        WHERE ${ELIGIBLE_RECIPIENT}
          AND (cp.last_activity_date IS NULL OR cp.last_activity_date < NOW() - INTERVAL '90 days')
      `);

      // Inactive 30 days
      const { rows: inactive30 } = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM app.customer_profiles cp
        WHERE ${ELIGIBLE_RECIPIENT}
          AND (cp.last_activity_date IS NULL OR cp.last_activity_date < NOW() - INTERVAL '30 days')
          AND (cp.last_activity_date IS NOT NULL AND cp.last_activity_date >= NOW() - INTERVAL '90 days')
      `);

      // Seminar attendees (had seminar activity)
      const { rows: seminarAttendees } = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM app.customer_profiles cp
        WHERE ${ELIGIBLE_RECIPIENT}
          AND cp.seminar_count > 0
      `);

      // Total eligible
      const { rows: total } = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM app.customer_profiles cp
        WHERE ${ELIGIBLE_RECIPIENT}
      `);

      // Recent EDM performance for context
      const { rows: recentPerf } = await pool.query(`
        SELECT AVG(
          CASE WHEN ec.total_recipients > 0
            THEN (ec.open_count::float / ec.total_recipients) * 100
          END
        ) AS avg_open_rate,
        COUNT(*) AS campaigns_sent
        FROM app.edm_campaigns ec
        WHERE ec.status = 'sent'
          AND ec.sent_at >= NOW() - INTERVAL '180 days'
      `);

      const opportunities = [
        {
          type: "welcome",
          campaign_type: "Welcome Series",
          trigger: "new_member",
          eligible_recipients: Number(newJoiners[0].cnt),
          description: "Members who joined in the last 30 days - high engagement window, best time to introduce your brand.",
          suggested_subject: "Welcome to the family, {{first_name}}!",
          priority: Number(newJoiners[0].cnt) > 0 ? "high" : "low",
        },
        {
          type: "reengagement_90d",
          campaign_type: "90-Day Win-Back",
          trigger: "inactivity_90d",
          eligible_recipients: Number(inactive90[0].cnt),
          description: "Members who haven't engaged in 90+ days - re-engage before they lapse completely.",
          suggested_subject: "We miss you, {{first_name}} - here's what's new",
          priority: Number(inactive90[0].cnt) > 50 ? "high" : "medium",
        },
        {
          type: "reengagement_30d",
          campaign_type: "30-Day Nudge",
          trigger: "inactivity_30d",
          eligible_recipients: Number(inactive30[0].cnt),
          description: "Members who went quiet in the last month - a light nudge before deeper inactivity sets in.",
          suggested_subject: "Thought you'd want to know, {{first_name}}",
          priority: "medium",
        },
        {
          type: "seminar_followup",
          campaign_type: "Seminar Follow-up",
          trigger: "seminar_attended",
          eligible_recipients: Number(seminarAttendees[0].cnt),
          description: "Members who attended seminars - high-intent audience, receptive to follow-up content and offers.",
          suggested_subject: "Following up on your seminar attendance, {{first_name}}",
          priority: Number(seminarAttendees[0].cnt) > 0 ? "high" : "low",
        },
        {
          type: "broadcast",
          campaign_type: "Full Member Broadcast",
          trigger: "manual",
          eligible_recipients: Number(total[0].cnt),
          description: "All opted-in members - use for newsletters, announcements, or promotions reaching your entire list.",
          suggested_subject: "Here's what's new this month, {{first_name}}",
          priority: "medium",
        },
      ];

      const performanceContext = recentPerf[0]
        ? {
            avg_open_rate: `${(Number(recentPerf[0].avg_open_rate) || 0).toFixed(1)}%`,
            campaigns_sent_last_180d: Number(recentPerf[0].campaigns_sent),
          }
        : { note: "No sent campaigns yet - no historical benchmarks available." };

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ opportunities, performance_context: performanceContext }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  if (name === "get_member_profile_breakdown") {
    const allowed = ["member_type", "age_group", "education_level", "gender", "income_level", "employment_status"];
    const col = allowed.includes(args.breakdown_by) ? args.breakdown_by : "member_type";
    try {
      const { rows } = await pool.query(`
        SELECT cp.${col} AS dimension,
               COUNT(*) AS total_opted_in,
               COUNT(*) FILTER (WHERE cp.seminar_count > 0) AS seminar_attendees,
               COUNT(*) FILTER (WHERE cp.ga_sessions >= 3) AS active_web_users,
               AVG(cp.ga_sessions)::numeric(6,1) AS avg_sessions
        FROM app.customer_profiles cp
        WHERE ${ELIGIBLE_RECIPIENT}
          AND cp.${col} IS NOT NULL
        GROUP BY cp.${col}
        ORDER BY total_opted_in DESC
        LIMIT 20
      `);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ breakdown_by: col, breakdown: rows }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  if (name === "list_edm_campaigns") {
    try {
      const conditions = [];
      const params = [];
      if (args.status) { conditions.push(`ec.status = $${params.length + 1}`); params.push(args.status); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = Math.min(args.limit || 20, 50);
      const { rows } = await pool.query(
        `SELECT ec.id, ec.name, ec.subject, ec.status, ec.total_recipients,
                ec.sent_at, ec.created_date, s.name AS segment_name
         FROM app.edm_campaigns ec
         LEFT JOIN app.segments s ON s.id = ec.segment_id
         ${where}
         ORDER BY ec.created_date DESC
         LIMIT ${limit}`,
        params
      );
      return { content: [{ type: "text", text: JSON.stringify({ campaigns: rows }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  if (name === "preview_edm_recipients") {
    try {
      const f = args.filters || {};
      const conditions = [
        "cp.is_opt_in_email = true",
        "cp.primary_email IS NOT NULL",
        "cp.primary_email != ''",
        NOT_SUPPRESSED,
      ];
      const params = [];

      if (f.member_type)       { conditions.push(`cp.member_type = $${params.length+1}`);       params.push(f.member_type); }
      if (f.gender)            { conditions.push(`cp.gender = $${params.length+1}`);            params.push(f.gender); }
      if (f.age_group)         { conditions.push(`cp.age_group = $${params.length+1}`);         params.push(f.age_group); }
      if (f.education_level)   { conditions.push(`cp.education_level = $${params.length+1}`);   params.push(f.education_level); }
      if (f.income_level)      { conditions.push(`cp.income_level = $${params.length+1}`);      params.push(f.income_level); }
      if (f.employment_status) { conditions.push(`cp.employment_status = $${params.length+1}`); params.push(f.employment_status); }
      if (f.min_ga_sessions)   { conditions.push(`cp.ga_sessions >= $${params.length+1}`);      params.push(f.min_ga_sessions); }
      if (f.has_seminar)       { conditions.push("cp.seminar_count > 0"); }

      const where = `WHERE ${conditions.join(" AND ")}`;

      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) AS total FROM app.customer_profiles cp ${where}`, params
      );
      const { rows: sample } = await pool.query(
        `SELECT cp.eng_first_name, cp.primary_email, cp.member_type, cp.age_group, cp.education_level
         FROM app.customer_profiles cp ${where}
         ORDER BY cp.member_join_date DESC NULLS LAST LIMIT 5`,
        params
      );

      const { rows: suppressed } = await pool.query(
        `SELECT COUNT(*) AS total FROM app.edm_suppression`
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            eligible_recipients: Number(countRows[0].total),
            suppression_list_size: Number(suppressed[0].total),
            sample_recipients: sample,
            filters_applied: f,
            note: "All recipients have is_opt_in_email=true and are not on the suppression list.",
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  if (name === "analyze_edm_performance") {
    try {
      const days = Number(args.days) || 90;
      const params = [];
      let campaignFilter = "";
      if (args.campaign_id) {
        params.push(args.campaign_id);
        campaignFilter = `AND ec.id = $${params.length}`;
      }

      const { rows } = await pool.query(`
        SELECT
          ec.id, ec.name, ec.subject, ec.sent_at, ec.total_recipients,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status IN ('sent','delivered')) AS delivered,
          COUNT(DISTINCT e_open.id)  AS total_opens,
          COUNT(DISTINCT e_open.email) AS unique_opens,
          COUNT(DISTINCT e_click.id) AS total_clicks,
          COUNT(DISTINCT e_click.email) AS unique_clicks,
          COUNT(DISTINCT e_unsub.id) AS unsubscribes,
          COUNT(DISTINCT e_bounce.id) AS bounces
        FROM app.edm_campaigns ec
        LEFT JOIN app.edm_sends s ON s.edm_campaign_id = ec.id
        LEFT JOIN app.edm_events e_open  ON e_open.edm_campaign_id  = ec.id AND e_open.event_type  = 'open'
        LEFT JOIN app.edm_events e_click ON e_click.edm_campaign_id = ec.id AND e_click.event_type = 'click'
        LEFT JOIN app.edm_events e_unsub ON e_unsub.edm_campaign_id = ec.id AND e_unsub.event_type = 'unsubscribe'
        LEFT JOIN app.edm_events e_bounce ON e_bounce.edm_campaign_id = ec.id AND e_bounce.event_type = 'bounce'
        WHERE ec.status = 'sent'
          AND ec.sent_at >= NOW() - INTERVAL '${days} days'
          ${campaignFilter}
        GROUP BY ec.id, ec.name, ec.subject, ec.sent_at, ec.total_recipients
        ORDER BY ec.sent_at DESC
        LIMIT 20
      `, params);

      const enriched = rows.map(r => {
        const delivered = Number(r.delivered) || Number(r.total_recipients) || 1;
        return {
          ...r,
          open_rate:   `${((Number(r.unique_opens)  / delivered) * 100).toFixed(1)}%`,
          click_rate:  `${((Number(r.unique_clicks) / delivered) * 100).toFixed(1)}%`,
          unsub_rate:  `${((Number(r.unsubscribes)  / delivered) * 100).toFixed(1)}%`,
          bounce_rate: `${((Number(r.bounces)        / delivered) * 100).toFixed(1)}%`,
        };
      });

      return { content: [{ type: "text", text: JSON.stringify({ campaigns: enriched, days_analyzed: days }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  if (name === "suggest_send_time") {
    try {
      const { rows } = await pool.query(`
        SELECT
          EXTRACT(DOW FROM occurred_at)  AS day_of_week,
          EXTRACT(HOUR FROM occurred_at) AS hour_of_day,
          COUNT(*) AS open_count
        FROM app.edm_events
        WHERE event_type = 'open'
          AND occurred_at >= NOW() - INTERVAL '180 days'
        GROUP BY day_of_week, hour_of_day
        ORDER BY open_count DESC
        LIMIT 10
      `);

      const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const enriched = rows.map(r => ({
        day:        days[Number(r.day_of_week)],
        hour:       `${r.hour_of_day}:00`,
        open_count: Number(r.open_count),
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            top_send_windows: enriched,
            recommendation: enriched.length
              ? `Best window: ${enriched[0].day} at ${enriched[0].hour} (${enriched[0].open_count} historical opens)`
              : "Not enough send history yet - default to Tuesday or Thursday 9–11am.",
            note: "Based on last 180 days of open events across all campaigns.",
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown EDM tool: ${name}` }) }] };
}
