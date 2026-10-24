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
import { hasOnePage, pushContactToCrm } from "@/lib/integrations/onepage";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.guid();
const CHECK_FIELDS = "Controleer de gemarkeerde velden.";

const segmentSchema = z.enum(["saas", "productie", "agency_automation", "agency_overig"], {
  error: "Kies een segment.",
});

function revalidateLead(companyId: string) {
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/leads/review");
  revalidatePath(`/dashboard/leads/${companyId}`);
  revalidatePath("/dashboard/contacten");
}

// ---------------------------------------------------------------------------
// Review (S2): Julius decides on REVIEW companies
// ---------------------------------------------------------------------------

const reviewSchema = z.object({
  decision: z.enum(["GO", "NO_GO"], { error: "Kies GO of No go." }),
  note: z.string().max(2000, "Gebruik maximaal 2000 tekens.").optional(),
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
    ? `Review door ${user.name} op ${formatDate(new Date().toISOString())}: ${parsed.data.note}`
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
        ? `${company.name} staat op No go: er is risico op klantcontact.`
        : `${company.name} staat op ${label}.`,
  };
}

// ---------------------------------------------------------------------------
// Company basics
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().max(max, `Gebruik maximaal ${max} tekens.`).optional();

const companySchema = z.object({
  name: z.string({ error: "Vul een naam in." }).min(1, "Vul een naam in.").max(200, "Gebruik maximaal 200 tekens."),
  legal_form: optionalText(100),
  employees: z.coerce
    .number({ error: "Vul een getal in." })
    .int("Vul een heel getal in.")
    .min(0, "Vul 0 of meer in.")
    .max(1_000_000, "Dat is wel erg veel.")
    .optional(),
  sector: optionalText(200),
  city: optionalText(200),
  segment: segmentSchema.optional(),
  status: z.enum(["nieuw", "actief", "klant", "verloren", "uitgesloten"], { error: "Kies een status." }),
  kvk_number: z
    .string()
    .regex(/^\d{8}$/, "Een KvK-nummer heeft 8 cijfers.")
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
  return { ok: true, message: "Bedrijf bijgewerkt." };
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

const activitySchema = z
  .object({
    contact_id: z.guid().optional(),
    channel: z.enum(["bellen", "mail", "linkedin", "meeting"], { error: "Kies een kanaal." }),
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
      { error: "Kies een uitkomst." },
    ),
    date: z.iso.date({ error: "Kies een geldige datum." }).optional(),
    notes: optionalText(5000),
    next_action: optionalText(300),
    next_action_date: z.iso.date({ error: "Kies een geldige datum." }).optional(),
  })
  .refine((d) => !d.next_action_date || d.next_action, {
    message: "Beschrijf de volgende actie bij deze datum.",
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
    if (!contact) return { error: "Dit contact hoort niet bij dit bedrijf." };
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
        ? "Activiteit vastgelegd. De afmelding staat direct in de uitsluitingen."
        : "Activiteit vastgelegd.",
  };
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

const suppressionSchema = z.object({
  target: z.string({ error: "Kies wie je uitsluit." }).min(1, "Kies wie je uitsluit."),
  reason: z.enum(["afgemeld", "bezwaar", "klant", "lopend_gesprek", "niet_bellen"], { error: "Kies een reden." }),
  scope: z.enum(["alle_kanalen", "alleen_bellen", "alleen_mail"], { error: "Kies voor welke kanalen." }),
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
    if (!contact) return { error: "Dit contact hoort niet bij dit bedrijf." };
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
  revalidatePath("/dashboard/uitsluitingen");
  return {
    ok: true,
    message: contactId ? "Contact uitgesloten." : "Bedrijf uitgesloten. Geen enkel contact van dit bedrijf wordt nog benaderd via deze kanalen.",
  };
}

// ---------------------------------------------------------------------------
// OnePageCRM (S9, manual trigger)
// ---------------------------------------------------------------------------

const crmSchema = z
  .object({
    reason: z.string({ error: "Vul een reden in." }).min(1, "Vul een reden in.").max(500, "Gebruik maximaal 500 tekens."),
    next_action: optionalText(300),
    next_action_date: z.iso.date({ error: "Kies een geldige datum." }).optional(),
  })
  .refine((d) => Boolean(d.next_action) === Boolean(d.next_action_date), {
    message: "Vul de volgende actie en de datum allebei in, of laat ze allebei leeg.",
    path: ["next_action_date"],
  });

export async function pushToCrmAction(
  companyId: string,
  contactId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!idSchema.safeParse(companyId).success || !idSchema.safeParse(contactId).success) {
    return { error: GENERIC_ERROR };
  }
  if (!hasOnePage()) {
    return { error: "OnePageCRM is nog niet gekoppeld: ONEPAGE_USER_ID en ONEPAGE_API_KEY ontbreken op de server." };
  }
  const parsed = crmSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, status, company:companies(icp_decision)")
    .eq("id", contactId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!contact) return { error: "Dit contact hoort niet bij dit bedrijf." };
  // Rule 8: only qualified contacts go into the CRM.
  if (contact.company?.icp_decision !== "GO") {
    return { error: "Alleen contacten van een GO bedrijf gaan naar het CRM. Kwalificeer het bedrijf eerst." };
  }
  if (contact.status === "uitgesloten" || contact.status === "verloren") {
    return { error: "Dit contact is uitgesloten of verloren en gaat niet naar het CRM." };
  }

  try {
    const { onepageId } = await pushContactToCrm(supabase, contactId, {
      reason: parsed.data.reason,
      nextAction:
        parsed.data.next_action && parsed.data.next_action_date
          ? { text: parsed.data.next_action, date: parsed.data.next_action_date }
          : undefined,
    });
    revalidateLead(companyId);
    return { ok: true, message: `Contact staat in OnePageCRM (id ${onepageId}).` };
  } catch (error) {
    return { error: error instanceof Error && error.message ? error.message : GENERIC_ERROR };
  }
}

// ---------------------------------------------------------------------------
// Link to a client (the company became a customer)
// ---------------------------------------------------------------------------

const linkSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), client_id: z.guid({ error: "Kies een klant." }) }),
  z.object({
    mode: z.literal("new"),
    name: z.string({ error: "Vul een naam in." }).min(1, "Vul een naam in.").max(200, "Gebruik maximaal 200 tekens."),
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
  revalidatePath("/dashboard/klanten");
  revalidatePath(`/dashboard/klanten/${clientId}`);
  return { ok: true, message: "Gekoppeld aan de klant. Het bedrijf staat nu op klant." };
}
