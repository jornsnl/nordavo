import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { after, connection } from "next/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createWorkMcpServer } from "@/lib/work/mcp";
import { deliverNotifications } from "@/lib/work/notify";
import { authenticateWorkToken, workAuthMessage } from "@/lib/work/tokens";

/**
 * MCP server of the task tool for Claude Code (stateless Streamable HTTP).
 *   claude mcp add --transport http work <site>/api/work/mcp --header "Authorization: Bearer wrk_..."
 */
export async function POST(request: Request) {
  await connection();
  const db = createAdminClient();
  if (!db) return error(503, "SUPABASE_SECRET_KEY is missing on the server.");

  const auth = await authenticateWorkToken(request.headers.get("authorization"), db);
  if (!auth.ok) return error(401, workAuthMessage(auth.reason), { "WWW-Authenticate": 'Bearer realm="work"' });

  const server = createWorkMcpServer(auth.actor, db, env.siteUrl());
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "no-store");
    if (auth.actor.access === "write") after(() => deliverNotifications("instant", db).catch(() => undefined));
    return response;
  } catch (e) {
    console.error("[work mcp]", e instanceof Error ? e.message : e);
    return error(500, "Internal error");
  } finally {
    await server.close().catch(() => {});
  }
}

export async function GET() {
  await connection();
  return error(405, "This MCP server is stateless and only accepts POST.", { Allow: "POST" });
}

function error(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json(
    { jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32000, message }, id: null },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}
