"use server";

import { randomBytes } from "node:crypto";
import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { blocksSchema, formMetaSchema, readBlocks } from "@/lib/forms/schema";
import { cloneBlocks, freelanceTemplate, fulltimeTemplate } from "@/lib/forms/templates";
import { ATTACHMENTS_BUCKET, buildStoragePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

const uuid = z.guid();

function revalidateForm(vacancyId: string) {
  revalidatePath(`/dashboard/vacancies/${vacancyId}/form`);
  revalidatePath(`/dashboard/vacancies/${vacancyId}`);
}

/** Start a form from a template or by copying the form of another vacancy. */
export async function createFormAction(
  vacancyId: string,
  source: { template: "fulltime" | "freelance" } | { copyFrom: string },
): Promise<ActionState> {
  const user = await requireStaff();
  if (!uuid.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();

  const { data: vacancy } = await supabase.from("vacancies").select("title").eq("id", vacancyId).maybeSingle();
  if (!vacancy) return { error: "This vacancy no longer exists." };

  let row: { title: string; intro: string | null; role_type: "fulltime" | "freelance"; blocks: unknown; max_reminders?: number; reminder_interval_days?: number };
  if ("copyFrom" in source) {
    if (!uuid.safeParse(source.copyFrom).success) return { error: GENERIC_ERROR };
    const { data: other } = await supabase
      .from("recruitment_forms")
      .select("title, intro, role_type, blocks, max_reminders, reminder_interval_days, vacancy:vacancies(title)")
      .eq("vacancy_id", source.copyFrom)
      .maybeSingle();
    if (!other) return { error: "That form no longer exists." };
    const otherTitle = other.vacancy?.title;
    row = {
      title: otherTitle && other.title.includes(otherTitle) ? other.title.replace(otherTitle, vacancy.title) : other.title,
      intro: other.intro,
      role_type: other.role_type,
      // New ids: answers of two vacancies never share keys.
      blocks: cloneBlocks(readBlocks(other.blocks)),
      max_reminders: other.max_reminders,
      reminder_interval_days: other.reminder_interval_days,
    };
  } else {
    const t = source.template === "freelance" ? freelanceTemplate(vacancy.title) : fulltimeTemplate(vacancy.title);
    row = { title: t.title.slice(0, 200), intro: t.intro, role_type: t.roleType, blocks: t.blocks };
  }

  const { error } = await supabase.from("recruitment_forms").insert({
    vacancy_id: vacancyId,
    title: row.title.slice(0, 200),
    intro: row.intro,
    role_type: row.role_type,
    blocks: row.blocks as never,
    max_reminders: row.max_reminders,
    reminder_interval_days: row.reminder_interval_days,
    created_by: user.id,
    updated_by: user.id,
  });
  if (error) {
    if (error.code === "23505") return { error: "This vacancy already has a form." };
    return { error: GENERIC_ERROR };
  }
  revalidateForm(vacancyId);
  refresh();
  return { ok: true, message: "Form created. Edit it and publish when it is ready." };
}

const draftSchema = formMetaSchema.extend({ blocks: blocksSchema });

export type DraftInput = z.input<typeof draftSchema>;

/** Save the draft. The live form only changes on publish. */
export async function saveFormDraft(formId: string, input: DraftInput): Promise<ActionState> {
  const user = await requireStaff();
  if (!uuid.safeParse(formId).success) return { error: GENERIC_ERROR };
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recruitment_forms")
    .update({
      title: parsed.data.title,
      intro: parsed.data.intro || null,
      role_type: parsed.data.roleType,
      max_reminders: parsed.data.maxReminders,
      reminder_interval_days: parsed.data.reminderIntervalDays,
      blocks: parsed.data.blocks as never,
      updated_by: user.id,
    })
    .eq("id", formId)
    .select("vacancy_id")
    .maybeSingle();
  if (error || !data) return { error: GENERIC_ERROR };
  revalidateForm(data.vacancy_id);
  return { ok: true, message: "Draft saved." };
}

export async function publishForm(formId: string): Promise<ActionState> {
  await requireStaff();
  if (!uuid.safeParse(formId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc("publish_recruitment_form", { p_form_id: formId });
  if (error) return { error: error.message.includes("at least one") ? "Add at least one question before publishing." : GENERIC_ERROR };
  const { data } = await supabase.from("recruitment_forms").select("vacancy_id").eq("id", formId).maybeSingle();
  if (data) revalidateForm(data.vacancy_id);
  refresh();
  return { ok: true, message: `Published as version ${version}. The links now show this version.` };
}

/** Close the form: links show "closed", nothing is deleted. */
export async function closeForm(formId: string): Promise<ActionState> {
  await requireStaff();
  if (!uuid.safeParse(formId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recruitment_forms")
    .update({ status: "draft" })
    .eq("id", formId)
    .select("vacancy_id")
    .maybeSingle();
  if (error || !data) return { error: GENERIC_ERROR };
  revalidateForm(data.vacancy_id);
  refresh();
  return { ok: true, message: "The form is closed. Publish again to reopen it." };
}

/** New token for the general or headhunted link, for a link that went too far. */
export async function rotateFormLink(formId: string, kind: "public" | "headhunted"): Promise<ActionState> {
  await requireStaff();
  if (!uuid.safeParse(formId).success || !["public", "headhunted"].includes(kind)) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const token = randomBytes(32).toString("hex");
  const { data, error } = await supabase
    .from("recruitment_forms")
    .update(kind === "public" ? { public_token: token } : { headhunted_token: token })
    .eq("id", formId)
    .select("vacancy_id")
    .maybeSingle();
  if (error || !data) return { error: GENERIC_ERROR };
  revalidateForm(data.vacancy_id);
  refresh();
  return { ok: true, message: "New link made. The old link no longer works." };
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Header image or logo, stored privately; the public form gets signed URLs. */
export async function uploadFormImage(formId: string, kind: "header" | "logo", formData: FormData): Promise<ActionState> {
  await requireStaff();
  if (!uuid.safeParse(formId).success || !["header", "logo"].includes(kind)) return { error: GENERIC_ERROR };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image first." };
  if (!IMAGE_TYPES.includes(file.type)) return { error: "Use a PNG, JPG or WebP image." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Images can be at most 3 MB." };

  const supabase = await createClient();
  const { data: form } = await supabase
    .from("recruitment_forms")
    .select("vacancy_id, header_image_path, logo_path")
    .eq("id", formId)
    .maybeSingle();
  if (!form) return { error: GENERIC_ERROR };

  const path = buildStoragePath("vacancy", form.vacancy_id, `form-${kind}-${file.name}`);
  const upload = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) return { error: "The upload failed. Please try again." };

  const { error } = await supabase
    .from("recruitment_forms")
    .update(kind === "header" ? { header_image_path: path } : { logo_path: path })
    .eq("id", formId);
  if (error) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return { error: GENERIC_ERROR };
  }
  // The old file may still be used by a published version, so it is kept.
  revalidateForm(form.vacancy_id);
  refresh();
  return { ok: true, message: kind === "header" ? "Header image added." : "Logo added." };
}

export async function removeFormImage(formId: string, kind: "header" | "logo"): Promise<ActionState> {
  await requireStaff();
  if (!uuid.safeParse(formId).success || !["header", "logo"].includes(kind)) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recruitment_forms")
    .update(kind === "header" ? { header_image_path: null } : { logo_path: null })
    .eq("id", formId)
    .select("vacancy_id")
    .maybeSingle();
  if (error || !data) return { error: GENERIC_ERROR };
  revalidateForm(data.vacancy_id);
  refresh();
  return { ok: true };
}
