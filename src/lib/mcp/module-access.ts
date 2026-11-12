import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * How far Claude may write per module (feedback Julius, 11 November 2026).
 * An admin sets it under Settings, Claude (MCP); the table is
 * mcp_module_access (20261121020000_mcp_claude_rights.sql).
 *
 *   read     Claude only reads: no write tools of the module are offered.
 *   suggest  Claude reads, drafts and suggests: only the tools that make a
 *            draft or a suggestion a person decides on.
 *   write    Everything the token owner may do.
 *
 * A module without a row is "suggest": a new module comes with a Claude
 * connection to read, draft and suggest, and an admin decides about writing.
 * Pure (no server-only), so the settings form and the tests use it too.
 */

export type McpWriteLevel = "read" | "suggest" | "write";

export const mcpModules = [
  { value: "work", label: "Work", description: "Tasks: create, change, comment, move between projects." },
  { value: "sales", label: "Sales", description: "Companies, contacts, meetings, call lists, sequences and replies." },
  { value: "recruitment", label: "Recruitment", description: "Pipelines, toppers, matching and CV screening." },
  { value: "records", label: "Notes", description: "Notes on clients, vacancies, candidates, placements and leads." },
  { value: "content", label: "Content", description: "LinkedIn posts, ideas, media and results." },
  { value: "academy", label: "Academy", description: "Answers to Academy requests." },
] as const;

export type McpModule = (typeof mcpModules)[number]["value"];

export const mcpWriteLevels: { value: McpWriteLevel; label: string; description: string }[] = [
  { value: "read", label: "Read only", description: "Claude reads, never writes." },
  { value: "suggest", label: "Drafts and suggestions", description: "Claude reads, makes drafts and suggests; a person decides." },
  { value: "write", label: "Full write", description: "Claude does everything you may do yourself." },
];

/** The level for a module without a row. */
export const DEFAULT_LEVEL: McpWriteLevel = "suggest";

export type McpAccessLevels = Partial<Record<string, McpWriteLevel>>;

export function levelOf(levels: McpAccessLevels, module: McpModule): McpWriteLevel {
  return levels[module] ?? DEFAULT_LEVEL;
}

/**
 * Every tool that changes data, with its module and kind. "suggest" tools
 * make a draft or a suggestion; "write" tools change data directly. Read
 * tools are not listed: they are always offered (within the owner's own
 * modules). A test checks that every write tool is in here.
 */
export const WRITE_TOOLS: Record<string, { module: McpModule; kind: "suggest" | "write" }> = {
  // Work
  create_task: { module: "work", kind: "write" },
  update_task: { module: "work", kind: "write" },
  update_task_status: { module: "work", kind: "write" },
  add_task_comment: { module: "work", kind: "write" },
  // Notes on records
  add_note: { module: "records", kind: "write" },
  // Recruitment
  move_candidates: { module: "recruitment", kind: "write" },
  mark_topper: { module: "recruitment", kind: "write" },
  save_matches: { module: "recruitment", kind: "write" },
  save_search_brief: { module: "recruitment", kind: "write" },
  save_cv_text: { module: "recruitment", kind: "write" },
  save_cv_score: { module: "recruitment", kind: "write" },
  set_custom_fields: { module: "recruitment", kind: "write" },
  // Sales
  add_company: { module: "sales", kind: "write" },
  add_contact: { module: "sales", kind: "write" },
  update_meeting: { module: "sales", kind: "write" },
  close_list_for_callers: { module: "sales", kind: "write" },
  create_meeting: { module: "sales", kind: "write" },
  draft_sequence_text: { module: "sales", kind: "suggest" },
  log_activity: { module: "sales", kind: "write" },
  merge_companies: { module: "sales", kind: "write" },
  merge_contacts: { module: "sales", kind: "write" },
  open_list_for_callers: { module: "sales", kind: "write" },
  pause_company: { module: "sales", kind: "write" },
  set_icp_verdict: { module: "sales", kind: "write" },
  start_sequence: { module: "sales", kind: "write" },
  update_companies: { module: "sales", kind: "write" },
  update_contacts: { module: "sales", kind: "write" },
  update_sequence_tasks: { module: "sales", kind: "write" },
  update_signals: { module: "sales", kind: "write" },
  upsert_companies: { module: "sales", kind: "write" },
  // Content
  content_suggest_media_description: { module: "content", kind: "suggest" },
  content_suggest_images: { module: "content", kind: "suggest" },
  content_suggest_image_brief: { module: "content", kind: "suggest" },
  content_suggest_text: { module: "content", kind: "suggest" },
  content_add_idea: { module: "content", kind: "suggest" },
  content_create_post: { module: "content", kind: "write" },
  content_update_post: { module: "content", kind: "write" },
  content_archive_post: { module: "content", kind: "write" },
  content_ideas_to_post: { module: "content", kind: "write" },
  content_set_post_media: { module: "content", kind: "write" },
  content_add_media: { module: "content", kind: "write" },
  content_describe_media: { module: "content", kind: "write" },
  content_record_results: { module: "content", kind: "write" },
};

/**
 * Tools that write but are not gated: the bookkeeping of scheduled tasks
 * (log_job_run) and answering a request a person queued in the portal
 * (complete_ai_request; the portal checks the answer before applying it).
 */
export const UNGATED_WRITE_TOOLS = ["log_job_run", "complete_ai_request"] as const;

/** Whether a tool is offered at these levels. Read tools always are. */
export function toolAllowed(name: string, levels: McpAccessLevels): boolean {
  const tool = WRITE_TOOLS[name];
  if (!tool) return true;
  const level = levelOf(levels, tool.module);
  if (level === "write") return true;
  if (level === "suggest") return tool.kind === "suggest";
  return false;
}

/**
 * The server, with registerTool skipping the tools the levels do not allow.
 * The register* functions stay as they are; tools/list simply does not have
 * the others, and calling one gives "tool not found".
 */
export function gateTools(server: McpServer, levels: McpAccessLevels): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (name: string, ...rest: unknown[]) => {
          if (!toolAllowed(name, levels)) return undefined;
          return (target.registerTool as (...args: unknown[]) => unknown).call(target, name, ...rest);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** One line per module for the server instructions. */
export function levelSummary(levels: McpAccessLevels): string {
  return mcpModules
    .map((m) => `${m.label}: ${mcpWriteLevels.find((l) => l.value === levelOf(levels, m.value))?.label.toLowerCase()}`)
    .join("; ");
}
