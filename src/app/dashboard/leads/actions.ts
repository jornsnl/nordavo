"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import {
  fieldErrorsFrom,
  formValues,
  GENERIC_ERROR,
  type ActionState,
} from "@/lib/action-state";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.guid();
const CHECK_FIELDS = "Check the highlighted fields.";

const segmentSchema = z.enum(["saas", "productie", "agency_automation", "agency_overig"], {
  error: "Choose a segment.",
});

function revalidateLead(companyId: string) {
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/leads/review");
  revalidatePath(`/dashboard/leads/${companyId}`);
  revalidatePath("/dashboard/contacts");
}

// ---------------------------------------------------------------------------
// Review (S2): Julius decides on REVIEW companies
// ---------------------------------------------------------------------------

const reviewSchema = z.object({
  decision: z.enum(["GO", "NO_GO"], { error: "Choose GO or No go." }),
  note: z.string().max(2000, "Use at most 2000 characters.").optional(),
  client_contact_risk: z.literal("on").optional(),
  segment: segmentSchema.optional(),
});

export async function reviewDecisionAction(
  companyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireStaff();
  if (!idSchema.safeParse(companyId).success) return { error: GENERIC_ERROR };
  const parsed = reviewSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { data: company, error: readError } = await supabase
    .from("companies")
    .select("name, icp_reason")
    .eq("id", companyId)
    .maybeSingle();
  if (readError || !company) return { error: GENERIC_ERROR };

  const risk = parsed.data.client_contact_risk === "on";
  // Rule 9: the database forces NO_GO when there is client contact risk.
  const decision = risk ? "NO_GO" : parsed.data.decision;
  const note = parsed.data.note
    ? `Review by ${user.name} on ${formatDate(new Date().toISOString())}: ${parsed.data.note}`
    : null;
  const reason = [company.icp_reason, note].filter(Boolean).join("\n\n") || null;

  const { error } = await supabase
    .from("companies")
    .update({
      icp_decision: decision,
      client_contact_risk: risk,
      reviewed_by: user.id,
      qualified_at: new Date().toISOString(),
      icp_reason: reason,
      ...(parsed.data.segment ? { segment: parsed.data.segment } : {}),
    })
    .eq("id", companyId);
  if (error) return { error: GENERIC_ERROR };

  revalidateLead(companyId);
  const label = decision === "GO" ? "GO" : "No go";
  return {
    ok: true,
    message:
      risk && parsed.data.decision === "GO"
        ? `${company.name} is set to No go: there is a client contact risk.`
        : `${company.name} is set to ${label}.`,
  };
}

// ---------------------------------------------------------------------------
// Company basics
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().max(max, `Use at most ${max} characters.`).optional();

const companySchema = z.object({
  name: z.string({ error: "Enter a name." }).min(1, "Enter a name.").max(200, "Use at most 200 characters."),
  legal_form: optionalText(100),
  employees: z.coerce
    .number({ error: "Enter a number." })
    .int("Enter a whole number.")
    .min(0, "Enter 0 or more.")
    .max(1_000_000, "That is a lot, check the number.")
    .optional(),
  sector: optionalText(200),
  city: optionalText(200),
  segment: segmentSchema.optional(),
  status: z.enum(["nieuw", "actief", "klant", "verloren", "uitgesloten"], { error: "Choose a status." }),
  kvk_number: z
    .string()
    .regex(/^\d{8}$/, "A KvK number has 8 digits.")
    .optional(),
  linkedin_url: optionalText(300),
});

export async function updateCompanyAction(
  companyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!idSchema.safeParse(companyId).success) return { error: GENERIC_ERROR };
  const parsed = companySchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };

  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("companies")
    .update({
      name: d.name,
      legal_form: d.legal_form ?? null,
      employees: d.employees ?? null,
      sector: d.sector ?? null,
      city: d.city ?? null,
      segment: d.segment ?? null,
      status: d.status,
      kvk_number: d.kvk_number ?? null,
      linkedin_url: d.linkedin_url ?? null,
    })
    .eq("id", companyId);
  if (error) return { error: GENERIC_ERROR };

  revalidateLead(companyId);
  return { ok: true, message: "Company updated." };
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

const activitySchema = z
  .object({
    contact_id: z.guid().optional(),
    channel: z.enum(["bellen", "mail", "linkedin", "meeting"], { error: "Choose a channel." }),
    outcome: z.enum(
      [
        "verstuurd",
        "geen_gehoor",
        "bereikt",
        "terugbellen",
        "afspraak",
        "afspraak_goedgekeurd",
        "afspraak_afgekeurd",
        "niet_geinteresseerd",
        "reply_positief",
        "reply_neutraal",
        "reply_negatief",
        "bounce",
        "afgemeld",
        "gesprek_gehad",
        "gewonnen",
        "verloren",
        "notitie",
      ],
      { error: "Choose an outcome." },
    ),
    date: z.iso.date({ error: "Choose a valid date." }).optional(),
    notes: optionalText(5000),
    next_action: optionalText(300),
    next_action_date: z.iso.date({ error: "Choose a valid date." }).optional(),
  })
  .refine((d) => !d.next_action_date || d.next_action, {
    message: "Describe the next action for this date.",
    path: ["next_action"],
  });

export async function logActivityAction(
  companyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireStaff();
  if (!idSchema.safeParse(companyId).success) return { error: GENERIC_ERROR };
  const parsed = activitySchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;

  const supabase = await createClient();
  if (d.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", d.contact_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!contact) return { error: "This contact does not belong to this company." };
  }

  // A date without time: keep the current time when it is today, else noon.
  let date = new Date().toISOString();
  if (d.date && d.date !== date.slice(0, 10)) date = new Date(`${d.date}T12:00:00`).toISOString();

  const { error } = await supabase.from("activities").insert({
    company_id: companyId,
    contact_id: d.contact_id ?? null,
    channel: d.channel,
    outcome: d.outcome,
    date,
    notes: d.notes ?? null,
    next_action: d.next_action ?? null,
    next_action_date: d.next_action_date ?? null,
    source: "handmatig",
    created_by: user.id,
  });
  if (error) return { error: GENERIC_ERROR };

  revalidateLead(companyId);
  return {
    ok: true,
    message:
      d.outcome === "afgemeld"
        ? "Activity logged. The unsubscribe is added to the suppressions straight away."
        : "Activity logged.",
  };
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

const suppressionSchema = z.object({
  target: z.string({ error: "Choose who to suppress." }).min(1, "Choose who to suppress."),
  reason: z.enum(["afgemeld", "bezwaar", "klant", "lopend_gesprek", "niet_bellen"], { error: "Choose a reason." }),
  scope: z.enum(["alle_kanalen", "alleen_bellen", "alleen_mail"], { error: "Choose the channels." }),
  notes: optionalText(1000),
});

export async function suppressAction(
  companyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireStaff();
  if (!idSchema.safeParse(companyId).success) return { error: GENERIC_ERROR };
  const parsed = suppressionSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;

  const supabase = await createClient();
  let contactId: string | null = null;
  if (d.target !== "company") {
    if (!idSchema.safeParse(d.target).success) return { error: GENERIC_ERROR };
    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", d.target)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!contact) return { error: "This contact does not belong to this company." };
    contactId = contact.id;
  }

  const { error } = await supabase.from("suppression").insert({
    company_id: contactId ? null : companyId,
    contact_id: contactId,
    reason: d.reason,
    scope: d.scope,
    notes: d.notes ?? null,
    created_by: user.id,
  });
  if (error) return { error: GENERIC_ERROR };

  revalidateLead(companyId);
  revalidatePath("/dashboard/suppressions");
  return {
    ok: true,
    message: contactId ? "Contact suppressed." : "Company suppressed. No contact at this company is approached through these channels any more.",
  };
}

// ---------------------------------------------------------------------------
// Link to a client (the company became a customer)
// ---------------------------------------------------------------------------

const linkSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), client_id: z.guid({ error: "Choose a client." }) }),
  z.object({
    mode: z.literal("new"),
    name: z.string({ error: "Enter a name." }).min(1, "Enter a name.").max(200, "Use at most 200 characters."),
  }),
]);

export async function linkClientAction(
  companyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!idSchema.safeParse(companyId).success) return { error: GENERIC_ERROR };
  const parsed = linkSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, domain, website, sector, city")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return { error: GENERIC_ERROR };

  let clientId: string;
  if (parsed.data.mode === "existing") {
    clientId = parsed.data.client_id;
  } else {
    const { data: client, error } = await supabase
      .from("clients")
      .insert({
        name: parsed.data.name,
        website: company.website || `https://${company.domain}`,
        industry: company.sector,
        city: company.city,
        status: "active",
      })
      .select("id")
      .single();
    if (error) return { error: GENERIC_ERROR };
    clientId = client.id;
  }

  const { error } = await supabase
    .from("companies")
    .update({ client_id: clientId, status: "klant" })
    .eq("id", companyId);
  if (error) return { error: GENERIC_ERROR };

  revalidateLead(companyId);
  revalidatePath("/dashboard/clients");
  revalidatePath(`/dashboard/clients/${clientId}`);
  return { ok: true, message: "Linked to the client. The company now has the status client." };
}
