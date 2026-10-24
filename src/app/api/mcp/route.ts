import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { createNordavoMcpServer } from "@/lib/mcp/server";
import { authenticateMcpToken, mcpAuthErrorMessage } from "@/lib/mcp/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * MCP server for Claude Code (Streamable HTTP, stateless, JSON responses).
 *
 *   POST /api/mcp   JSON-RPC, Authorization: Bearer nrd_...
 *   GET, DELETE     405: no SSE stream and no sessions in stateless mode.
 *
 * Public in the proxy; authenticates itself with a personal MCP token
 * (Instellingen > Claude Code koppelen). Reads and writes with the secret
 * key, scoped to what a Nordavo team member may see.
 */
export async function POST(request: Request) {
  await connection();

  const db = createAdminClient();
  if (!db) {
    return jsonRpcError(503, "De MCP server is niet geconfigureerd: SUPABASE_SECRET_KEY ontbreekt op de server.");
  }

  const auth = await authenticateMcpToken(request.headers.get("authorization"), db);
  if (!auth.ok) {
    const error = auth.reason === "missing" ? 'realm="nordavo"' : 'realm="nordavo", error="invalid_token"';
    return jsonRpcError(401, mcpAuthErrorMessage(auth.reason), { "WWW-Authenticate": `Bearer ${error}` });
  }

  const server = createNordavoMcpServer(auth.context, db, env.siteUrl());
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
    return jsonRpcError(500, "Interne fout in de MCP server.");
  } finally {
    await server.close().catch(() => {});
  }
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
  return jsonRpcError(405, "Method not allowed: deze MCP server is stateless en accepteert alleen POST.", {
    Allow: "POST",
  });
}

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json(
    { jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32000, message }, id: null },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}
