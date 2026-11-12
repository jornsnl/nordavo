"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { fieldErrorsFrom, formValues, type ActionState } from "@/lib/action-state";
import { likeExact, MANUAL_SOURCE, manualContactRow, parseLinkedinCompany, parseWebsite } from "@/lib/gtm/manual";
import { normalizeLinkedin, normalizePhone } from "@/lib/gtm/normalize";
import { duplicateWarning } from "@/lib/sales/duplicates";
import { createClient } from "@/lib/supabase/server";

/*
 * "Add lead" and "Add contact": leads and contacts entered by hand, next to
 * the flow (docs/gtm.md) and the CSV import. Same hard rules as the flow:
 * one company per domain, one contact per LinkedIn profile, and suppression
 * is respected through is_contactable. Rows get source 'manual'; the
 * database logs them to the activity log (migration 20261107020000).
 */

const CHECK_FIELDS = "Check the highlighted fields.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

const optionalText = (max: number) => z.string().max(max, `Use at most ${max} characters.`).optional();

type Db = Awaited<ReturnType<typeof createClient>>;

function revalidateLeads(companyId: string) {
  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${companyId}`);
  revalidatePath("/dashboard/contacts");
}

// ---------------------------------------------------------------------------
// Add lead
// ---------------------------------------------------------------------------

const leadSchema = z.object({
  name: z.string({ error: "Enter a name." }).min(1, "Enter a name.").max(200, "Use at most 200 characters."),
  website: z
    .string({ error: "Enter the website or domain." })
    .min(1, "Enter the website or domain.")
    .max(300, "Use at most 300 characters."),
  sector: optionalText(200),
  city: optionalText(200),
  segment: z.enum(["saas", "productie", "agency_automation", "agency_overig"], { error: "Choose a segment." }).optional(),
  legal_form: optionalText(100),
  employees: z.coerce
    .number({ error: "Enter a number." })
    .int("Enter a whole number.")
    .min(0, "Enter 0 or more.")
    .max(1_000_000, "That is a lot, check the number.")
    .optional(),
  kvk_number: z
    .string()
    .regex(/^\d{8}$/, "A KvK number has 8 digits.")
    .optional(),
  linkedin_url: optionalText(300),
  opening_line: optionalText(2000),
  red_flags: optionalText(3000),
  general_phone: optionalText(50),
  confirm_duplicate: z.string().optional(),
});

/** The error for a domain that is already a lead, with a link to that lead. */
async function duplicateLead(supabase: Db, domain: string): Promise<ActionState | null> {
  const { data: existing } = await supabase
    .from("companies")
    .select("id, name, status")
    .or(`domain.eq.${domain},alias_domains.cs.{${domain}}`)
    .limit(1)
    .maybeSingle();
  if (!existing) return null;
  const { count } = await supabase
    .from("suppression")
    .select("id", { count: "exact", head: true })
    .eq("company_id", existing.id);
  const excluded = existing.status === "uitgesloten" || (count ?? 0) > 0;
  return {
    error: `${domain} is already a lead: ${existing.name}.${
      excluded ? " This company is on the suppression list and is not approached." : ""
    }`,
    fieldErrors: { website: "This domain is already a lead." },
    link: { href: `/dashboard/leads/${existing.id}`, label: `Open ${existing.name}` },
  };
}

export async function createLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = leadSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;

  const site = parseWebsite(d.website);
  if (!site) {
    return { error: CHECK_FIELDS, fieldErrors: { website: "Enter a valid website or domain, for example acme.com." } };
  }
  const linkedin = d.linkedin_url ? parseLinkedinCompany(d.linkedin_url) : null;
  if (d.linkedin_url && !linkedin) {
    return {
      error: CHECK_FIELDS,
      fieldErrors: { linkedin_url: "Enter a LinkedIn company page, for example linkedin.com/company/acme." },
    };
  }

  // Rule 1: one company per domain. Point to the existing lead instead.
  const supabase = await createClient();
  const duplicate = await duplicateLead(supabase, site.domain);
  if (duplicate) return duplicate;

  // The same company on another domain (brightcape.nl and brightcape.com): warn, add only after a tick.
  if (d.confirm_duplicate !== "on") {
    const { data: similar } = await supabase.rpc("sales_similar_companies", { p_name: d.name, p_domain: site.domain });
    const warning = duplicateWarning(similar ?? []);
    if (warning && similar?.[0]) {
      return {
        error: warning,
        fieldErrors: { name: "A company with a similar name exists.", confirm_duplicate: "Tick this to add the lead anyway." },
        link: { href: `/dashboard/leads/${similar[0].id}`, label: `Open ${similar[0].name}` },
      };
    }
  }
  const generalPhone = d.general_phone ? (normalizePhone(d.general_phone) ?? d.general_phone.trim()) : null;
  const redFlags = (d.red_flags ?? "")
    .split(/[;\n]/)
    .map((f) => f.replace(/^[\s\-*•]+/, "").trim())
    .filter(Boolean);

  const { data, error } = await supabase
    .from("companies")
    .insert({
      domain: site.domain,
      website: site.website,
      name: d.name,
      sector: d.sector ?? null,
      city: d.city ?? null,
      segment: d.segment ?? null,
      legal_form: d.legal_form ?? null,
      employees: d.employees ?? null,
      kvk_number: d.kvk_number ?? null,
      linkedin_url: linkedin,
      opening_line: d.opening_line?.trim() || null,
      red_flags: redFlags,
      general_phone: generalPhone,
      source: MANUAL_SOURCE,
      sources: [MANUAL_SOURCE],
    })
    .select("id")
    .single();
  if (error) {
    // Lost a race with the flow or a colleague adding the same domain.
    if (error.code === "23505") return (await duplicateLead(supabase, site.domain)) ?? { error: GENERIC_ERROR };
    return { error: GENERIC_ERROR };
  }

  revalidateLeads(data.id);
  redirect(`/dashboard/leads/${data.id}`);
}

// ---------------------------------------------------------------------------
// Add contact
// ---------------------------------------------------------------------------

const contactSchema = z.object({
  first_name: optionalText(100),
  last_name: optionalText(150),
  title: optionalText(200),
  tier: z.enum(["1", "2", "3"], { error: "Choose a tier." }).transform((v) => Number(v) as 1 | 2 | 3).optional(),
  role: z.enum(["main", "reserve", "extra"], { error: "Choose a role." }).optional(),
  email: optionalText(320),
  phone: optionalText(50),
  linkedin_url: optionalText(300),
});

type FoundContact = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: { id: string; name: string } | null;
};

function contactName(c: { first_name: string | null; last_name: string | null; email?: string | null }) {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "This contact";
}

const DUPLICATE_HINTS = {
  linkedin_url: "This LinkedIn profile is already in the system.",
  email: "This email address is already a contact at this lead.",
  first_name: "A contact with this name already exists at this lead.",
} as const;

export async function createContactAction(
  companyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!z.guid().safeParse(companyId).success) return { error: GENERIC_ERROR };
  const parsed = contactSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  const built = manualContactRow(companyId, parsed.data, new Date().toISOString());
  if (!built.ok) return { error: CHECK_FIELDS, fieldErrors: built.fieldErrors };
  const row = built.row;

  const supabase = await createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, name, status")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return { error: GENERIC_ERROR };

  // Rule 2, as in upsertContact: the same LinkedIn profile (on any lead) is the
  // same person; so is the same email at this lead or, without both, the same
  // name at this lead.
  const findDuplicate = async (): Promise<ActionState | null> => {
    const columns = "first_name, last_name, email, company:companies(id, name)";
    let found: FoundContact | null = null;
    let field: keyof typeof DUPLICATE_HINTS = "linkedin_url";
    if (row.linkedin_url) {
      const { data } = await supabase.from("contacts").select(columns).eq("linkedin_key", normalizeLinkedin(row.linkedin_url) ?? "").maybeSingle();
      found = data;
    }
    if (!found && row.email) {
      field = "email";
      const { data } = await supabase
        .from("contacts")
        .select(columns)
        .eq("company_id", companyId)
        .eq("email", row.email)
        .limit(1)
        .maybeSingle();
      found = data;
    }
    if (!found && !row.linkedin_url && !row.email) {
      field = "first_name";
      let query = supabase.from("contacts").select(columns).eq("company_id", companyId);
      query = row.first_name ? query.ilike("first_name", likeExact(row.first_name)) : query.is("first_name", null);
      query = row.last_name ? query.ilike("last_name", likeExact(row.last_name)) : query.is("last_name", null);
      const { data } = await query.limit(1).maybeSingle();
      found = data;
    }
    if (!found) return null;
    const lead = found.company;
    const here = !lead || lead.id === companyId;
    return {
      error: here
        ? `${contactName(found)} is already a contact at this lead.`
        : `${contactName(found)} is already a contact at ${lead.name}.`,
      fieldErrors: { [field]: DUPLICATE_HINTS[field] },
      ...(here ? {} : { link: { href: `/dashboard/leads/${lead.id}`, label: `Open ${lead.name}` } }),
    };
  };
  const duplicate = await findDuplicate();
  if (duplicate) return duplicate;

  const { error } = await supabase.from("contacts").insert(row);
  if (error) {
    if (error.code === "23505") return (await findDuplicate()) ?? { error: GENERIC_ERROR };
    return { error: GENERIC_ERROR };
  }
  revalidateLeads(companyId);

  // Rule 4 needs no extra work: is_contactable already matches suppression on
  // this company and on the email address. Say so, so nobody is surprised.
  const [{ count: companyBlocks }, { count: emailBlocks }] = await Promise.all([
    supabase.from("suppression").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    row.email
      ? supabase.from("suppression").select("id", { count: "exact", head: true }).ilike("email", likeExact(row.email))
      : Promise.resolve({ count: 0 }),
  ]);
  const name = contactName(row);
  if ((emailBlocks ?? 0) > 0) {
    return { ok: true, message: `${name} added. This email address is on the suppression list, so ${name} is not approached.` };
  }
  if ((companyBlocks ?? 0) > 0 || company.status === "uitgesloten") {
    return { ok: true, message: `${name} added. ${company.name} is on the suppression list, so ${name} is not approached.` };
  }
  return { ok: true, message: `${name} added to ${company.name}.` };
}
