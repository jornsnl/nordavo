"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { fieldErrorsFrom, formValues, GENERIC_ERROR, type ActionState } from "@/lib/action-state";
import type { TablesInsert } from "@/lib/database.types";
import { normalizeDomain, normalizeEmail, normalizeLinkedin } from "@/lib/gtm/normalize";
import { createClient } from "@/lib/supabase/server";

const suppressionSchema = z.object({
  kind: z.enum(["contact", "bedrijf", "email"], { error: "Kies wat je wilt uitsluiten." }),
  value: z.string({ error: "Vul dit veld in." }).min(1, "Vul dit veld in.").max(500, "Gebruik maximaal 500 tekens."),
  reason: z.enum(["afgemeld", "bezwaar", "klant", "lopend_gesprek", "niet_bellen"], { error: "Kies een reden." }),
  scope: z.enum(["alle_kanalen", "alleen_bellen", "alleen_mail"], { error: "Kies voor welke kanalen." }),
  notes: z.string().max(2000, "Gebruik maximaal 2000 tekens.").optional(),
});

export async function addSuppressionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireStaff();
  const parsed = suppressionSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  const { kind, value, reason, scope, notes } = parsed.data;
  const supabase = await createClient();
  const row: TablesInsert<"suppression"> = { reason, scope, notes: notes ?? null, created_by: user.id };
  let label = value;

  if (kind === "bedrijf") {
    const domain = normalizeDomain(value);
    if (!domain) return { fieldErrors: { value: "Vul een geldig domein in, bijvoorbeeld bedrijf.nl." }, error: "Controleer de gemarkeerde velden." };
    const { data, error } = await supabase.from("companies").select("id, name").eq("domain", domain).maybeSingle();
    if (error) return { error: GENERIC_ERROR };
    if (!data) return { fieldErrors: { value: `Geen bedrijf gevonden met domein ${domain}.` }, error: "Controleer de gemarkeerde velden." };
    row.company_id = data.id;
    label = data.name;
  } else if (kind === "contact") {
    const linkedin = /linkedin\.com/i.test(value) ? normalizeLinkedin(value) : null;
    const email = linkedin ? null : normalizeEmail(value);
    if (!linkedin && !email) {
      return { fieldErrors: { value: "Vul een LinkedIn URL of een mailadres van het contact in." }, error: "Controleer de gemarkeerde velden." };
    }
    let query = supabase.from("contacts").select("id, first_name, last_name").limit(1);
    query = linkedin ? query.eq("linkedin_url", linkedin) : query.eq("email", email!);
    const { data, error } = await query.maybeSingle();
    if (error) return { error: GENERIC_ERROR };
    if (!data) return { fieldErrors: { value: "Geen contact gevonden met deze LinkedIn URL of dit mailadres." }, error: "Controleer de gemarkeerde velden." };
    row.contact_id = data.id;
    label = [data.first_name, data.last_name].filter(Boolean).join(" ") || value;
  } else {
    const email = normalizeEmail(value);
    if (!email) return { fieldErrors: { value: "Vul een geldig mailadres in." }, error: "Controleer de gemarkeerde velden." };
    row.email = email;
    label = email;
  }

  const { error } = await supabase.from("suppression").insert(row);
  if (error) return { error: GENERIC_ERROR };

  revalidatePath("/dashboard/uitsluitingen");
  return { ok: true, message: `${label} is uitgesloten.` };
}

export async function deleteSuppressionAction(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  await requireStaff();
  if (!z.guid().safeParse(id).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("suppression").delete().eq("id", id);
  if (error) return { error: GENERIC_ERROR };
  revalidatePath("/dashboard/uitsluitingen");
  return { ok: true };
}
