// MCP Tool Group 3: UTM Campaigns
// Read-only tools for researching campaign performance and checking existing campaigns.
// The AI never saves a UTM link directly - the user approves via the UI.

export const utmTools = [
  {
    name: "list_campaigns",
    description:
      "List existing UTM campaigns saved in the app. " +
      "Check this before suggesting a new UTM link to avoid duplicates and understand what's already running.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "active", "archived"],
          description: "Filter by campaign status. Omit to return all.",
        },
        limit: {
          type: "number",
          description: "Max number of campaigns to return. Defaults to 20.",
        },
      },
    },
  },
  {
    name: "analyze_utm_performance",
    description:
      "Analyze UTM campaign performance from Google Analytics data. " +
      "Returns sessions, conversions, and bounce rate grouped by source/medium/campaign. " +
      "Use this to identify top performers, underperformers, and gaps before suggesting new UTM links. " +
      "Also useful for UTM optimisation recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back. Defaults to 30.",
        },
        utm_source: {
          type: "string",
          description: "Filter to a specific utm_source (e.g. 'google', 'facebook'). Optional.",
        },
        utm_medium: {
          type: "string",
          description: "Filter to a specific utm_medium (e.g. 'cpc', 'email'). Optional.",
        },
        utm_campaign: {
          type: "string",
          description: "Filter to a specific campaign name. Optional.",
        },
        group_by: {
          type: "string",
          enum: ["source_medium", "campaign", "full"],
          description:
            "Grouping level: 'source_medium' (default), 'campaign', or 'full' (source+medium+campaign).",
        },
      },
    },
  },
];

export async function handleUtmTool(name, args, pool) {
  // Workspace isolation: every query is scoped to the active workspace. companyId
  // is injected by the server (args._company_id) and is not model-controllable.
  const companyId = args._company_id;
  if (!companyId) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "No workspace context - refusing to run (isolation guard)." }) }] };
  }

  if (name === "list_campaigns") {
    try {
      const params = [companyId];
      const conditions = ["company_id = $1"];
      if (args.status) { params.push(args.status); conditions.push(`status = $${params.length}`); }
      const limit = Math.min(args.limit || 20, 100);
      const result = await pool.query(
        `SELECT id, name, status, base_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content, created_date
         FROM app.campaigns WHERE ${conditions.join(" AND ")}
         ORDER BY created_date DESC
         LIMIT ${limit}`,
        params
      );
      return { content: [{ type: "text", text: JSON.stringify({ campaigns: result.rows }) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }

  if (name === "analyze_utm_performance") {
    const days = args.days || 30;
    const groupBy = args.group_by || "source_medium";

    const params = [companyId];
    const conditions = ["company_id = $1", `date >= TO_CHAR(NOW() - INTERVAL '${days} days', 'YYYYMMDD')`];

    if (args.utm_source) { params.push(args.utm_source); conditions.push(`utm_source = $${params.length}`); }
    if (args.utm_medium) { params.push(args.utm_medium); conditions.push(`utm_medium = $${params.length}`); }
    if (args.utm_campaign) { params.push(args.utm_campaign); conditions.push(`campaign = $${params.length}`); }

    const selectCols = groupBy === "campaign"
      ? "campaign"
      : groupBy === "full"
      ? "utm_source, utm_medium, campaign"
      : "utm_source, utm_medium";

    const sql = `
      SELECT ${selectCols},
             SUM(sessions)     AS total_sessions,
             SUM(conversions)  AS total_conversions,
             ROUND(AVG(bounce_rate)::numeric, 2) AS avg_bounce_rate
      FROM ga_landing.utm_daily_performance
      WHERE ${conditions.join(" AND ")}
      GROUP BY ${selectCols}
      ORDER BY total_sessions DESC
      LIMIT 25
    `;

    try {
      const result = await pool.query(sql, params);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ rows: result.rows, days_analyzed: days, group_by: groupBy }),
        }],
      };
    } catch (err) {
      // Try the full-param table as fallback if utm_daily_performance doesn't match
      const fallbackSql = `
        SELECT utm_source, utm_medium, campaign,
               SUM(sessions) AS total_sessions
        FROM ga_landing.utm_daily_full_param_performance
        WHERE ${conditions.join(" AND ")}
        GROUP BY utm_source, utm_medium, campaign
        ORDER BY total_sessions DESC
        LIMIT 25
      `;
      try {
        const fallback = await pool.query(fallbackSql, params);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ rows: fallback.rows, days_analyzed: days, note: "used utm_daily_full_param_performance" }),
          }],
        };
      } catch (err2) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
      }
    }
  }

  return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown UTM tool: ${name}` }) }] };
}
