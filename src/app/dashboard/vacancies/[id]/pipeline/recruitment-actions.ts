"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { isUuid } from "@/lib/data/candidates";
import { getApplicationExtras, type ApplicationExtras } from "@/lib/data/recruitment";
import type { TablesInsert, TablesUpdate } from "@/lib/database.types";
import { backgroundCheckStatuses, noteKinds } from "@/lib/labels";
import { bulkMoveSchema, moveArgs, parseScreeningTools, type BulkMoveInput } from "@/lib/recruitment/pipeline";
import { createClient } from "@/lib/supabase/server";
import { sendWspMailAfter } from "@/lib/wsp/after";

function revalidateApplication(row: { vacancy_id: string; candidate_id: string }) {
  revalidatePath(`/dashboard/vacancies/${row.vacancy_id}/pipeline`);
  revalidatePath(`/dashboard/vacancies/${row.vacancy_id}`);
  revalidatePath(`/dashboard/candidates/${row.candidate_id}`);
  revalidatePath("/dashboard/candidates");
}

async function loadApplication(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("applications")
    .select("id, vacancy_id, candidate_id, stage")
    .eq("id", id)
    .maybeSingle();
  return data;
}

const MOVED_LABEL: Record<string, string> = {
  parked: "parked",
  rejected: "rejected",
  resume: "resumed",
};

// ---------------------------------------------------------------------------
// Bulk moves (2.2)
// ---------------------------------------------------------------------------

/**
 * Move many cards of one vacancy at once through public.move_applications():
 * to a stage, parked (reason, look again date), rejected (reason) or back to
 * the stage they left (resume).
 */
export async function bulkMoveApplications(vacancyId: string, input: BulkMoveInput): Promise<ActionState> {
  await requireStaff();
  if (!isUuid(vacancyId)) return { error: "Vacancy not found." };
  const parsed = bulkMoveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "This move is not valid." };

  const supabase = await createClient();
  const args = moveArgs(parsed.data);

  // Every card must be on this board; the database refuses mixing vacancies too.
  const { count, error: countError } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("vacancy_id", vacancyId)
    .in("id", args.p_application_ids);
  if (countError) return { error: GENERIC_ERROR };
  if (count !== args.p_application_ids.length) return { error: "Some candidates are no longer on this board. Refresh the page." };

  const { data: moved, error } = await supabase.rpc("move_applications", args);
  if (error) return { error: "The move failed. Please try again." };
  sendWspMailAfter(); // a stage can be the Working Style Profile trigger

  revalidatePath(`/dashboard/vacancies/${vacancyId}/pipeline`);
  revalidatePath(`/dashboard/vacancies/${vacancyId}`);
  revalidatePath("/dashboard/candidates");
  const verb = MOVED_LABEL[parsed.data.stage] ?? "moved";
  return { ok: true, message: moved === 1 ? `1 candidate ${verb}.` : `${moved} candidates ${verb}.` };
}

// ---------------------------------------------------------------------------
// Assessment (2.12)
// ---------------------------------------------------------------------------

const optionalScore = (max = 100, min = 0) =>
  z.coerce
    .number({ error: `Enter a number from ${min} to ${max}.` })
    .int({ error: "Enter a whole number." })
    .min(min, { error: `At least ${min}.` })
    .max(max, { error: `At most ${max}.` })
    .optional();

const text = (max: number) => z.string().max(max, { error: "This text is too long." }).optional();

const sectionSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("video"), video_score: optionalScore(), video_notes: text(5000) }),
  z.object({
    section: z.literal("screening"),
    screening_tools: z.string().max(20000).optional(),
    screening_communication_score: optionalScore(),
    screening_notes: text(5000),
  }),
  z.object({
    section: z.literal("interview"),
    interview_rating: optionalScore(5, 1),
    interview_communication_feedback: text(5000),
    interview_linkedin_feedback: text(5000),
    interviewer: z.string().max(200).optional(),
    interviewer_name: text(200),
    interviewed_on: z.iso.date({ error: "Choose a valid date." }).optional(),
  }),
  z.object({
    section: z.literal("test"),
    test_score: optionalScore(),
    test_notes: text(5000),
    test_url: z
      .url({ protocol: /^https?$/, error: "Enter a full link that starts with https://." })
      .max(2000)
      .optional(),
  }),
]);

/** One section of the assessment in the card modal: video, screening call, interview or test. */
export async function saveAssessment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireStaff();
  const values = formValues(formData);
  const id = values.id;
  if (!isUuid(id)) return { error: "Application not found." };

  const parsed = sectionSchema.safeParse(values);
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const application = await loadApplication(id);
  if (!application) return { error: "This candidate is no longer in the pipeline." };

  const supabase = await createClient();
  const now = new Date().toISOString();
  const input = parsed.data;
  const assessment: TablesInsert<"application_assessments"> = { application_id: id, updated_by: user.id };

  if (input.section === "video") {
    const { error } = await supabase
      .from("applications")
      .update({ video_score: input.video_score ?? null, video_notes: input.video_notes ?? null })
      .eq("id", id);
    if (error) return { error: GENERIC_ERROR };
    assessment.video_reviewed_by = user.id;
    assessment.video_reviewed_at = now;
  } else if (input.section === "screening") {
    const tools = parseScreeningTools(input.screening_tools ?? "");
    if (!tools.ok) return { error: tools.error, fieldErrors: { screening_tools: tools.error } };
    assessment.screening_tools = tools.tools;
    assessment.screening_communication_score = input.screening_communication_score ?? null;
    assessment.screening_notes = input.screening_notes ?? null;
    assessment.screened_by = user.id;
    assessment.screened_at = now;
  } else if (input.section === "interview") {
    // A team member from the list, or someone outside the team by name.
    const interviewerId = isUuid(input.interviewer) ? input.interviewer : null;
    assessment.interview_rating = input.interview_rating ?? null;
    assessment.interview_communication_feedback = input.interview_communication_feedback ?? null;
    assessment.interview_linkedin_feedback = input.interview_linkedin_feedback ?? null;
    assessment.interviewer_id = interviewerId;
    assessment.interviewer_name = interviewerId ? null : (input.interviewer_name ?? null);
    assessment.interviewed_at = input.interviewed_on ? new Date(`${input.interviewed_on}T12:00:00Z`).toISOString() : now;
  } else {
    assessment.test_score = input.test_score ?? null;
    assessment.test_notes = input.test_notes ?? null;
    assessment.test_url = input.test_url ?? null;
    assessment.test_completed_at = input.test_score !== undefined ? now : null;
  }

  const { error } = await supabase.from("application_assessments").upsert(assessment, { onConflict: "application_id" });
  if (error) return { error: GENERIC_ERROR };

  revalidateApplication(application);
  return { ok: true, message: "Saved." };
}

/** Shortlist (2.12): on or off. */
export async function setShortlisted(applicationId: string, shortlisted: boolean): Promise<ActionState> {
  await requireStaff();
  if (!isUuid(applicationId)) return { error: "Application not found." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .update({ shortlisted_at: shortlisted ? new Date().toISOString() : null })
    .eq("id", applicationId)
    .select("vacancy_id, candidate_id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "This candidate is no longer in the pipeline." };
  revalidateApplication(data);
  // Shortlist can be the trigger of the Working Style Profile: send what the database queued.
  if (shortlisted) sendWspMailAfter();
  return { ok: true, message: shortlisted ? "Added to the shortlist." : "Taken off the shortlist." };
}

// ---------------------------------------------------------------------------
// Background check (2.4)
// ---------------------------------------------------------------------------

const backgroundSchema = z.object({
  id: z.string().refine(isUuid, { error: "Application not found." }),
  background_check_status: z.enum(
    backgroundCheckStatuses.map((s) => s.value) as [
      (typeof backgroundCheckStatuses)[number]["value"],
      ...(typeof backgroundCheckStatuses)[number]["value"][],
    ],
  ),
  background_check_notes: text(5000),
});

export async function saveBackgroundCheck(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = backgroundSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const update: TablesUpdate<"applications"> = {
    background_check_status: parsed.data.background_check_status,
    background_check_notes: parsed.data.background_check_notes ?? null,
  };
  const { data, error } = await supabase
    .from("applications")
    .update(update)
    .eq("id", parsed.data.id)
    .select("vacancy_id, candidate_id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "This candidate is no longer in the pipeline." };
  revalidateApplication(data);
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------
// Notes per stage (2.4)
// ---------------------------------------------------------------------------

const noteSchema = z.object({
  entity_type: z.enum(["application", "candidate"]),
  entity_id: z.string().refine(isUuid, { error: "Record not found." }),
  kind: z.enum(noteKinds.map((k) => k.value) as [(typeof noteKinds)[number]["value"], ...(typeof noteKinds)[number]["value"][]]),
  body: z.string({ error: "Write something first." }).trim().min(1, "Write something first.").max(10000, "This note is too long."),
});

/**
 * A note on an application (the database records its current stage) or on
 * the candidate. The candidate page sends "application:<id>" or "candidate"
 * in the about field to choose.
 */
export async function addStageNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const values = formValues(formData);
  const about = values.about;
  if (about?.startsWith("application:")) {
    values.entity_type = "application";
    values.entity_id = about.slice("application:".length);
  }
  const parsed = noteSchema.safeParse(values);
  if (!parsed.success) return { error: "Check your note.", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  let candidateId = parsed.data.entity_id;
  if (parsed.data.entity_type === "application") {
    const application = await loadApplication(parsed.data.entity_id);
    if (!application) return { error: "This candidate is no longer in the pipeline." };
    candidateId = application.candidate_id;
    revalidatePath(`/dashboard/vacancies/${application.vacancy_id}/pipeline`);
  }

  const { error } = await supabase.from("notes").insert({
    entity_type: parsed.data.entity_type,
    entity_id: parsed.data.entity_id,
    kind: parsed.data.kind,
    body: parsed.data.body,
  });
  if (error) return { error: GENERIC_ERROR };
  revalidatePath(`/dashboard/candidates/${candidateId}`);
  return { ok: true, message: "Note added." };
}

/** Notes and files of one card, loaded when its modal opens. */
export async function loadApplicationExtras(applicationId: string): Promise<ApplicationExtras | { error: string }> {
  await requireStaff();
  if (!isUuid(applicationId)) return { error: "Application not found." };
  try {
    return await getApplicationExtras(applicationId);
  } catch {
    return { error: "Notes and files could not be loaded." };
  }
}

// ---------------------------------------------------------------------------
// Files with a kind: background check report, test result
// ---------------------------------------------------------------------------

const fileSchema = z.object({
  applicationId: z.guid(),
  kind: z.enum(["background_check", "test_result"]),
  path: z.string().min(1).max(500),
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().max(200),
});

/**
 * After the browser uploaded the file with a signed upload URL (see
 * createUploadTarget), record it on the application with its kind. The file
 * stays in the private attachments bucket under application/<id>/, which
 * clients can never open.
 */
export async function saveApplicationFile(input: z.input<typeof fileSchema>): Promise<ActionState> {
  await requireStaff();
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  const { applicationId, kind, path, fileName, size, mimeType } = parsed.data;
  if (!path.startsWith(`application/${applicationId}/`) || path.includes("..")) return { error: GENERIC_ERROR };

  const application = await loadApplication(applicationId);
  if (!application) return { error: "This candidate is no longer in the pipeline." };

  const supabase = await createClient();
  const { error } = await supabase.from("attachments").insert({
    entity_type: "application",
    entity_id: applicationId,
    storage_path: path,
    file_name: fileName,
    size_bytes: size,
    mime_type: mimeType || null,
    kind,
  });
  if (error) {
    await supabase.storage.from("attachments").remove([path]);
    return { error: GENERIC_ERROR };
  }
  revalidateApplication(application);
  return { ok: true, message: `${fileName} was added.` };
}

// ---------------------------------------------------------------------------
// Toppers (2.13)
// ---------------------------------------------------------------------------

const topperSchema = z.object({
  candidate_id: z.string().refine(isUuid, { error: "Candidate not found." }),
  is_topper: z.enum(["true", "false"]),
  topper_reason: z.string().trim().max(1000, { error: "Keep it short: at most 1000 characters." }).optional(),
});

/** Mark or unmark a topper. Marking needs a short reason; who and when come from the database. */
export async function setTopper(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = topperSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const isTopper = parsed.data.is_topper === "true";
  if (isTopper && !parsed.data.topper_reason) {
    return { error: "Say in a few words why.", fieldErrors: { topper_reason: "Say in a few words why." } };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("candidates")
    .update({ is_topper: isTopper, topper_reason: isTopper ? parsed.data.topper_reason : null })
    .eq("id", parsed.data.candidate_id)
    .select("id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "Candidate not found." };

  revalidatePath(`/dashboard/candidates/${data.id}`);
  revalidatePath("/dashboard/candidates");
  revalidatePath("/dashboard/vacancies", "layout");
  return { ok: true, message: isTopper ? "Marked as topper." : "Topper mark removed." };
}
