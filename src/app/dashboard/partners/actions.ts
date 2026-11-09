"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrorsFrom, formValues, GENERIC_ERROR, type ActionState } from "@/lib/action-state";
import { requireModule } from "@/lib/auth";
import { normalizeEmail, normalizeLinkedin, normalizePhone } from "@/lib/gtm/normalize";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.guid();

const partnerSchema = z.object({
  name: z.string({ error: "Enter a name." }).min(1, "Enter a name.").max(200, "Use at most 200 characters."),
  company_name: z.string().max(200, "Use at most 200 characters.").optional(),
  email: z.email({ error: "This is not a valid email address." }).max(320).optional(),
  phone: z.string().max(50, "Use at most 50 characters.").optional(),
  linkedin_url: z.string().max(500, "Use at most 500 characters.").optional(),
  notes: z.string().max(5000, "Use at most 5000 characters.").optional(),
  status: z.enum(["active", "inactive"], { error: "Choose a status." }).default("active"),
  owner_id: z.guid({ error: "Choose a team member." }).optional(),
});

function toRow(data: z.infer<typeof partnerSchema>) {
  return {
    name: data.name,
    company_name: data.company_name ?? null,
    email: data.email ? (normalizeEmail(data.email) ?? data.email) : null,
    phone: data.phone ? (normalizePhone(data.phone) ?? data.phone) : null,
    linkedin_url: data.linkedin_url ? (normalizeLinkedin(data.linkedin_url) ?? data.linkedin_url) : null,
    notes: data.notes ?? null,
    status: data.status,
    owner_id: data.owner_id ?? null,
  };
}

export async function createPartnerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireModule("sales");
  const parsed = partnerSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("partners")
    .insert({ ...toRow(parsed.data), owner_id: parsed.data.owner_id ?? user.id, created_by: user.id })
    .select("id")
    .single();
  if (error) return { error: GENERIC_ERROR };
  revalidatePath("/dashboard/partners");
  redirect(`/dashboard/partners/${data.id}`);
}

export async function updatePartnerAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(id).success) return { error: GENERIC_ERROR };
  const parsed = partnerSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("partners").update(toRow(parsed.data)).eq("id", id);
  if (error) return { error: GENERIC_ERROR };
  revalidatePath("/dashboard/partners");
  revalidatePath(`/dashboard/partners/${id}`);
  return { ok: true, message: "Saved." };
}

const momentSchema = z.object({
  channel: z.enum(["bellen", "mail", "linkedin", "meeting"], { error: "Choose how you were in touch." }),
  direction: z.enum(["inbound", "outbound"]).optional(),
  date: z.iso.date({ error: "Pick a date." }).optional(),
  notes: z.string({ error: "Write what was discussed." }).min(1, "Write what was discussed.").max(5000, "Use at most 5000 characters."),
});

/** A contact moment with the partner: an activity with partner_id (type contact). */
export async function logPartnerContactAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(id).success) return { error: GENERIC_ERROR };
  const parsed = momentSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
  // A date in the past is logged at noon of that day; today keeps the current time.
  const date = parsed.data.date && parsed.data.date !== today ? new Date(`${parsed.data.date}T12:00:00Z`).toISOString() : null;
  if (date && new Date(date).getTime() > Date.now() + 86_400_000) {
    return { error: "A contact moment cannot be in the future.", fieldErrors: { date: "Pick today or a day in the past." } };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("sales_log_activity", {
    p_company: null,
    p_contact: null,
    p_partner: id,
    p_channel: parsed.data.channel,
    p_type: "contact",
    p_notes: parsed.data.notes,
    p_direction: parsed.data.direction ?? null,
    p_date: date,
  });
  if (error) return { error: GENERIC_ERROR };
  revalidatePath("/dashboard/partners");
  revalidatePath(`/dashboard/partners/${id}`);
  return { ok: true, message: "Contact moment saved." };
}

/**
 * Link a lead to the partner who brought it in, or unlink it with null. Goes
 * through sales_update, so the change is in the activity log of the company.
 */
export async function setCompanyPartner(companyId: string, partnerId: string | null): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(companyId).success) return { error: GENERIC_ERROR };
  if (partnerId !== null && !idSchema.safeParse(partnerId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sales_update", {
    p_entity: "company",
    p_ids: [companyId],
    p_fields: { partner_id: partnerId },
  });
  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "Company not found." };
  revalidatePath(`/dashboard/leads/${companyId}`);
  revalidatePath("/dashboard/partners");
  // The old partner's page loses the lead, the new one gains it.
  revalidatePath("/dashboard/partners/[id]", "page");
  return { ok: true, message: partnerId ? "Partner linked." : "Partner removed." };
}
