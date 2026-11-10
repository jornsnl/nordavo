import { connection } from "next/server";
import { env } from "@/lib/env";
import { oauthJson, oauthPreflight, protectedResourceMetadata } from "@/lib/mcp/oauth";

/** RFC 9728 metadata of the MCP server at /api/mcp: where to get a token. */
export async function GET() {
  await connection();
  return oauthJson(protectedResourceMetadata(env.siteUrl()), 200, { "Cache-Control": "public, max-age=3600" });
}

export async function OPTIONS() {
  await connection();
  return oauthPreflight();
}
