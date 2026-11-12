"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { fieldErrorsFrom, formValues, GENERIC_ERROR, type ActionState } from "@/lib/action-state";
import type { TablesInsert } from "@/lib/database.types";
import { normalizeDomain, normalizeEmail, normalizeLinkedin } from "@/lib/gtm/normalize";
import { createClient } from "@/lib/supabase/server";

const suppressionSchema = z.object({
  kind: z.enum(["contact", "bedrijf", "email"], { error: "Choose what you want to suppress." }),
  value: z.string({ error: "Fill in this field." }).min(1, "Fill in this field.").max(500, "Use at most 500 characters."),
  reason: z.enum(["afgemeld", "bezwaar", "klant", "lopend_gesprek", "niet_bellen"], { error: "Choose a reason." }),
  scope: z.enum(["alle_kanalen", "alleen_bellen", "alleen_mail"], { error: "Choose the channels." }),
  notes: z.string().max(2000, "Use at most 2000 characters.").optional(),
});

export async function addSuppressionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireStaff();
  const parsed = suppressionSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  const { kind, value, reason, scope, notes } = parsed.data;
  const supabase = await createClient();
  const row: TablesInsert<"suppression"> = { reason, scope, notes: notes ?? null, created_by: user.id };
  let label = value;

  if (kind === "bedrijf") {
    const domain = normalizeDomain(value);
    if (!domain) return { fieldErrors: { value: "Enter a valid domain, for example acme.com." }, error: "Check the highlighted fields." };
    const { data, error } = await supabase.from("companies").select("id, name").eq("domain", domain).maybeSingle();
    if (error) return { error: GENERIC_ERROR };
    if (!data) return { fieldErrors: { value: `No company found with domain ${domain}.` }, error: "Check the highlighted fields." };
    row.company_id = data.id;
    label = data.name;
  } else if (kind === "contact") {
    const linkedin = /linkedin\.com/i.test(value) ? normalizeLinkedin(value) : null;
    const email = linkedin ? null : normalizeEmail(value);
    if (!linkedin && !email) {
      return { fieldErrors: { value: "Enter the contact's LinkedIn URL or email address." }, error: "Check the highlighted fields." };
    }
    let query = supabase.from("contacts").select("id, first_name, last_name").limit(1);
    query = linkedin ? query.eq("linkedin_key", linkedin) : query.eq("email", email!);
    const { data, error } = await query.maybeSingle();
    if (error) return { error: GENERIC_ERROR };
    if (!data) return { fieldErrors: { value: "No contact found with this LinkedIn URL or email address." }, error: "Check the highlighted fields." };
    row.contact_id = data.id;
    label = [data.first_name, data.last_name].filter(Boolean).join(" ") || value;
  } else {
    const email = normalizeEmail(value);
    if (!email) return { fieldErrors: { value: "Enter a valid email address." }, error: "Check the highlighted fields." };
    row.email = email;
    label = email;
  }

  const { error } = await supabase.from("suppression").insert(row);
  if (error) return { error: GENERIC_ERROR };

  revalidatePath("/dashboard/suppressions");
  return { ok: true, message: `${label} is suppressed.` };
}

export async function deleteSuppressionAction(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  await requireStaff();
  if (!z.guid().safeParse(id).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("suppression").delete().eq("id", id);
  if (error) return { error: GENERIC_ERROR };
  revalidatePath("/dashboard/suppressions");
  return { ok: true };
}
