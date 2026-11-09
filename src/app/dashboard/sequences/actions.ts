"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrorsFrom, formValues, GENERIC_ERROR, type ActionState } from "@/lib/action-state";
import { requireModule } from "@/lib/auth";
import { searchCompanyOptions, type CompanyOption } from "@/lib/data/sequences";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.guid();

function pathOf(id: string) {
  return `/dashboard/sequences/${id}`;
}

function done(sequenceId: string, message?: string): ActionState {
  revalidatePath("/dashboard/sequences");
  revalidatePath(pathOf(sequenceId));
  return { ok: true, message };
}

const sequenceSchema = z.object({
  name: z.string({ error: "Enter a name." }).min(1, "Enter a name.").max(200, "Use at most 200 characters."),
  description: z.string().max(5000, "Use at most 5000 characters.").optional(),
});

export async function createSequenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireModule("sales");
  const parsed = sequenceSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sequences")
    .insert({ name: parsed.data.name, description: parsed.data.description ?? null, created_by: user.id })
    .select("id")
    .single();
  if (error) return { error: GENERIC_ERROR };
  revalidatePath("/dashboard/sequences");
  redirect(pathOf(data.id));
}

export async function updateSequenceAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(id).success) return { error: GENERIC_ERROR };
  const parsed = sequenceSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("sequences")
    .update({ name: parsed.data.name, description: parsed.data.description ?? null })
    .eq("id", id);
  if (error) return { error: GENERIC_ERROR };
  return done(id, "Saved.");
}

const statusSchema = z.enum(["draft", "active", "archived"]);

export async function setSequenceStatusAction(id: string, status: string): Promise<ActionState> {
  await requireModule("sales");
  const parsed = statusSchema.safeParse(status);
  if (!idSchema.safeParse(id).success || !parsed.success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  if (parsed.data === "active") {
    const { data: steps } = await supabase.from("sequence_steps").select("id").eq("sequence_id", id).limit(1);
    if (!steps || steps.length === 0) return { error: "Add at least one step before you activate the sequence." };
  }
  const { error } = await supabase.from("sequences").update({ status: parsed.data }).eq("id", id);
  if (error) return { error: GENERIC_ERROR };
  return done(
    id,
    parsed.data === "active" ? "The sequence is active." : parsed.data === "archived" ? "The sequence is archived." : "Back to draft.",
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const stepSchema = z.object({
  channel: z.enum(["mail", "linkedin", "call"], { error: "Choose a channel." }),
  day_offset: z.coerce
    .number({ error: "Enter a day." })
    .int("Use whole days.")
    .min(0, "Day 0 is the start.")
    .max(365, "At most 365 days."),
  subject: z.string().max(500, "Use at most 500 characters.").optional(),
  body: z.string().max(20000, "Use at most 20000 characters.").optional(),
});

export async function addStepAction(sequenceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(sequenceId).success) return { error: GENERIC_ERROR };
  const parsed = stepSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("sequence_steps")
    .select("position")
    .eq("sequence_id", sequenceId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("sequence_steps").insert({
    sequence_id: sequenceId,
    position: (last?.position ?? 0) + 1,
    day_offset: parsed.data.day_offset,
    channel: parsed.data.channel,
    subject: parsed.data.channel === "mail" ? (parsed.data.subject ?? null) : null,
    body: parsed.data.body ?? null,
  });
  if (error) return { error: GENERIC_ERROR };
  return done(sequenceId, "Step added.");
}

/** Saving the text by hand counts as approved by you (the database records it). */
export async function updateStepAction(
  sequenceId: string,
  stepId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(sequenceId).success || !idSchema.safeParse(stepId).success) return { error: GENERIC_ERROR };
  const parsed = stepSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("sequence_steps")
    .update({
      day_offset: parsed.data.day_offset,
      channel: parsed.data.channel,
      subject: parsed.data.channel === "mail" ? (parsed.data.subject ?? null) : null,
      body: parsed.data.body ?? null,
    })
    .eq("id", stepId)
    .eq("sequence_id", sequenceId);
  if (error) return { error: GENERIC_ERROR };
  return done(sequenceId, parsed.data.body ? "Saved and approved by you." : "Saved.");
}

/** Move a step one place up or down by swapping positions. */
export async function moveStepAction(sequenceId: string, stepId: string, direction: "up" | "down"): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(sequenceId).success || !idSchema.safeParse(stepId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: steps, error } = await supabase
    .from("sequence_steps")
    .select("id, position")
    .eq("sequence_id", sequenceId)
    .order("position")
    .order("day_offset");
  if (error) return { error: GENERIC_ERROR };
  const index = steps.findIndex((s) => s.id === stepId);
  const other = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || other < 0 || other >= steps.length) return { ok: true };
  // Renumber 1..n so equal positions cannot get stuck.
  const order = steps.map((s) => s.id);
  [order[index], order[other]] = [order[other], order[index]];
  for (const [i, id] of order.entries()) {
    const { error: moveError } = await supabase.from("sequence_steps").update({ position: i + 1 }).eq("id", id);
    if (moveError) return { error: GENERIC_ERROR };
  }
  return done(sequenceId);
}

export async function deleteStepAction(sequenceId: string, stepId: string): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(sequenceId).success || !idSchema.safeParse(stepId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { count } = await supabase.from("sequence_tasks").select("id", { count: "exact", head: true }).eq("step_id", stepId);
  if ((count ?? 0) > 0) {
    return { error: "This step already has tasks for enrolled companies. Archive the sequence and make a new one instead." };
  }
  const { error } = await supabase.from("sequence_steps").delete().eq("id", stepId).eq("sequence_id", sequenceId);
  if (error) return { error: GENERIC_ERROR };
  return done(sequenceId, "Step removed.");
}

/** The concept becomes the text; the database records you as the approver. */
export async function approveDraftAction(sequenceId: string, stepId: string): Promise<ActionState> {
  const user = await requireModule("sales");
  if (!idSchema.safeParse(sequenceId).success || !idSchema.safeParse(stepId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: step, error } = await supabase
    .from("sequence_steps")
    .select("channel, subject, draft_subject, draft_body")
    .eq("id", stepId)
    .eq("sequence_id", sequenceId)
    .maybeSingle();
  if (error || !step) return { error: GENERIC_ERROR };
  if (!step.draft_body) return { error: "There is no concept to approve." };
  const { error: updateError } = await supabase
    .from("sequence_steps")
    .update({
      subject: step.channel === "mail" ? (step.draft_subject ?? step.subject) : null,
      body: step.draft_body,
      approved_at: new Date().toISOString(),
      approved_by: user.id,
      draft_subject: null,
      draft_body: null,
    })
    .eq("id", stepId);
  if (updateError) return { error: GENERIC_ERROR };
  return done(sequenceId, "Concept approved. This text is used from now on.");
}

export async function rejectDraftAction(sequenceId: string, stepId: string): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(sequenceId).success || !idSchema.safeParse(stepId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("sequence_steps")
    .update({ draft_subject: null, draft_body: null })
    .eq("id", stepId)
    .eq("sequence_id", sequenceId);
  if (error) return { error: GENERIC_ERROR };
  return done(sequenceId, "Concept rejected. The approved text stays as it was.");
}

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

export type StartState = ActionState & { results?: { name: string; error?: string }[] };

const startSchema = z.object({
  company_ids: z.array(z.guid()).min(1, "Pick at least one company.").max(100, "At most 100 companies at once."),
  start: z.iso.date().optional(),
});

export async function startSequenceAction(sequenceId: string, _prev: StartState, formData: FormData): Promise<StartState> {
  await requireModule("sales");
  if (!idSchema.safeParse(sequenceId).success) return { error: GENERIC_ERROR };
  const raw = formValues(formData);
  const parsed = startSchema.safeParse({
    company_ids: [...new Set(formData.getAll("company_ids").filter((v): v is string => typeof v === "string"))],
    start: raw.start,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  const supabase = await createClient();
  const { data: companies } = await supabase.from("companies").select("id, name").in("id", parsed.data.company_ids);
  const names = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const results: { name: string; error?: string }[] = [];
  for (const companyId of parsed.data.company_ids) {
    const { error } = await supabase.rpc("sales_start_sequence", {
      p_sequence: sequenceId,
      p_company: companyId,
      p_start: parsed.data.start ?? null,
    });
    results.push({
      name: names.get(companyId) ?? "Company",
      error: error ? (/duplicate key|active_key/.test(error.message) ? "Already in this sequence." : error.message) : undefined,
    });
  }
  revalidatePath("/dashboard/sequences");
  revalidatePath(pathOf(sequenceId));
  const started = results.filter((r) => !r.error).length;
  if (started === 0) return { error: `Nothing was started. ${results[0]?.error ?? ""}`.trim(), results };
  return {
    ok: true,
    message: `Started for ${started} ${started === 1 ? "company" : "companies"}.${results.length > started ? ` ${results.length - started} skipped.` : ""}`,
    results,
  };
}

const enrollmentStatusSchema = z.enum(["active", "paused", "stopped"]);

export async function setEnrollmentStatusAction(sequenceId: string, enrollmentId: string, status: string): Promise<ActionState> {
  await requireModule("sales");
  const parsed = enrollmentStatusSchema.safeParse(status);
  if (!idSchema.safeParse(sequenceId).success || !idSchema.safeParse(enrollmentId).success || !parsed.success) {
    return { error: GENERIC_ERROR };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("sales_set_enrollment", { p_enrollment: enrollmentId, p_status: parsed.data });
  if (error) return { error: error.message.includes("ended") ? "This enrollment has ended." : GENERIC_ERROR };
  return done(sequenceId, parsed.data === "paused" ? "Paused." : parsed.data === "active" ? "Resumed." : "Stopped.");
}

/** For the company picker. */
export async function searchCompaniesAction(query: string): Promise<CompanyOption[]> {
  await requireModule("sales");
  return searchCompanyOptions(typeof query === "string" ? query : "");
}
