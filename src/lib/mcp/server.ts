import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpDb } from "@/lib/mcp/shared";
import type { McpTokenContext } from "@/lib/mcp/tokens";
import { registerTools } from "@/lib/mcp/tools";

export const MCP_SERVER_NAME = "nordavo";
export const MCP_SERVER_VERSION = "1.0.0";

function instructions(ctx: McpTokenContext) {
  const lines = [
    "Nordavo is a Dutch recruitment portal that places Indian tech talent at Dutch companies.",
    "Records: clients (with contact persons), vacancies (with a pipeline of applications per stage: sourced, screening, technical_test, english_interview, presented, final_interview, placed, rejected), candidates, placements (30-day guarantee, monthly check-ins), tasks, notes and an activity log. The GTM side has companies (prospects), contacts and hiring signals.",
    "Use search to find ids, then the get_* tools for details. Lists return at most 100 rows; use offset to page. Dates are YYYY-MM-DD in Europe/Amsterdam. Labels and notes are mostly Dutch.",
    `You act as ${ctx.name} with this token (${ctx.access === "write" ? "read and write" : "read only"}).`,
  ];
  if (ctx.access === "write") {
    lines.push(
      "Write tools (create_task, update_task_status, add_note) change shared data the whole team sees. Only call them when the user asked for that specific change, never speculatively or in a loop.",
    );
  }
  lines.push("Candidate and contact details are personal data: use them for the task at hand and do not copy them elsewhere unasked.");
  return lines.join("\n");
}

/** A fresh server per request: the endpoint is stateless. */
export function createNordavoMcpServer(ctx: McpTokenContext, db: McpDb, siteUrl: string): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: instructions(ctx), capabilities: { tools: {} } },
  );
  registerTools(server, { ...ctx, db, siteUrl });
  return server;
}
