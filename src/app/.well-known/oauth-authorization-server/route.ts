import { connection } from "next/server";
import { env } from "@/lib/env";
import { authorizationServerMetadata, oauthJson, oauthPreflight } from "@/lib/mcp/oauth";

/** RFC 8414 metadata of the OAuth server for the MCP server (src/lib/mcp/oauth.ts). */
export async function GET() {
  await connection();
  return oauthJson(authorizationServerMetadata(env.siteUrl()), 200, { "Cache-Control": "public, max-age=3600" });
}

export async function OPTIONS() {
  await connection();
  return oauthPreflight();
}
