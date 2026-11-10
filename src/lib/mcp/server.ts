import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpDb } from "@/lib/mcp/shared";
import type { McpTokenContext } from "@/lib/mcp/tokens";
import { scopeDbToModules } from "@/lib/mcp/module-scope";
import { registerTools } from "@/lib/mcp/tools";
import { registerSalesTools } from "@/lib/mcp/sales-tools";
import { registerJobRunTool } from "@/lib/mcp/job-run-tool";
import { registerRecruitmentAiTools } from "@/lib/mcp/recruitment-ai-tools";
import { registerAiRequestTools } from "@/lib/mcp/ai-request-tools";
import { registerContentTools } from "@/lib/mcp/content-tools";
import { effectiveModules, portalModules } from "@/lib/modules";

export const MCP_SERVER_NAME = "nordavo";
export const MCP_SERVER_VERSION = "1.0.0";

function instructions(ctx: McpTokenContext) {
  const lines = [
    "Nordavo is a Dutch recruitment portal that places Indian tech talent at Dutch companies.",
    "Records: clients (with contact persons), vacancies (with a pipeline of applications per stage: sourced, techstack_check, fill_out, video_review, technical_test, interview, matched (presented to the client), client_interview, final_screening, placed, and apart from the flow parked and rejected; a vacancy belongs to a client, a GTM prospect or the talent pool, which has no client yet and no three-week clock), candidates, placements (30-day guarantee, monthly check-ins), tasks, notes and an activity log. The GTM side has companies (prospects), contacts and hiring signals.",
    "Use search to find ids, then the get_* tools for details. Lists return at most 100 rows; use offset to page. Dates are YYYY-MM-DD in Europe/Amsterdam. Notes are often in Dutch.",
    `You act as ${ctx.name} with this token (${ctx.access === "write" ? "read and write" : "read only"}).`,
  ];
  const modules = effectiveModules(ctx.role, ctx.modules);
  if (modules.length < portalModules.length) {
    const labels = portalModules.filter((m) => modules.includes(m.value)).map((m) => m.label);
    lines.push(
      `This account only sees these modules: ${labels.join(", ") || "none"}. Tools on other modules answer with a no access error; do not retry them.`,
    );
  }
  if (ctx.access === "write") {
    lines.push(
      "Write tools (create_task, update_task_status, add_note, move_candidates, mark_topper) change shared data the whole team sees. Only call them when the user asked for that specific change, never speculatively or in a loop.",
    );
  }
  if (modules.includes("recruitment")) {
    lines.push(
      "Matching and CV screening are done by you, not by the portal: list_match_requests, get_match_pool and save_matches (with save_search_brief) for matching; list_applications_to_score, get_cv_file, save_cv_text and save_cv_score for screening. Follow the instructions the tools return.",
    );
  }
  if (modules.includes("recruitment") || modules.includes("academy")) {
    lines.push(
      "Other judgement the portal needs (reading vacancies and CVs, the techstack check, talent pool questions, anonymous profiles, prompt comparisons, Academy proposals and lesson drafts) waits in list_ai_requests; answer each with complete_ai_request in its answer_schema.",
    );
  }
  lines.push(
    "LinkedIn content (content_* tools): workspaces per employee with ideas, posts, media and results. Read posts and media, and help with suggestions only (media descriptions, image suggestions, image briefs, text changes): you never pick, approve, schedule or publish, a person decides on every suggestion.",
  );
  lines.push("Candidate and contact details are personal data: use them for the task at hand and do not copy them elsewhere unasked.");
  return lines.join("\n");
}

/** A fresh server per request: the endpoint is stateless. */
export function createNordavoMcpServer(ctx: McpTokenContext, db: McpDb, siteUrl: string): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: instructions(ctx), capabilities: { tools: {} } },
  );
  // The db is the secret key client: scope it to the owner's modules (2.5).
  const scoped = scopeDbToModules(db, effectiveModules(ctx.role, ctx.modules));
  registerTools(server, { ...ctx, db: scoped, siteUrl });
  registerSalesTools(server, { ...ctx, db: scoped, siteUrl });
  registerRecruitmentAiTools(server, { ...ctx, db: scoped, siteUrl });
  registerAiRequestTools(server, { ...ctx, db: scoped, siteUrl });
  registerJobRunTool(server, { ...ctx, db: scoped, siteUrl });
  // Content has its own rights (content_api_*), independent of the portal modules.
  registerContentTools(server, { ...ctx, db, siteUrl });
  return server;
}
