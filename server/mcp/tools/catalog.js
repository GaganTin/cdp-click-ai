// MCP Tool Group 6: Catalog (custom attributes & pop-ups)
// Read-only tools so the analyst can see what already exists before suggesting a
// new custom attribute or pop-up (avoids duplicates). The AI never writes - the
// user approves creation via the UI cards (```attribute / ```popup blocks).

export const catalogTools = [
  {
    name: "list_attributes",
    description:
      "List existing custom attributes (targeting dimensions) saved in the app. " +
      "Check this before suggesting a new attribute to avoid duplicates. " +
      "Returns id, name, source (web_content|rule|manual), value_type and status.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_popups",
    description:
      "List existing pop-ups / interactions saved in the app. " +
      "Check this before suggesting a new pop-up to avoid duplicates. " +
      "Returns id, name, interaction_type (banner|modal|slide_in|notification) and status.",
    inputSchema: { type: "object", properties: {} },
  },
];

export async function handleCatalogTool(name, args, pool) {
  // Workspace isolation: injected by the server, not model-controllable.
  const companyId = args._company_id;
  if (!companyId) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "No workspace context - refusing to run (isolation guard)." }) }] };
  }

  if (name === "list_attributes") {
    try {
      const result = await pool.query(
        `SELECT id, name, source, value_type, status
         FROM app.attributes WHERE company_id = $1
         ORDER BY name LIMIT 100`,
        [companyId]
      );
      return { content: [{ type: "text", text: JSON.stringify({ attributes: result.rows }) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }

  if (name === "list_popups") {
    try {
      const result = await pool.query(
        `SELECT id, name, interaction_type, status
         FROM app.popups WHERE company_id = $1
         ORDER BY name LIMIT 100`,
        [companyId]
      );
      return { content: [{ type: "text", text: JSON.stringify({ popups: result.rows }) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }

  return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown catalog tool: ${name}` }) }] };
}
