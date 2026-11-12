import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fail,
  idSchema,
  linkableTypes,
  ok,
  recordExists,
  recordUrl,
  type McpDb,
  type McpToolContext,
} from "@/lib/mcp/shared";
import { MAX_BULK_MOVE, moveTargets } from "@/lib/recruitment/pipeline";
import { amsterdamDueAt, inboxProject, shapeWorkTasks } from "@/lib/mcp/work-tasks";
import type { Json } from "@/lib/database.types";
import { workTaskTypes as taskTypeOptions } from "@/lib/work/labels";
import type { WorkTaskType } from "@/lib/work/database";

const workTaskTypes = taskTypeOptions.map((t) => t.value) as [WorkTaskType, ...WorkTaskType[]];

/** Type, labels, start date and estimate from a tool input, for work_update_task. */
export function planningFields(input: {
  task_type?: string | null;
  labels?: string[];
  start_on?: string | null;
  estimate_minutes?: number | null;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (input.task_type !== undefined) fields.task_type = input.task_type ?? "";
  if (input.labels !== undefined) fields.labels = input.labels;
  if (input.start_on !== undefined) fields.start_on = input.start_on ?? "";
  if (input.estimate_minutes !== undefined) fields.estimate_minutes = input.estimate_minutes ?? "";
  return fields;
}

/** Staff only: tasks are never assigned to client portal users. */
async function isStaffMember(db: McpDb, userId: string) {
  const { data } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin" || data?.role === "member";
}

export type MoveCandidatesInput = {
  vacancy_id: string;
  application_ids?: string[];
  candidate_ids?: string[];
  stage: (typeof moveTargets)[number];
  reason?: string;
  park_until?: string;
};

/**
 * Move applications of one vacancy in bulk, in the name of the token owner,
 * through public.move_applications_as() (same checks, history and triggers
 * as the board). Applications are given by id or by candidate id; ids that
 * are not on this vacancy are reported back, not moved.
 */
export async function moveCandidates(db: McpDb, actorId: string, input: MoveCandidatesInput) {
  const byApplication = input.application_ids?.length ?? 0;
  const byCandidate = input.candidate_ids?.length ?? 0;
  if ((byApplication > 0) === (byCandidate > 0)) {
    return { error: "Give application_ids or candidate_ids (one of the two)." } as const;
  }
  if (input.park_until && input.stage !== "parked") {
    return { error: "park_until only goes with stage parked." } as const;
  }

  const wanted = [...new Set(byApplication > 0 ? input.application_ids! : input.candidate_ids!)];
  const column = byApplication > 0 ? "id" : "candidate_id";
  const { data, error } = await db
    .from("applications")
    .select("id, candidate_id, stage")
    .eq("vacancy_id", input.vacancy_id)
    .in(column, wanted);
  if (error) return { error: `Could not load the pipeline: ${error.message}` } as const;

  const found = new Set(data.map((a) => (byApplication > 0 ? a.id : a.candidate_id)));
  const notFound = wanted.filter((id) => !found.has(id));
  if (data.length === 0) return { error: "None of these candidates are on this vacancy.", not_found: notFound } as const;

  const reason = input.reason?.trim() || null;
  const { data: moved, error: moveError } = await db.rpc("move_applications_as", {
    p_actor: actorId,
    p_application_ids: data.map((a) => a.id),
    p_stage: input.stage,
    p_reason: input.stage === "parked" || input.stage === "rejected" ? reason : null,
    p_park_until: input.stage === "parked" ? (input.park_until ?? null) : null,
  });
  if (moveError) return { error: `Could not move: ${moveError.message}` } as const;

  return {
    moved: moved ?? 0,
    // Already in that stage, or (for resume) not parked or rejected.
    unchanged: data.length - (moved ?? 0),
    not_found: notFound,
  } as const;
}

/** Mark or unmark toppers (2.13) in the name of the token owner. */
export async function markToppers(
  db: McpDb,
  actorId: string,
  input: { candidate_ids: string[]; is_topper: boolean; reason?: string },
) {
  const reason = input.reason?.trim();
  if (input.is_topper && !reason) return { error: "Give a short reason why these candidates are toppers." } as const;
  const ids = [...new Set(input.candidate_ids)];
  const { data, error } = await db
    .from("candidates")
    .update(
      input.is_topper
        ? { is_topper: true, topper_reason: reason, topper_by: actorId }
        : { is_topper: false, topper_reason: null, topper_by: null, topper_at: null },
    )
    .in("id", ids)
    .select("id, full_name, is_topper, topper_reason, topper_at");
  if (error) return { error: `Could not update: ${error.message}` } as const;
  const found = new Set(data.map((c) => c.id));
  return { updated: data, not_found: ids.filter((id) => !found.has(id)) } as const;
}

/** Only called for tokens with write access; every handler checks again. */
export function registerWriteTools(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;
  const denied = () => fail("This token can only read. Create a token with write access under Settings.");

  // -------------------------------------------------------------------------
  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description:
        "Create a Work task. Pick the project with project_id (list_work_projects shows them, private workspaces and the inbox included). Without project_id: a task linked to a record (client, lead/company, vacancy, candidate, application or placement) goes to the private project Portal records of the Nordavo team, any other task to the token owner's inbox. The token owner is the reviewer unless reviewer_id is given, and the owner unless assignee_ids is given. Only call after the user asked for it.",
      inputSchema: {
        title: z.string().trim().min(1).max(300),
        description: z.string().max(5000).optional().describe("Markdown."),
        project_id: z.union([idSchema, z.literal("inbox")]).optional().describe("The project (list_work_projects), or inbox."),
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        due_date: z.iso.date().optional().describe("YYYY-MM-DD; the deadline becomes 17:00 Europe/Amsterdam that day."),
        due_at: z.iso.datetime({ offset: true }).optional().describe("Or an exact deadline (ISO 8601)."),
        assignee_id: idSchema.optional().describe("One owner (profile id). Default: the token owner."),
        assignee_ids: z.array(idSchema).max(10).optional().describe("Or several owners."),
        reviewer_id: idSchema.optional().describe("Who approves the task. Default: the token owner."),
        task_type: z.enum(workTaskTypes).optional(),
        labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        start_on: z.iso.date().optional(),
        estimate_minutes: z.number().int().min(0).max(10_000).optional(),
        entity_type: z.enum(linkableTypes).optional().describe("Type of the linked record (requires entity_id)."),
        entity_id: idSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      if (ctx.access !== "write") return denied();
      const { title, description, priority, due_date, due_at, entity_type, entity_id } = input;
      if (Boolean(entity_type) !== Boolean(entity_id)) return fail("Give entity_type and entity_id together.");
      if (entity_type && entity_id && !(await recordExists(db, entity_type, entity_id))) {
        return fail("The linked record does not exist.");
      }
      const owners = [...new Set(input.assignee_ids?.length ? input.assignee_ids : [input.assignee_id ?? ctx.userId])];
      for (const owner of owners) {
        if (owner !== ctx.userId && !(await isStaffMember(db, owner))) return fail(`${owner} is not a Nordavo team member.`);
      }

      let project: string | null = null;
      if (input.project_id === "inbox" || (!input.project_id && !entity_type)) {
        project = await inboxProject(db, ctx.userId);
        if (!project) return fail("Your inbox could not be opened.");
      } else if (input.project_id) {
        const { data: visible } = await db.rpc("work_api_can_view_project", { p_project: input.project_id, p_user: ctx.userId });
        if (!visible) return fail("Project not found. See list_work_projects.");
        project = input.project_id;
      }

      // work_create_record_task checks the module of the record and acts as the token owner.
      const { data: taskId, error } = await db.rpc("work_create_record_task", {
        p_entity_type: entity_type ?? null,
        p_entity_id: entity_id ?? null,
        p_title: title,
        p_description: description?.trim() || null,
        p_priority: priority,
        p_due_at: due_at ?? (due_date ? amsterdamDueAt(due_date) : null),
        p_assignees: owners,
        p_project: project,
        p_actor: ctx.userId,
      });
      if (error || !taskId) return fail(`Could not create task: ${error?.message ?? "no id returned"}`);

      const extra = planningFields(input);
      if (Object.keys(extra).length) {
        const { error: updateError } = await db.rpc("work_update_task", { p_task: taskId, p_fields: extra as Json, p_actor: ctx.userId });
        if (updateError) return fail(`The task was created (${taskId}), but not all fields were saved: ${updateError.message}`);
      }

      const { data: row } = await db.from("work_tasks").select("*").eq("id", taskId).single();
      const [created] = row ? await shapeWorkTasks(db, [row], ctx.siteUrl) : [];
      return ok({ created: created ?? { id: taskId }, url: recordUrl(ctx.siteUrl, "task", taskId) });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "update_task",
    {
      title: "Change task",
      description:
        "Change a Work task: title, description, deadline, owners (replaces them), reviewer, priority, type, labels, start date, estimate, or move it to another project (project_id; from the inbox or a private workspace also to another workspace). Leave out what stays the same; null clears a deadline, start date, type or estimate. Status goes through update_task_status. Only call after the user asked for it.",
      inputSchema: {
        id: idSchema.describe("Task id."),
        title: z.string().trim().min(1).max(300).optional(),
        description: z.string().max(5000).nullable().optional().describe("Markdown; null clears it."),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        due_date: z.iso.date().nullable().optional().describe("YYYY-MM-DD (17:00 Amsterdam), or null to clear."),
        due_at: z.iso.datetime({ offset: true }).optional().describe("Or an exact deadline."),
        assignee_ids: z.array(idSchema).max(10).optional().describe("The new owners (replaces the list)."),
        reviewer_id: idSchema.nullable().optional(),
        task_type: z.enum(workTaskTypes).nullable().optional(),
        labels: z.array(z.string().trim().min(1).max(40)).max(20).optional().describe("Replaces the labels."),
        start_on: z.iso.date().nullable().optional(),
        estimate_minutes: z.number().int().min(0).max(10_000).nullable().optional(),
        project_id: z.union([idSchema, z.literal("inbox")]).optional().describe("Move to this project (subtasks move along)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      if (ctx.access !== "write") return denied();
      const { data: visible } = await db.rpc("work_api_can_view_task", { p_task: input.id, p_user: ctx.userId });
      if (!visible) return fail("Task not found.");

      if (input.project_id) {
        const target = input.project_id === "inbox" ? await inboxProject(db, ctx.userId) : input.project_id;
        if (!target) return fail("Your inbox could not be opened.");
        const { error } = await db.rpc("work_move_task", { p_task: input.id, p_project: target, p_actor: ctx.userId });
        if (error) return fail(`Could not move the task: ${error.message}`);
      }
      const fields: Record<string, unknown> = planningFields(input);
      if (input.title !== undefined) fields.title = input.title;
      if (input.description !== undefined) fields.description = input.description ?? "";
      if (input.priority !== undefined) fields.priority = input.priority;
      if (input.due_at !== undefined) fields.due_at = input.due_at;
      else if (input.due_date !== undefined) fields.due_at = input.due_date ? amsterdamDueAt(input.due_date) : null;
      if (input.reviewer_id !== undefined) fields.reviewer_id = input.reviewer_id ?? "";
      if (Object.keys(fields).length) {
        const { error } = await db.rpc("work_update_task", { p_task: input.id, p_fields: fields as Json, p_actor: ctx.userId });
        if (error) return fail(`Could not update the task: ${error.message}`);
      }
      if (input.assignee_ids) {
        for (const owner of input.assignee_ids) {
          if (owner !== ctx.userId && !(await isStaffMember(db, owner))) return fail(`${owner} is not a Nordavo team member.`);
        }
        const { error } = await db.rpc("work_set_assignees", { p_task: input.id, p_users: [...new Set(input.assignee_ids)], p_actor: ctx.userId });
        if (error) return fail(`Could not change the owners: ${error.message}`);
      }
      const { data: row } = await db.from("work_tasks").select("*").eq("id", input.id).single();
      const [updated] = row ? await shapeWorkTasks(db, [row], ctx.siteUrl) : [];
      return ok({ updated: updated ?? { id: input.id } });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "add_task_comment",
    {
      title: "Comment on task",
      description:
        "Place a comment on a Work task, as the token owner. Mention people with mention_ids (they get a notification). Only call after the user asked for it.",
      inputSchema: {
        id: idSchema.describe("Task id."),
        body: z.string().trim().min(1).max(10_000).describe("The comment (Markdown)."),
        mention_ids: z.array(idSchema).max(20).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, body, mention_ids }) => {
      if (ctx.access !== "write") return denied();
      const { data: visible } = await db.rpc("work_api_can_view_task", { p_task: id, p_user: ctx.userId });
      if (!visible) return fail("Task not found.");
      const { data, error } = await db.rpc("work_add_comment", { p_task: id, p_body: body, p_mentions: mention_ids ?? [], p_actor: ctx.userId });
      if (error) return fail(`Could not add the comment: ${error.message}`);
      return ok({ comment_id: data, url: recordUrl(ctx.siteUrl, "task", id) });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "update_task_status",
    {
      title: "Change task status",
      description:
        "Set the status of a Work task: todo, in_progress, review or done. The review rules of Work apply: an owner (from todo or in_progress), the reviewer or a workspace admin can mark a task as done, from review only the reviewer or an admin, review needs a reviewer, and moving a task back from review or done needs a comment that says what still needs to happen. Only call after the user asked for it.",
      inputSchema: {
        id: idSchema.describe("Task id."),
        status: z.enum(["todo", "in_progress", "review", "done"]),
        comment: z.string().trim().max(5000).optional().describe("Required when moving back from review or done."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, status, comment }) => {
      if (ctx.access !== "write") return denied();
      const { data: visible } = await db.rpc("work_api_can_view_task", { p_task: id, p_user: ctx.userId });
      if (!visible) return fail("Task not found.");
      const { error } = await db.rpc("work_set_status", {
        p_task: id,
        p_status: status,
        p_comment: comment || null,
        p_actor: ctx.userId,
      });
      if (error) return fail(`Could not update task: ${error.message}`);

      const { data: row } = await db.from("work_tasks").select("*").eq("id", id).single();
      const [updated] = row ? await shapeWorkTasks(db, [row], ctx.siteUrl) : [];
      return ok({ updated: updated ?? { id, status } });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "add_note",
    {
      title: "Add note",
      description:
        "Add a note to a client, vacancy, candidate, application, placement or GTM company, written as the token owner. Only call after the user asked for it.",
      inputSchema: {
        entity_type: z.enum(linkableTypes),
        entity_id: idSchema,
        body: z.string().trim().min(1).max(10000).describe("Note text (plain text)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ entity_type, entity_id, body }) => {
      if (ctx.access !== "write") return denied();
      if (!(await recordExists(db, entity_type, entity_id))) return fail("The record does not exist.");

      const { data, error } = await db
        .from("notes")
        .insert({ entity_type, entity_id, body, author_id: ctx.userId })
        .select("id, entity_type, entity_id, created_at")
        .single();
      if (error) return fail(`Could not add note: ${error.message}`);
      return ok({ created: data, url: recordUrl(ctx.siteUrl, entity_type, entity_id) });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "move_candidates",
    {
      title: "Move candidates in a pipeline",
      description:
        "Move candidates of ONE vacancy at once, as the token owner: to a stage (sourced, techstack_check, fill_out, video_review, technical_test, interview, matched = presented to the client, client_interview, final_screening, placed), park them (stage parked, with reason and optional park_until), reject them (stage rejected, with reason) or resume parked or rejected ones to the stage they left (stage resume). Give application_ids, or candidate_ids for that vacancy. History, candidate status and the client portal update like on the board. Only call after the user asked for this move; check get_vacancy first.",
      inputSchema: {
        vacancy_id: idSchema.describe("Vacancy id."),
        application_ids: z.array(idSchema).max(MAX_BULK_MOVE).optional().describe("Applications to move."),
        candidate_ids: z.array(idSchema).max(MAX_BULK_MOVE).optional().describe("Or: candidates to move on this vacancy."),
        stage: z.enum(moveTargets),
        reason: z.string().max(2000).optional().describe("Why, for parked or rejected. Shown on the card."),
        park_until: z.iso.date().optional().describe("Parked only: date to look again, YYYY-MM-DD."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      if (ctx.access !== "write") return denied();
      const result = await moveCandidates(db, ctx.userId, input);
      if ("error" in result) return fail(result.error ?? "Could not move.");
      const vacancyUrl = recordUrl(ctx.siteUrl, "vacancy", input.vacancy_id);
      return ok({ ...result, url: vacancyUrl ? `${vacancyUrl}/pipeline` : null });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "mark_topper",
    {
      title: "Mark toppers",
      description:
        "Mark candidates as topper (someone we really trust after video, screening, CV score, test and interview) with a short reason, or remove the mark (is_topper false). The mark stays on the candidate across vacancies. Only call after the user asked for it.",
      inputSchema: {
        candidate_ids: z.array(idSchema).min(1).max(100),
        is_topper: z.boolean().default(true),
        reason: z.string().max(1000).optional().describe("Required when marking: why, in a sentence."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      if (ctx.access !== "write") return denied();
      const result = await markToppers(db, ctx.userId, input);
      if ("error" in result) return fail(result.error ?? "Could not update.");
      return ok(result);
    },
  );
}
