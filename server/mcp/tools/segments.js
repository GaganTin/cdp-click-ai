// MCP Tool Group 2: Audience Segments
// Read-only tools for researching and sizing segments before recommending them to the user.
// The AI never saves a segment directly - the user approves via the UI.

export const segmentTools = [
  {
    name: "list_segments",
    description:
      "List existing audience segments saved in the app. " +
      "Check this before suggesting a new segment to avoid duplicates.",
    inputSchema: {
      type: "object",
      properties: {
        segment_type: {
          type: "string",
          enum: ["customer", "anonymous_profile"],
          description: "Filter by segment type. Omit to return both.",
        },
      },
    },
  },
  {
    name: "preview_segment_size",
    description:
      "Estimate how many people match a segment's criteria without saving anything. " +
      "Always call this before suggesting a segment so you can report a real estimated_size. " +
      "For 'customer' segments: queries app.customer_profiles. " +
      "For 'anonymous_profile' segments: queries app.anonymous_profiles (unresolved web visitors).",
    inputSchema: {
      type: "object",
      properties: {
        segment_type: {
          type: "string",
          enum: ["customer", "anonymous_profile"],
          description: "Which profile type to count.",
        },
        sql_where: {
          type: "string",
          description:
            "A SQL WHERE clause fragment (no WHERE keyword) to filter the base table. " +
            "For customer: filters on app.customer_profiles columns (member_reg_channel, age_group, education_level, ga_sessions, order_count, etc.). " +
            "For anonymous_profile: filters on app.anonymous_profiles columns (top_source_medium, form_completes, etc.).",
        },
      },
      required: ["segment_type", "sql_where"],
    },
  },
];

export async function handleSegmentTool(name, args, pool) {
  if (name === "list_segments") {
    try {
      const params = [];
      const where = args.segment_type ? `WHERE segment_type = $1` : "";
      if (args.segment_type) params.push(args.segment_type);
      const result = await pool.query(
        `SELECT id, name, description, segment_type, estimated_size, status, created_date
         FROM app.segments ${where}
         ORDER BY created_date DESC
         LIMIT 50`,
        params
      );
      return { content: [{ type: "text", text: JSON.stringify({ segments: result.rows }) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }

  if (name === "preview_segment_size") {
    const { segment_type, sql_where } = args;
    let sql;
    if (segment_type === "customer") {
      sql = `SELECT COUNT(DISTINCT member_id) AS count FROM app.customer_profiles WHERE ${sql_where}`;
    } else {
      // anonymous_profile: unresolved web visitors live in app.anonymous_profiles
      sql = `SELECT COUNT(DISTINCT visitor_id) AS count
             FROM app.anonymous_profiles
             WHERE ${sql_where}`;
    }
    try {
      const result = await pool.query(sql);
      const count = parseInt(result.rows[0]?.count ?? 0, 10);
      return { content: [{ type: "text", text: JSON.stringify({ estimated_count: count, segment_type, sql_where }) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message, attempted_sql: sql }) }],
      };
    }
  }

  return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown segment tool: ${name}` }) }] };
}
