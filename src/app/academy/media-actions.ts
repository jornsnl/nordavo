"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { requireAcademyUser } from "@/lib/academy/auth";
import { rangesPayload } from "@/lib/academy/media/watch";
import { type WorksheetAnswers, missingRequired, normalizeAnswers, normalizeFields } from "@/lib/academy/media/worksheet";
import { createClient } from "@/lib/supabase/server";

// Learner actions of the media area: watch progress, worksheet answers and
// notifications. Each re-checks the user; RLS and the database functions
// check the rest (the lesson must be open, own rows only).

const guid = z.guid();

const watchSchema = z.object({
  videoId: guid,
  versionId: guid.nullable(),
  positionSeconds: z.number().min(0).max(1_000_000),
  percent: z.number().int().min(0).max(100),
  watchedSeconds: z.number().min(0).max(3600),
  ranges: z.array(z.tuple([z.number().min(0), z.number().min(0)])).max(2000),
});

export type RecordWatchResult = { ok: true; percent: number; completed: boolean } | { ok: false };

/** The player reports what was really played (ranges) and where it is. */
export async function recordWatch(input: z.infer<typeof watchSchema>): Promise<RecordWatchResult> {
  const user = await requireAcademyUser();
  const parsed = watchSchema.safeParse(input);
  if (!parsed.success || !user.member) return { ok: false };
  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_record_watch", {
    p_video_id: d.videoId,
    p_version_id: d.versionId,
    p_position_seconds: d.positionSeconds,
    p_percent: d.percent,
    p_watched_seconds: d.watchedSeconds,
    p_ranges: rangesPayload(d.ranges) as unknown as Json,
  });
  if (error) {
    console.error("recordWatch", error.code, error.message);
    return { ok: false };
  }
  const row = (data ?? {}) as { percent?: number; completed_at?: string | null };
  return { ok: true, percent: row.percent ?? 0, completed: Boolean(row.completed_at) };
}

export type WorksheetResult = { ok: true; savedAt: string; submittedAt: string | null } | { ok: false; error: "invalid" | "missing" | "locked" | "failed"; missing?: string[] };

async function worksheetFields(supabase: Awaited<ReturnType<typeof createClient>>, documentId: string) {
  const { data } = await supabase.from("academy_documents").select("worksheet_fields, kind").eq("id", documentId).maybeSingle();
  return data?.kind === "worksheet" ? normalizeFields(data.worksheet_fields) : null;
}

/** Autosave (submit false) or submit (submit true) of own worksheet answers. */
export async function saveWorksheet(input: { documentId: string; answers: WorksheetAnswers; submit: boolean }): Promise<WorksheetResult> {
  const user = await requireAcademyUser();
  if (!guid.safeParse(input.documentId).success || typeof input.submit !== "boolean" || !user.member) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const fields = await worksheetFields(supabase, input.documentId);
  if (!fields) return { ok: false, error: "invalid" };
  const answers = normalizeAnswers(fields, input.answers);
  if (input.submit) {
    const missing = missingRequired(fields, answers);
    if (missing.length > 0) return { ok: false, error: "missing", missing: missing.map((f) => f.label) };
  }

  const { data: existing } = await supabase
    .from("academy_worksheet_answers")
    .select("id, submitted_at")
    .eq("document_id", input.documentId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (existing?.submitted_at) return { ok: false, error: "locked" };

  const values = { answers: answers as unknown as Json, submitted_at: input.submit ? new Date().toISOString() : null };
  const { data, error } = existing
    ? await supabase.from("academy_worksheet_answers").update(values).eq("id", existing.id).select("updated_at, submitted_at").single()
    : await supabase
        .from("academy_worksheet_answers")
        .insert({ document_id: input.documentId, profile_id: user.id, ...values })
        .select("updated_at, submitted_at")
        .single();
  if (error || !data) {
    console.error("saveWorksheet", error?.code, error?.message);
    if (error?.code === "23514") return { ok: false, error: "missing" };
    if (error?.code === "42501") return { ok: false, error: "locked" };
    return { ok: false, error: "failed" };
  }
  if (input.submit) revalidatePath("/academy", "layout");
  return { ok: true, savedAt: data.updated_at, submittedAt: data.submitted_at };
}

/** Mark one notification (or all, with id null) as read. */
export async function markNotificationsRead(id: string | null): Promise<{ ok: boolean }> {
  const user = await requireAcademyUser();
  if (id !== null && !guid.safeParse(id).success) return { ok: false };
  const supabase = await createClient();
  let query = supabase.from("academy_notifications").update({ read_at: new Date().toISOString() }).eq("profile_id", user.id).is("read_at", null);
  if (id) query = query.eq("id", id);
  const { error } = await query;
  if (error) {
    console.error("markNotificationsRead", error.code, error.message);
    return { ok: false };
  }
  revalidatePath("/academy", "layout");
  return { ok: true };
}
