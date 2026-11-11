import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { oauthUrls } from "@/lib/mcp/oauth";
import { ALL_WRITE, createNordavoMcpServer } from "@/lib/mcp/server";
import type { McpAccessLevels } from "@/lib/mcp/module-access";
import { authenticateMcpToken, mcpAuthErrorMessage } from "@/lib/mcp/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * MCP server for Claude Code (Streamable HTTP, stateless, JSON responses).
 *
 *   POST /api/mcp   JSON-RPC, Authorization: Bearer nrd_... or nrda_...
 *   GET, DELETE     405: no SSE stream and no sessions in stateless mode.
 *
 * Public in the proxy; authenticates itself with a personal MCP token
 * (Instellingen > Claude Code koppelen) or an OAuth access token
 * (src/lib/mcp/oauth.ts). A 401 points to the OAuth metadata, so clients
 * like Claude can start the sign in themselves. Reads and writes with the
 * secret key, scoped to what a Nordavo team member may see.
 */
export async function POST(request: Request) {
  await connection();

  const db = createAdminClient();
  if (!db) {
    return jsonRpcError(503, "The MCP server is not configured: SUPABASE_SECRET_KEY is missing on the server.");
  }

  const auth = await authenticateMcpToken(request.headers.get("authorization"), db);
  if (!auth.ok) {
    const metadata = `resource_metadata="${oauthUrls(env.siteUrl()).resourceMetadata}"`;
    const error = auth.reason === "missing" ? "" : ', error="invalid_token"';
    return jsonRpcError(401, mcpAuthErrorMessage(auth.reason), {
      "WWW-Authenticate": `Bearer realm="nordavo", ${metadata}${error}`,
    });
  }

  const server = createNordavoMcpServer(auth.context, db, env.siteUrl(), await loadMcpLevels(db));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("[mcp] request failed:", error instanceof Error ? error.message : error);
    return jsonRpcError(500, "Internal error in the MCP server.");
  } finally {
    await server.close().catch(() => {});
  }
}

/** Claude's rights per module (Settings, Claude); as before when the table is not there yet. */
async function loadMcpLevels(db: NonNullable<ReturnType<typeof createAdminClient>>): Promise<McpAccessLevels> {
  const { data, error } = await db.from("mcp_module_access").select("module, level");
  if (error) {
    console.error("[mcp] rights per module:", error.message);
    return ALL_WRITE;
  }
  return Object.fromEntries(data.map((row) => [row.module, row.level]));
}

export async function GET() {
  await connection();
  return methodNotAllowed();
}

export async function DELETE() {
  await connection();
  return methodNotAllowed();
}

function methodNotAllowed() {
  return jsonRpcError(405, "Method not allowed: this MCP server is stateless and only accepts POST.", {
    Allow: "POST",
  });
}

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json(
    { jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32000, message }, id: null },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}
