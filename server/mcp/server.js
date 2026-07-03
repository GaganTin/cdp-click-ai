import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { databaseTools, handleDatabaseTool } from "./tools/database.js";
import { segmentTools, handleSegmentTool } from "./tools/segments.js";
import { utmTools, handleUtmTool } from "./tools/utm.js";
import { analyticsTools, handleAnalyticsTool } from "./tools/analytics.js";
import { catalogTools, handleCatalogTool } from "./tools/catalog.js";

// NOTE: EDM (email) tools are intentionally NOT registered - email is a
// coming-soon feature, so the analyst must have no access to email data and
// must not suggest email campaigns. Re-add edm.js here when email ships.
const ALL_TOOLS = [...databaseTools, ...segmentTools, ...utmTools, ...analyticsTools, ...catalogTools];

/**
 * Create a connected MCP server+client pair for in-process use.
 * Returns a Client that the agent loop can call.
 *
 * Tool groups:
 *   DB Connector  - query_data, list_tables, describe_table
 *   Segments      - list_segments, preview_segment_size
 *   UTM           - list_campaigns, analyze_utm_performance
 *   Analytics     - score_rfm, estimate_clv, score_churn_risk, analyze_cohort_retention,
 *                   cluster_members, find_association_rules, predict_next_event,
 *                   compute_channel_attribution, detect_anomalies, forecast_registrations
 *
 * The AI NEVER writes to the DB (no create tools). Users approve all saves via UI.
 */
export async function createAnalystMCPClient(pool, dataDictionary) {
  const server = new Server(
    { name: "cdp-analyst-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    if (databaseTools.some((t) => t.name === name)) {
      return handleDatabaseTool(name, args, pool, dataDictionary);
    }
    if (segmentTools.some((t) => t.name === name)) {
      return handleSegmentTool(name, args, pool);
    }
    if (utmTools.some((t) => t.name === name)) {
      return handleUtmTool(name, args, pool);
    }
    if (analyticsTools.some((t) => t.name === name)) {
      return handleAnalyticsTool(name, args, pool);
    }
    if (catalogTools.some((t) => t.name === name)) {
      return handleCatalogTool(name, args, pool);
    }

    return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: "cdp-analyst-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

/** Convert MCP tool definitions to the OpenAI function-calling format. */
export function toOpenAITools(mcpTools) {
  return mcpTools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}
