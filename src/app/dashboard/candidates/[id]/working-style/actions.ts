"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sendWspMailAfter } from "@/lib/wsp/after";

// Staff actions on the Working Style Profile. The database checks the role
// again (wsp_is_staff: recruitment or Academy managers; settings: admins)
// and logs every change in wsp_audit_log. Staff can ask for permission but
// never give it.

export type WspStaffResult = { ok: true; message?: string } | { ok: false; error: string };

const id = z.guid();
const optionalId = z.guid().nullable().optional();

function fail(error: { message?: string } | null): WspStaffResult {
  const text = error?.message ?? "";
  if (/^(The |This |There |Only |Permission |Assessment |Candidate |Vacancy )/.test(text)) return { ok: false, error: text.replace(/\.$/, "") + "." };
  return { ok: false, error: "Something went wrong. Please try again." };
}

function refresh(candidateId?: string, assessmentId?: string) {
  if (candidateId) {
    revalidatePath(`/dashboard/candidates/${candidateId}`);
    if (assessmentId) revalidatePath(`/dashboard/candidates/${candidateId}/working-style/${assessmentId}`);
  }
}

export async function setWspPersonMode(candidateId: string, mode: "follow_vacancy" | "always" | "never"): Promise<WspStaffResult> {
  await requireStaff();
  if (!id.safeParse(candidateId).success || !["follow_vacancy", "always", "never"].includes(mode)) return { ok: false, error: "Choose a setting." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_set_person", { p_person: candidateId, p_mode: mode });
  if (error) return fail(error);
  refresh(candidateId);
  return { ok: true, message: "Saved." };
}

export async function setWspTalentPoolConsent(candidateId: string, consent: boolean): Promise<WspStaffResult> {
  await requireStaff();
  if (!id.safeParse(candidateId).success) return { ok: false, error: "Candidate not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_set_person", { p_person: candidateId, p_talent_pool_consent: consent });
  if (error) return fail(error);
  refresh(candidateId);
  return { ok: true, message: "Saved." };
}

/** "Send working style profile", optionally for a vacancy and a client. */
export async function sendWspInvite(candidateId: string, vacancyId?: string | null, clientId?: string | null): Promise<WspStaffResult> {
  await requireStaff();
  if (!id.safeParse(candidateId).success || !optionalId.safeParse(vacancyId).success || !optionalId.safeParse(clientId).success) {
    return { ok: false, error: "Candidate not found." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wsp_send", { p_person: candidateId, p_vacancy: vacancyId || null, p_client: clientId || null });
  if (error) return fail(error);
  sendWspMailAfter(data ? [data] : undefined);
  refresh(candidateId);
  return { ok: true, message: "Invitation sent." };
}

export async function resendWspInvite(candidateId: string, assessmentId: string): Promise<WspStaffResult> {
  await requireStaff();
  if (!id.safeParse(assessmentId).success) return { ok: false, error: "Assessment not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_resend", { p_assessment: assessmentId });
  if (error) return fail(error);
  sendWspMailAfter([assessmentId]);
  refresh(candidateId, assessmentId);
  return { ok: true, message: "A new link was sent (valid for 14 days)." };
}

export async function requestWspPermission(candidateId: string, assessmentId: string, clientId: string): Promise<WspStaffResult> {
  await requireStaff();
  if (!id.safeParse(assessmentId).success || !id.safeParse(clientId).success) return { ok: false, error: "Client not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_request_permission", { p_assessment: assessmentId, p_client: clientId });
  if (error) return fail(error);
  sendWspMailAfter([assessmentId]);
  refresh(candidateId, assessmentId);
  return { ok: true, message: "Permission asked. Nothing is shared unless they tick the box themselves." };
}

export async function linkWspClient(candidateId: string, assessmentId: string, vacancyId: string | null, clientId: string | null): Promise<WspStaffResult> {
  await requireStaff();
  if (!id.safeParse(assessmentId).success || !optionalId.safeParse(vacancyId).success || !optionalId.safeParse(clientId).success || (!vacancyId && !clientId)) {
    return { ok: false, error: "Choose a vacancy or a client." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_link", { p_assessment: assessmentId, p_vacancy: vacancyId, p_client: clientId });
  if (error) return fail(error);
  refresh(candidateId, assessmentId);
  return { ok: true, message: "Linked." };
}

export async function deleteWspAssessment(candidateId: string, assessmentId: string): Promise<WspStaffResult> {
  await requireStaff();
  if (!id.safeParse(assessmentId).success) return { ok: false, error: "Assessment not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_staff_delete", { p_assessment: assessmentId });
  if (error) return fail(error);
  sendWspMailAfter([assessmentId]);
  refresh(candidateId, assessmentId);
  return { ok: true, message: "Deleted." };
}

export async function setVacancyWsp(vacancyId: string, enabled: boolean): Promise<WspStaffResult> {
  await requireStaff();
  if (!id.safeParse(vacancyId).success) return { ok: false, error: "Vacancy not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_set_vacancy", { p_vacancy: vacancyId, p_enabled: enabled });
  if (error) return fail(error);
  revalidatePath(`/dashboard/vacancies/${vacancyId}`);
  return { ok: true, message: enabled ? "On for this vacancy." : "Off for this vacancy." };
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  trigger_stage_id: z.enum([
    "shortlist", "sourced", "techstack_check", "fill_out", "video_review", "technical_test",
    "interview", "matched", "client_interview", "final_screening", "placed",
  ]),
  default_for_new_vacancies: z.boolean(),
  auto_invite_developers_on_placement: z.boolean(),
  invite_valid_days: z.number().int().min(1).max(90),
  reminder_after_days: z.number().int().min(1).max(30),
  reuse_months: z.number().int().min(0).max(36),
  permission_request_days: z.number().int().min(1).max(90),
  candidate_retention_days: z.number().int().min(0).max(3650),
  talent_pool_retention_days: z.number().int().min(0).max(3650),
  developer_retention_days: z.number().int().min(0).max(3650),
});

/** System settings, admins only (Settings, Working style). */
export async function saveWspSettings(input: z.infer<typeof settingsSchema>): Promise<WspStaffResult> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the values: every term is a whole number within its limits." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_update_settings", { p_settings: parsed.data });
  if (error) return fail(error);
  revalidatePath("/dashboard/settings/working-style");
  return { ok: true, message: "Settings saved." };
}
