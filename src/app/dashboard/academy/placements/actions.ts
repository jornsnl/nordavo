"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireAcademyManager } from "@/lib/academy/auth";
import { isAcademyTimeZone } from "@/lib/academy/time";
import { ATTACHMENTS_BUCKET, MAX_UPLOAD_BYTES } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

// Nordavo side of the placement page, rituals, pulse and holidays: the
// Academy tab of /dashboard/placements/[id], /dashboard/academy/placements,
// /dashboard/academy/rituals and /dashboard/academy/holidays. Managers only
// (requireAcademyManager, and RLS through academy_is_manager()). Placement
// facts are on the placements table, which needs module recruitment as well.

const guid = z.guid();
const dateIso = z.iso.date();

function log(where: string, error: { code?: string; message: string } | null) {
  if (error) console.error(`academy placement ${where}`, error.code, error.message);
}

function refresh(placementId?: string) {
  if (placementId) {
    revalidatePath(`/dashboard/placements/${placementId}`);
    revalidatePath(`/academy/placements/${placementId}`);
  }
  revalidatePath("/dashboard/academy", "layout");
  revalidatePath("/academy");
}

const ok = (message?: string): ActionState => ({ ok: true, message });

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const memberSchema = z.object({
  profile_id: z.guid({ error: "Choose a person" }),
  role: z.enum(["client_admin", "client_member", "client_reader", "developer"], { error: "Choose a role" }),
});

export async function addPlacementMember(placementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success) return { error: GENERIC_ERROR };
  const parsed = memberSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_placement_members").insert({ placement_id: placementId, ...parsed.data });
  log("addPlacementMember", error);
  if (error) {
    if (error.code === "23505") return { error: "This person is already in the placement, or the placement already has a developer." };
    if (error.code === "23514") return { error: "Client contacts must be client users of this client; the developer must be an Academy developer." };
    return { error: GENERIC_ERROR };
  }
  refresh(placementId);
  return ok("Added. Their rituals came along.");
}

export async function updatePlacementMemberRole(placementId: string, profileId: string, role: string): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = memberSchema.safeParse({ profile_id: profileId, role });
  if (!guid.safeParse(placementId).success || !parsed.success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_placement_members")
    .update({ role: parsed.data.role })
    .eq("placement_id", placementId)
    .eq("profile_id", profileId);
  log("updatePlacementMemberRole", error);
  if (error) return { error: error.code === "23514" ? "That role does not fit this person." : GENERIC_ERROR };
  refresh(placementId);
  return ok();
}

export async function removePlacementMember(placementId: string, profileId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success || !guid.safeParse(profileId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_placement_members").delete().eq("placement_id", placementId).eq("profile_id", profileId);
  log("removePlacementMember", error);
  if (error) return { error: GENERIC_ERROR };
  refresh(placementId);
  return ok();
}

/**
 * The ATS candidate of the placement is still an Academy candidate: make
 * them a developer with the whole developer course (progress stays) and add
 * them as the developer of the placement.
 */
export async function makeDeveloperAndAdd(placementId: string, profileId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success || !guid.safeParse(profileId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const [{ data: course }, { data: placement }] = await Promise.all([
    supabase.from("academy_courses").select("id").eq("slug", "developer").maybeSingle(),
    supabase.from("placements").select("start_date").eq("id", placementId).maybeSingle(),
  ]);
  const { error: addError } = await supabase.rpc("academy_add_person", {
    p_profile_id: profileId,
    p_academy_role: "developer",
    p_course_id: course?.id ?? null,
    p_scope: "all",
    p_start_date: placement?.start_date ?? null,
  });
  log("makeDeveloperAndAdd", addError);
  if (addError) return { error: addError.message.includes("client") ? addError.message : GENERIC_ERROR };
  const { error } = await supabase.from("academy_placement_members").insert({ placement_id: placementId, profile_id: profileId, role: "developer" });
  log("makeDeveloperAndAdd member", error);
  if (error) return { error: error.code === "23505" ? "This placement already has a developer." : GENERIC_ERROR };
  refresh(placementId);
  return ok("Now a developer with the whole developer course, and added to the placement.");
}

// ---------------------------------------------------------------------------
// Facts: hours, overlap window, probation, Nordavo contact, response time
// ---------------------------------------------------------------------------

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Use HH:MM" });

const factsSchema = z
  .object({
    hours_per_week: z.coerce.number({ error: "Enter a number" }).min(0).max(80).optional(),
    overlap_start: time.optional(),
    overlap_end: time.optional(),
    overlap_time_zone: z.string().refine(isAcademyTimeZone, { error: "Choose a time zone" }),
    probation_end_date: dateIso.optional(),
    nordavo_contact_id: z.guid().optional(),
    nordavo_response_hours: z.coerce.number({ error: "Enter a number of hours" }).int().min(1).max(168),
  })
  .refine((v) => (v.overlap_start === undefined) === (v.overlap_end === undefined), {
    error: "Enter both the start and the end of the overlap window",
    path: ["overlap_end"],
  })
  .refine((v) => !v.overlap_start || !v.overlap_end || v.overlap_end > v.overlap_start, {
    error: "The end is before the start",
    path: ["overlap_end"],
  });

export async function saveAcademyFacts(placementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success) return { error: GENERIC_ERROR };
  const parsed = factsSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("placements")
    .update({
      hours_per_week: v.hours_per_week ?? null,
      overlap_start: v.overlap_start ?? null,
      overlap_end: v.overlap_end ?? null,
      overlap_time_zone: v.overlap_time_zone,
      probation_end_date: v.probation_end_date ?? null,
      nordavo_contact_id: v.nordavo_contact_id ?? null,
      nordavo_response_hours: v.nordavo_response_hours,
    })
    .eq("id", placementId)
    .select("id");
  log("saveAcademyFacts", error);
  if (error) return { error: GENERIC_ERROR };
  if (!data?.length) return { error: "Not saved: changing the placement needs the recruitment module as well." };
  refresh(placementId);
  return ok("Saved.");
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export async function decideLeave(placementId: string, requestId: string, status: string, note: string): Promise<ActionState> {
  await requireAcademyManager();
  const parsedStatus = z.enum(["requested", "client_agreed", "approved", "rejected"]).safeParse(status);
  if (!guid.safeParse(placementId).success || !guid.safeParse(requestId).success || !parsedStatus.success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_leave_requests")
    .update({ status: parsedStatus.data, decision_note: note.trim().slice(0, 2000) || null })
    .eq("id", requestId)
    .eq("placement_id", placementId);
  log("decideLeave", error);
  if (error) return { error: GENERIC_ERROR };
  refresh(placementId);
  return ok();
}

const balanceSchema = z.object({
  profile_id: z.guid({ error: "Add the developer to the placement first" }),
  year: z.coerce.number().int().min(2020).max(2100),
  entitled_days: z.coerce.number({ error: "Enter a number" }).min(0).max(366),
  carried_over_days: z.coerce.number({ error: "Enter a number" }).min(-366).max(366).default(0),
  adjustment_days: z.coerce.number({ error: "Enter a number" }).min(-366).max(366).default(0),
});

/** Nordavo sets the balance of a year. */
export async function saveLeaveBalance(placementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success) return { error: GENERIC_ERROR };
  const parsed = balanceSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_leave_balances")
    .upsert({ placement_id: placementId, ...parsed.data }, { onConflict: "placement_id,profile_id,year" });
  log("saveLeaveBalance", error);
  if (error) return { error: GENERIC_ERROR };
  refresh(placementId);
  return ok("Balance saved.");
}

// ---------------------------------------------------------------------------
// Timeline and reports
// ---------------------------------------------------------------------------

export async function moveMilestone(placementId: string, milestoneId: string, dueDate: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success || !guid.safeParse(milestoneId).success || !dateIso.safeParse(dueDate).success) {
    return { error: GENERIC_ERROR };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("academy_milestones").update({ due_date: dueDate, notified_at: null }).eq("id", milestoneId);
  log("moveMilestone", error);
  if (error) return { error: GENERIC_ERROR };
  refresh(placementId);
  return ok();
}

/** Nordavo's report of a moment: draft, or published (the moment is done and everyone is told). */
export async function saveReport(placementId: string, milestoneId: string, report: string, publish: boolean): Promise<ActionState> {
  const user = await requireAcademyManager();
  if (!guid.safeParse(placementId).success || !guid.safeParse(milestoneId).success) return { error: GENERIC_ERROR };
  const text = report.trim().slice(0, 20_000);
  if (publish && !text) return { error: "Write the report first." };
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("academy_reviews")
    .select("id")
    .eq("milestone_id", milestoneId)
    .eq("kind", "report")
    .maybeSingle();
  const values = { report: text || null, status: publish ? ("submitted" as const) : ("draft" as const) };
  const { error } = existing
    ? await supabase.from("academy_reviews").update(values).eq("id", existing.id)
    : await supabase
        .from("academy_reviews")
        .insert({ ...values, kind: "report", milestone_id: milestoneId, placement_id: placementId, author_id: user.id });
  log("saveReport", error);
  if (error) return { error: GENERIC_ERROR };
  if (!publish) {
    // Taking a report back opens the moment again.
    await supabase.from("academy_milestones").update({ completed_at: null }).eq("id", milestoneId);
  }
  refresh(placementId);
  return ok(publish ? "Report published." : "Draft saved.");
}

// ---------------------------------------------------------------------------
// Documents (versioned, label "new" for two weeks)
// ---------------------------------------------------------------------------

const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "image/png",
  "image/jpeg",
]);

const NEW_FOR_DAYS = 14;

const documentSchema = z.object({
  title: z.string({ error: "Enter a title" }).min(1, { error: "Enter a title" }).max(300),
  description: z.string().max(5000).optional(),
  category: z.enum(["contract_summary", "gdpr", "policy", "escalation_matrix", "decision_matrix", "blocker_agreement"], {
    error: "Choose a kind",
  }),
  scope: z.enum(["placement", "global"]),
  document_id: z.guid().optional(),
  notes: z.string().max(2000).optional(),
});

function safeFileName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").slice(-120) || "file";
}

/**
 * Upload a placement document, or a new version of one (document_id). Global
 * documents in these categories show on every placement page. The file goes
 * to academy/document/<id>/ in the attachments bucket.
 */
export async function uploadPlacementDocument(placementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success) return { error: GENERIC_ERROR };
  const file = formData.get("file");
  const parsed = documentSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file.", fieldErrors: { file: "Choose a file" } };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "The file can be at most 20 MB.", fieldErrors: { file: "At most 20 MB" } };
  if (file.type && !DOCUMENT_TYPES.has(file.type)) return { error: "Upload a PDF, Word, Excel, PowerPoint, text or image file." };
  const v = parsed.data;
  const supabase = await createClient();

  let documentId = v.document_id ?? null;
  let version = 1;
  if (documentId) {
    const { data: existing } = await supabase.from("academy_documents").select("current_version").eq("id", documentId).maybeSingle();
    if (!existing) return { error: GENERIC_ERROR };
    const { data: last } = await supabase
      .from("academy_document_versions")
      .select("version")
      .eq("document_id", documentId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    version = Math.max(existing.current_version, last?.version ?? 0) + 1;
  } else {
    const { data: created, error } = await supabase
      .from("academy_documents")
      .insert({
        title: v.title,
        description: v.description ?? null,
        kind: "download",
        scope: v.scope,
        placement_id: v.scope === "placement" ? placementId : null,
        category: v.category,
        current_version: 0,
      })
      .select("id")
      .single();
    log("uploadPlacementDocument create", error);
    if (error || !created) return { error: GENERIC_ERROR };
    documentId = created.id;
  }

  const path = `academy/document/${documentId}/v${version}-${crypto.randomUUID().slice(0, 8)}-${safeFileName(file.name)}`;
  const upload = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upload.error) {
    log("uploadPlacementDocument upload", upload.error);
    if (!v.document_id) await supabase.from("academy_documents").delete().eq("id", documentId);
    return { error: "The upload failed. Please try again." };
  }
  const { error: versionError } = await supabase.from("academy_document_versions").insert({
    document_id: documentId,
    version,
    storage_path: path,
    file_name: file.name.slice(0, 300),
    mime_type: file.type || null,
    size_bytes: file.size,
    notes: v.notes ?? null,
  });
  const { error: updateError } = versionError
    ? { error: versionError }
    : await supabase
        .from("academy_documents")
        .update({
          current_version: version,
          new_until: new Date(Date.now() + NEW_FOR_DAYS * 86_400_000).toISOString(),
          ...(v.document_id ? {} : { title: v.title }),
        })
        .eq("id", documentId);
  if (versionError || updateError) {
    log("uploadPlacementDocument version", versionError ?? updateError);
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    if (!v.document_id) await supabase.from("academy_documents").delete().eq("id", documentId);
    return { error: GENERIC_ERROR };
  }
  refresh(placementId);
  return ok(v.document_id ? `Version ${version} uploaded, labelled "new" for ${NEW_FOR_DAYS} days.` : "Document uploaded.");
}

export async function deletePlacementDocument(placementId: string, documentId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success || !guid.safeParse(documentId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: versions } = await supabase.from("academy_document_versions").select("storage_path").eq("document_id", documentId);
  const { error } = await supabase.from("academy_documents").delete().eq("id", documentId);
  log("deletePlacementDocument", error);
  if (error) return { error: GENERIC_ERROR };
  const paths = (versions ?? []).map((v) => v.storage_path);
  if (paths.length) await supabase.storage.from(ATTACHMENTS_BUCKET).remove(paths);
  refresh(placementId);
  return ok();
}

// ---------------------------------------------------------------------------
// Calendar link
// ---------------------------------------------------------------------------

export async function rotateCalendarLink(placementId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("academy_rotate_calendar_token", { p_placement_id: placementId });
  log("rotateCalendarLink", error);
  if (error) return { error: GENERIC_ERROR };
  refresh(placementId);
  return ok("New link made. The old link no longer works; the members see the new one on the placement page.");
}

// ---------------------------------------------------------------------------
// Rituals: per placement and per course
// ---------------------------------------------------------------------------

const ritualSchema = z
  .object({
    title: z.string({ error: "Enter a title" }).min(1, { error: "Enter a title" }).max(200),
    description: z.string().max(2000).optional(),
    cadence: z.enum(["daily", "weekly", "monthly"]),
    weekday: z.coerce.number().int().min(1).max(7).optional(),
    audience: z.enum(["client", "developer", "both", "nordavo"]),
    active: z.boolean(),
  })
  .transform((v) => ({ ...v, weekday: v.cadence === "weekly" ? (v.weekday ?? 1) : null, description: v.description ?? null }));

function ritualValues(formData: FormData) {
  return ritualSchema.safeParse({ ...formValues(formData), active: formData.get("active") === "on" || formData.get("active") === "true" });
}

/** Add or change a ritual of one placement (a changed copy no longer follows its course ritual). */
export async function savePlacementRitual(placementId: string, ritualId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success || (ritualId && !guid.safeParse(ritualId).success)) return { error: GENERIC_ERROR };
  const parsed = ritualValues(formData);
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  if (ritualId) {
    const { error } = await supabase.from("academy_rituals").update(parsed.data).eq("id", ritualId).eq("placement_id", placementId);
    log("savePlacementRitual", error);
    if (error) return { error: GENERIC_ERROR };
  } else {
    const { data: last } = await supabase
      .from("academy_rituals")
      .select("position")
      .eq("placement_id", placementId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase
      .from("academy_rituals")
      .insert({ ...parsed.data, placement_id: placementId, position: (last?.position ?? 0) + 1 });
    log("savePlacementRitual insert", error);
    if (error) return { error: GENERIC_ERROR };
  }
  refresh(placementId);
  return ok("Saved.");
}

/** A changed copy follows its course ritual again. */
export async function resetPlacementRitual(placementId: string, ritualId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success || !guid.safeParse(ritualId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_rituals").update({ customized: false }).eq("id", ritualId).eq("placement_id", placementId);
  log("resetPlacementRitual", error);
  if (error) return { error: GENERIC_ERROR };
  refresh(placementId);
  return ok();
}

/** Remove an own ritual of a placement; a copy of a course ritual is switched off instead (its history stays). */
export async function removePlacementRitual(placementId: string, ritualId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(placementId).success || !guid.safeParse(ritualId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: ritual } = await supabase.from("academy_rituals").select("template_id").eq("id", ritualId).maybeSingle();
  const { error } = ritual?.template_id
    ? await supabase.from("academy_rituals").update({ active: false }).eq("id", ritualId)
    : await supabase.from("academy_rituals").delete().eq("id", ritualId).eq("placement_id", placementId);
  log("removePlacementRitual", error);
  if (error) return { error: GENERIC_ERROR };
  refresh(placementId);
  return ok();
}

/** Course ritual (template): every placement whose members follow the course gets it. */
export async function saveRitualTemplate(ritualId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  if (ritualId && !guid.safeParse(ritualId).success) return { error: GENERIC_ERROR };
  const parsed = ritualValues(formData);
  const course = guid.safeParse(formData.get("course_id"));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  if (ritualId) {
    const { error } = await supabase.from("academy_rituals").update(parsed.data).eq("id", ritualId).is("placement_id", null);
    log("saveRitualTemplate", error);
    if (error) return { error: GENERIC_ERROR };
  } else {
    if (!course.success) return { error: "Choose a course.", fieldErrors: { course_id: "Choose a course" } };
    const { data: last } = await supabase
      .from("academy_rituals")
      .select("position")
      .eq("course_id", course.data)
      .is("placement_id", null)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase
      .from("academy_rituals")
      .insert({ ...parsed.data, course_id: course.data, position: (last?.position ?? 0) + 1 });
    log("saveRitualTemplate insert", error);
    if (error) return { error: GENERIC_ERROR };
  }
  refresh();
  return ok("Saved. Placements that did not adjust this ritual follow.");
}

export async function deleteRitualTemplate(ritualId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(ritualId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_rituals").delete().eq("id", ritualId).is("placement_id", null);
  log("deleteRitualTemplate", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return ok();
}

// ---------------------------------------------------------------------------
// Pulse
// ---------------------------------------------------------------------------

/** Nordavo followed up on a low or dropping score. */
export async function handlePulseSignal(pulseId: string, note: string): Promise<ActionState> {
  const user = await requireAcademyManager();
  if (!guid.safeParse(pulseId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: pulse } = await supabase.from("academy_pulses").select("placement_id").eq("id", pulseId).maybeSingle();
  const { error } = await supabase
    .from("academy_pulse_answers")
    .update({ handled_at: new Date().toISOString(), handled_by: user.id, handled_note: note.trim().slice(0, 2000) || null })
    .eq("pulse_id", pulseId);
  log("handlePulseSignal", error);
  if (error) return { error: GENERIC_ERROR };
  refresh(pulse?.placement_id);
  return ok();
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

const holidaySchema = z.object({
  country: z.enum(["NL", "IN"]),
  date: dateIso,
  name_nl: z.string({ error: "Enter the Dutch name" }).min(1, { error: "Enter the Dutch name" }).max(200),
  name_en: z.string({ error: "Enter the English name" }).min(1, { error: "Enter the English name" }).max(200),
  day_off: z.boolean(),
  confirmed: z.boolean(),
});

export async function saveHoliday(holidayId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  if (holidayId && !guid.safeParse(holidayId).success) return { error: GENERIC_ERROR };
  const parsed = holidaySchema.safeParse({
    ...formValues(formData),
    day_off: formData.get("day_off") === "on",
    confirmed: formData.get("confirmed") === "on",
  });
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const v = parsed.data;
  const row = { ...v, region: v.country === "IN" ? "KA" : null, year: Number(v.date.slice(0, 4)) };
  const supabase = await createClient();
  const { error } = holidayId
    ? await supabase.from("academy_holidays").update(row).eq("id", holidayId)
    : await supabase.from("academy_holidays").insert(row);
  log("saveHoliday", error);
  if (error) return { error: error.code === "23505" ? "This holiday is already on the list." : GENERIC_ERROR };
  refresh();
  return ok("Saved.");
}

export async function confirmHoliday(holidayId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(holidayId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_holidays").update({ confirmed: true }).eq("id", holidayId);
  log("confirmHoliday", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return ok();
}

export async function deleteHoliday(holidayId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(holidayId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_holidays").delete().eq("id", holidayId);
  log("deleteHoliday", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return ok();
}

/** The holidays that follow a rule (Dutch, and Indian on a fixed date) for a year. */
export async function seedHolidayYear(year: number): Promise<ActionState> {
  await requireAcademyManager();
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_seed_holidays", { p_year: year });
  log("seedHolidayYear", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return ok(`${data ?? 0} holidays added for ${year}. Add the Karnataka festival days of the state list by hand.`);
}
