import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiRequestStatus, Database, Json, PortalModule } from "@/lib/database.types";

/**
 * The AI request queue (docs/claude-jobs.md, task claude-requests). Spec
 * 2.14: Claude is the engine, so the portal needs no ANTHROPIC_API_KEY.
 * Without the key a feature stores what it would have sent to the Claude
 * API (instructions, input, the answer it expects) as a request; Claude
 * reads it through the MCP (list_ai_requests), answers it
 * (complete_ai_request) and the portal applies the answer with the same
 * code as the direct call (src/lib/ai/tasks.ts). With the key set the
 * features still call Claude directly.
 */

type Db = SupabaseClient<Database>;

/** A part of the input: text, or a stored file (a PDF) that is handed to Claude as a file. */
export type AiInputPart = { type: "text"; text: string } | { type: "file"; path: string; mime: string; title?: string };

export type AiRequestKind =
  | "vacancy_extract"
  | "techstack_check"
  | "talent_pool_rank"
  | "anonymous_profile"
  | "cv_score_compare"
  | "cv_fields"
  | "cv_read"
  | "academy_assessment"
  | "lesson_draft";

export type AiRequest = {
  id: string;
  kind: AiRequestKind;
  module: PortalModule;
  entityType: string | null;
  entityId: string | null;
  context: Record<string, Json>;
  system: string;
  input: AiInputPart[];
  status: AiRequestStatus;
  result: Json | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type NewAiRequest = {
  kind: AiRequestKind;
  module: PortalModule;
  entityType?: string | null;
  entityId?: string | null;
  context?: Record<string, Json>;
  system: string;
  input: string | AiInputPart[];
  /** Who asked; defaults to the signed-in user (auth.uid()). */
  requestedBy?: string | null;
};

const COLUMNS = "id, kind, module, entity_type, entity_id, context, system, input, status, result, error, requested_by, created_at, completed_at" as const;

type Row = {
  id: string;
  kind: string;
  module: PortalModule;
  entity_type: string | null;
  entity_id: string | null;
  context: Json;
  system: string;
  input: Json;
  status: AiRequestStatus;
  result: Json | null;
  error: string | null;
  requested_by: string | null;
  created_at: string;
  completed_at: string | null;
};

function parts(input: Json): AiInputPart[] {
  if (typeof input === "string") return [{ type: "text", text: input }];
  if (!Array.isArray(input)) return [];
  return input.flatMap((p): AiInputPart[] => {
    if (!p || typeof p !== "object" || Array.isArray(p)) return [];
    if (p.type === "text" && typeof p.text === "string") return [{ type: "text", text: p.text }];
    if (p.type === "file" && typeof p.path === "string") {
      return [{ type: "file", path: p.path, mime: typeof p.mime === "string" ? p.mime : "application/pdf", ...(typeof p.title === "string" ? { title: p.title } : {}) }];
    }
    return [];
  });
}

export function toAiRequest(row: Row): AiRequest {
  return {
    id: row.id,
    kind: row.kind as AiRequestKind,
    module: row.module,
    entityType: row.entity_type,
    entityId: row.entity_id,
    context: row.context && typeof row.context === "object" && !Array.isArray(row.context) ? (row.context as Record<string, Json>) : {},
    system: row.system,
    input: parts(row.input),
    status: row.status,
    result: row.result,
    error: row.error,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/**
 * Store a request for Claude. A record has at most one open request per
 * kind: asking again refreshes the instructions and input of that one.
 */
export async function requestAi(db: Db, request: NewAiRequest): Promise<string> {
  const input = (typeof request.input === "string" ? [{ type: "text", text: request.input }] : request.input) as unknown as Json;
  const fields = {
    kind: request.kind,
    module: request.module,
    entity_type: request.entityType ?? null,
    entity_id: request.entityId ?? null,
    context: (request.context ?? {}) as Json,
    system: request.system,
    input,
    ...(request.requestedBy !== undefined ? { requested_by: request.requestedBy } : {}),
  };
  if (request.entityId) {
    const { data: open } = await db
      .from("ai_requests")
      .select("id")
      .eq("kind", request.kind)
      .eq("entity_id", request.entityId)
      .eq("status", "pending")
      .maybeSingle();
    if (open) {
      const { error } = await db.from("ai_requests").update(fields).eq("id", open.id);
      if (error) throw new Error(`Could not refresh the request for Claude: ${error.message}`);
      return open.id;
    }
  }
  const { data, error } = await db.from("ai_requests").insert(fields).select("id").single();
  if (error || !data) throw new Error(`Could not queue the request for Claude: ${error?.message ?? "unknown error"}`);
  return data.id;
}

/** The newest request of a kind for a record, or null. */
export async function latestAiRequest(db: Db, kind: AiRequestKind, entityId: string): Promise<AiRequest | null> {
  const { data } = await db
    .from("ai_requests")
    .select(COLUMNS)
    .eq("kind", kind)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toAiRequest(data as Row) : null;
}

/** Recent requests of one kind, newest first (for kinds without a record, such as talent pool questions). */
export async function recentAiRequests(db: Db, kind: AiRequestKind, limit = 10): Promise<AiRequest[]> {
  const { data } = await db.from("ai_requests").select(COLUMNS).eq("kind", kind).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => toAiRequest(r as Row));
}

/** Pending requests, oldest first, of the given modules (and optionally kinds). */
export async function pendingAiRequests(db: Db, { modules, kinds, limit = 10 }: { modules: PortalModule[]; kinds?: AiRequestKind[]; limit?: number }) {
  if (modules.length === 0) return { requests: [] as AiRequest[], total: 0 };
  let q = db
    .from("ai_requests")
    .select(COLUMNS, { count: "exact" })
    .eq("status", "pending")
    .in("module", modules)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (kinds && kinds.length > 0) q = q.in("kind", kinds);
  const { data, error, count } = await q;
  if (error) throw new Error(`Could not load the requests: ${error.message}`);
  return { requests: (data ?? []).map((r) => toAiRequest(r as Row)), total: count ?? 0 };
}

export async function getAiRequest(db: Db, id: string): Promise<AiRequest | null> {
  const { data } = await db.from("ai_requests").select(COLUMNS).eq("id", id).maybeSingle();
  return data ? toAiRequest(data as Row) : null;
}

/** Mark done requests of a record as applied, once a person took the result over. */
export async function markAiRequestsApplied(db: Db, kind: AiRequestKind, entityId: string) {
  await db.from("ai_requests").update({ status: "applied" }).eq("kind", kind).eq("entity_id", entityId).eq("status", "done");
}

/** Text of the input parts, with a note for each file. */
export function inputText(input: AiInputPart[]): string {
  return input.map((p) => (p.type === "text" ? p.text : `[File: ${p.title ?? p.path.split("/").pop()}, attached]`)).join("\n\n");
}
