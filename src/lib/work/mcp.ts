import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ApiError,
  addComment,
  createTask,
  getTask,
  listProjects,
  listTasks,
  me,
  prioritySchema,
  setStatus,
  statusSchema,
  updateTask,
  type ApiDb,
} from "@/lib/work/api";
import type { WorkApiActor } from "@/lib/work/tokens";

/** MCP server for the task tool (/api/work/mcp): the same operations and rights as the REST API. */
export function createWorkMcpServer(actor: WorkApiActor, db: ApiDb, siteUrl: string) {
  const server = new McpServer(
    { name: "nordavo-work", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: [
        "Work is Nordavo's task tool: workspaces > projects > tasks > subtasks.",
        "Statuses: todo, in_progress, review, done, cancelled. Done needs the reviewer; moving a task back from review needs a comment.",
        "Deadlines are ISO 8601 in UTC. Comments may mention people as @[Name](user id).",
        `You act as ${actor.name} (${actor.access === "write" ? "read and write" : "read only"}), with exactly their rights.`,
        "Only change tasks when the user asked for that specific change. Comments and files can hold candidate data: do not copy them elsewhere unasked.",
      ].join("\n"),
    },
  );

  const run = async (fn: () => Promise<unknown>): Promise<CallToolResult> => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
    } catch (error) {
      const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Failed";
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  };
  const read = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "whoami",
    { title: "Who am I", description: "The token owner, their workspaces and roles.", annotations: read },
    () => run(() => me(db, actor, siteUrl)),
  );
  server.registerTool(
    "list_projects",
    {
      title: "Projects",
      description: "Projects the user can open, optionally in one workspace.",
      inputSchema: { workspace_id: z.guid().optional() },
      annotations: read,
    },
    ({ workspace_id }) => run(() => listProjects(db, actor, workspace_id)),
  );
  server.registerTool(
    "list_tasks",
    {
      title: "Tasks",
      description: "Tasks the user can open. Use assignee 'me' for my tasks and reviewer 'me' with status 'review' for my reviews.",
      inputSchema: {
        project_id: z.guid().optional(),
        workspace_id: z.guid().optional(),
        status: statusSchema.optional(),
        assignee: z.string().optional().describe("'me' or a user id"),
        reviewer: z.string().optional().describe("'me' or a user id"),
        include_subtasks: z.boolean().default(true),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: read,
    },
    (args) =>
      run(() =>
        listTasks(
          db,
          actor,
          {
            project: args.project_id,
            workspace: args.workspace_id,
            status: args.status,
            assignee: args.assignee,
            reviewer: args.reviewer,
            subtasks: args.include_subtasks ? "true" : "false",
            limit: args.limit,
            offset: args.offset,
          },
          siteUrl,
        ),
      ),
  );
  server.registerTool(
    "get_task",
    { title: "Task", description: "One task with description, subtasks, comments and files.", inputSchema: { task_id: z.guid() }, annotations: read },
    ({ task_id }) => run(() => getTask(db, actor, task_id, siteUrl)),
  );

  if (actor.access !== "write") return server;

  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description: "Create a task (or subtask with parent_id). The reviewer defaults to the user.",
      inputSchema: {
        project_id: z.guid(),
        title: z.string().min(1).max(300),
        description: z.string().max(50_000).optional(),
        priority: prioritySchema.optional(),
        due_at: z.string().optional().describe("ISO 8601, e.g. 2026-11-03T16:00:00Z"),
        reviewer_id: z.guid().optional(),
        assignee_ids: z.array(z.guid()).max(20).optional(),
        parent_id: z.guid().optional(),
      },
      annotations: write,
    },
    (args) =>
      run(() =>
        createTask(db, actor, { ...args, due_at: args.due_at ? new Date(args.due_at).toISOString() : undefined }, siteUrl),
      ),
  );
  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description: "Change title, description, priority, deadline, reviewer or owners (assignee_ids replaces the list).",
      inputSchema: {
        task_id: z.guid(),
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(50_000).optional(),
        priority: prioritySchema.optional(),
        due_at: z.string().nullable().optional(),
        reviewer_id: z.guid().optional(),
        assignee_ids: z.array(z.guid()).max(20).optional(),
      },
      annotations: write,
    },
    ({ task_id, due_at, ...rest }) =>
      run(() =>
        updateTask(
          db,
          actor,
          task_id,
          { ...rest, ...(due_at !== undefined ? { due_at: due_at ? new Date(due_at).toISOString() : null } : {}) },
          siteUrl,
        ),
      ),
  );
  server.registerTool(
    "set_status",
    {
      title: "Change status",
      description: "Move a task. Review mails the reviewer. Done only for the reviewer or an admin. Back from review needs a comment.",
      inputSchema: { task_id: z.guid(), status: statusSchema, comment: z.string().max(20_000).optional() },
      annotations: write,
    },
    ({ task_id, status, comment }) => run(() => setStatus(db, actor, task_id, { status, comment }, siteUrl)),
  );
  server.registerTool(
    "add_comment",
    {
      title: "Comment",
      description: "Add a comment. Mention people with @[Name](user id) or mention_ids; they get a mail.",
      inputSchema: { task_id: z.guid(), body: z.string().min(1).max(20_000), mention_ids: z.array(z.guid()).max(20).optional() },
      annotations: write,
    },
    ({ task_id, body, mention_ids }) => run(() => addComment(db, actor, task_id, { body, mention_ids })),
  );
  return server;
}
