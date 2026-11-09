"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModule } from "@/lib/auth";
import type { ContactStatus, Json, TablesInsert } from "@/lib/database.types";
import { normalizeEmail, normalizeLinkedin, normalizePhone, phoneTypeFor } from "@/lib/gtm/normalize";
import type { LeadStatus } from "@/lib/sales/database";
import { contactRoutes } from "@/lib/sales/labels";
import { historyExternalId } from "@/lib/sales/call-list-import";
import { createClient } from "@/lib/supabase/server";

// Writes the call list import in blocks, without duplicates (feedback Julius,
// section 2.3 point 7). Existing records are matched and only filled in;
// nothing the team changed is overwritten.

const SOURCE = "call list";
const CHUNK = 150;

const companySchema = z.object({
  key: z.string().min(1).max(600),
  name: z.string().min(1).max(300),
  domain: z.string().max(253).nullable(),
  website: z.string().max(500).nullable(),
  prio: z.number().int().min(1).max(5).nullable(),
  category: z.enum(["development", "data_bi", "both"]).nullable(),
  description: z.string().max(5000).nullable(),
  sector: z.string().max(300).nullable(),
  employees: z.number().int().min(0).max(10_000_000).nullable(),
  city: z.string().max(300).nullable(),
  linkedin_url: z.string().max(500).nullable(),
  general_phone: z.string().max(50).nullable(),
  red_flags: z.array(z.string().max(300)).max(50),
  opening_line: z.string().max(5000).nullable(),
  source_note: z.string().max(2000).nullable(),
  /** What the contacts of this company say about its lead status. */
  leadStatus: z.enum(["ready", "enrich", "in_sequence"]).optional(),
});

const statuses = ["new", "qualified", "enrich", "enriched", "in_outreach", "reached", "not_reached", "not_interested", "do_not_contact"] as const;

const contactSchema = z.object({
  companyId: z.guid(),
  first_name: z.string().max(200).nullable(),
  last_name: z.string().max(200).nullable(),
  title: z.string().max(300).nullable(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  route: z.enum(contactRoutes).nullable(),
  phone: z.string().max(50).nullable(),
  email: z.string().max(320).nullable(),
  linkedin_url: z.string().max(500).nullable(),
  status: z.enum(statuses),
  attempts: z.number().int().min(0).max(99),
  last_attempt_at: z.string().max(30).nullable(),
  referred_to: z.string().max(300).nullable(),
  caller_note: z.string().max(5000).nullable(),
  role: z.enum(["main", "extra", "reserve"]),
  history: z
    .object({
      outcome: z
        .enum([
          "no_answer",
          "call_back",
          "reached_interested",
          "meeting_planned",
          "reached_not_interested",
          "referred",
          "wrong_person",
          "wrong_number",
          "bereikt",
        ])
        .nullable(),
      statusText: z.string().max(300).nullable(),
    })
    .nullable()
    .default(null),
});

type ImportContactInput = z.infer<typeof contactSchema>;

/** The note of the call from the Excel on the timeline. */
function historyNote(c: ImportContactInput): string {
  const parts = ["From the call list (Excel)"];
  if (c.history?.statusText) parts.push(`status "${c.history.statusText}"`);
  if (c.attempts > 0) parts.push(`${c.attempts} ${c.attempts === 1 ? "attempt" : "attempts"}`);
  if (!c.last_attempt_at) parts.push("date of the call unknown");
  return `${parts.join(", ")}.`;
}

const signalSchema = z.object({
  companyId: z.guid(),
  title: z.string().max(500).nullable(),
  role_group: z.string().max(200).nullable(),
  posted_at: z.string().max(30).nullable(),
  source: z.string().max(200).nullable(),
  link: z.string().max(2000).nullable(),
});

export type CompanyChunkResult =
  | { ok: true; ids: Record<string, string>; created: number; updated: number }
  | { ok: false; error: string };
export type ChunkResult =
  | { ok: true; created: number; updated: number; skipped: number; calls?: number }
  | { ok: false; error: string };

function emptyValue(v: unknown) {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Only the fields that are empty now. */
function fill(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, Json> {
  const patch: Record<string, Json> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!emptyValue(value) && emptyValue(existing[key])) patch[key] = value as Json;
  }
  return patch;
}

function slug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function importCompanies(input: z.input<typeof companySchema>[]): Promise<CompanyChunkResult> {
  await requireModule("sales");
  const parsed = z.array(companySchema).max(CHUNK).safeParse(input);
  if (!parsed.success) return { ok: false, error: "The companies of this block could not be read." };
  const supabase = await createClient();
  const ids: Record<string, string> = {};
  let created = 0;
  let updated = 0;

  for (const c of parsed.data) {
    const linkedin = c.linkedin_url?.trim() || null;
    let existing: Record<string, unknown> | null = null;
    const select =
      "id, name, website, prio, category, description, sector, employees, city, linkedin_url, general_phone, red_flags, opening_line, source_note, lead_status, sources";
    if (c.domain) {
      const { data } = await supabase.from("companies").select(select).eq("domain", c.domain).maybeSingle();
      existing = data;
    }
    if (!existing && linkedin) {
      const { data } = await supabase.from("companies").select(select).ilike("linkedin_url", linkedin).limit(1);
      existing = data?.[0] ?? null;
    }
    if (!existing) {
      const { data } = await supabase.from("companies").select(select).ilike("name", c.name.replace(/[%_]/g, "\\$&")).limit(1);
      existing = data?.[0] ?? null;
    }

    const fields = {
      name: c.name,
      website: c.website,
      prio: c.prio,
      category: c.category,
      description: c.description,
      sector: c.sector,
      employees: c.employees,
      city: c.city,
      linkedin_url: linkedin,
      general_phone: c.general_phone,
      red_flags: c.red_flags,
      opening_line: c.opening_line,
      source_note: c.source_note,
    };

    if (existing) {
      const id = existing.id as string;
      ids[c.key] = id;
      const patch = fill(existing, fields);
      if (c.leadStatus && existing.lead_status === "new") patch.lead_status = c.leadStatus;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.rpc("sales_update", { p_entity: "company", p_ids: [id], p_fields: patch, p_source: "import" });
        if (error) return { ok: false, error: `${c.name}: ${error.message}` };
        updated += 1;
      }
      const sources = (existing.sources as string[] | null) ?? [];
      if (!sources.includes(SOURCE)) await supabase.from("companies").update({ sources: [...sources, SOURCE] }).eq("id", id);
      continue;
    }

    const row: TablesInsert<"companies"> = {
      ...fields,
      domain: c.domain ?? `nodomain:${slug(c.name)}`,
      lead_status: (c.leadStatus ?? "ready") as LeadStatus,
      source: SOURCE,
      sources: [SOURCE],
    };
    const { data, error } = await supabase.from("companies").insert(row).select("id").single();
    if (error) {
      if (error.code === "23505") {
        const { data: again } = await supabase.from("companies").select("id").eq("domain", row.domain).maybeSingle();
        if (again) {
          ids[c.key] = again.id;
          continue;
        }
      }
      return { ok: false, error: `${c.name}: ${error.message}` };
    }
    ids[c.key] = data.id;
    created += 1;
  }
  revalidatePath("/dashboard/leads");
  return { ok: true, ids, created, updated };
}

export async function importContacts(input: z.input<typeof contactSchema>[]): Promise<ChunkResult> {
  await requireModule("sales");
  const parsed = z.array(contactSchema).max(CHUNK).safeParse(input);
  if (!parsed.success) return { ok: false, error: "The contacts of this block could not be read." };
  const supabase = await createClient();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let calls = 0;
  const now = new Date().toISOString();

  const logHistory = async (contactId: string, c: ImportContactInput): Promise<string | null> => {
    if (!c.history) return null;
    const { data, error } = await supabase.rpc("sales_log_activity", {
      p_company: c.companyId,
      p_contact: contactId,
      p_channel: "bellen",
      p_type: "contact",
      p_outcome: c.history.outcome,
      p_notes: historyNote(c),
      p_direction: "outbound",
      p_date: c.last_attempt_at ? `${c.last_attempt_at}T12:00:00Z` : null,
      p_source: "import",
      p_external_id: historyExternalId(contactId, c.history, c.last_attempt_at),
    });
    if (error) return error.message;
    if (data) calls += 1;
    return null;
  };
  const select =
    "id, first_name, last_name, title, tier, route, phone, email, linkedin_url, status, attempts, last_attempt_at, referred_to, caller_note, role";

  for (const c of parsed.data) {
    const linkedin = normalizeLinkedin(c.linkedin_url);
    const email = normalizeEmail(c.email);
    const phone = normalizePhone(c.phone);
    let existing: Record<string, unknown> | null = null;
    if (linkedin) {
      const { data } = await supabase.from("contacts").select(select).eq("linkedin_url", linkedin).maybeSingle();
      existing = data;
    }
    if (!existing && email) {
      const { data } = await supabase.from("contacts").select(select).eq("company_id", c.companyId).eq("email", email).limit(1);
      existing = data?.[0] ?? null;
    }
    if (!existing && (c.first_name || c.last_name)) {
      let q = supabase.from("contacts").select(select).eq("company_id", c.companyId);
      q = c.first_name ? q.ilike("first_name", c.first_name) : q.is("first_name", null);
      q = c.last_name ? q.ilike("last_name", c.last_name) : q.is("last_name", null);
      const { data } = await q.limit(1);
      existing = data?.[0] ?? null;
    }
    if (!existing && phone && !c.first_name && !c.last_name) {
      const { data } = await supabase.from("contacts").select(select).eq("company_id", c.companyId).eq("phone", phone).limit(1);
      existing = data?.[0] ?? null;
    }
    if (!existing && !c.first_name && !c.last_name && !email && !linkedin) {
      skipped += 1;
      continue;
    }

    const fields = {
      first_name: c.first_name,
      last_name: c.last_name,
      title: c.title,
      tier: c.tier,
      route: c.route,
      linkedin_url: linkedin,
      referred_to: c.referred_to,
      caller_note: c.caller_note,
      last_attempt_at: c.last_attempt_at,
    };

    if (existing) {
      const patch = fill(existing, fields);
      if (phone && !existing.phone) Object.assign(patch, { phone, phone_type: phoneTypeFor(phone) });
      if (email && !existing.email) Object.assign(patch, { email, email_status: "unknown" });
      if (c.attempts > Number(existing.attempts ?? 0)) patch.attempts = c.attempts;
      if (existing.status === "new" && c.status !== "new") patch.status = c.status as ContactStatus;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.rpc("sales_update", { p_entity: "contact", p_ids: [existing.id as string], p_fields: patch, p_source: "import" });
        if (error) return { ok: false, error: `${c.first_name ?? ""} ${c.last_name ?? ""}: ${error.message}` };
        updated += 1;
      }
      // Phone and mail keep their source and date (hard rule 3).
      if (patch.phone || patch.email) {
        await supabase
          .from("contacts")
          .update({
            ...(patch.phone ? { phone_source: SOURCE, phone_found_at: now } : {}),
            ...(patch.email ? { email_source: SOURCE, email_found_at: now } : {}),
          })
          .eq("id", existing.id as string);
      }
      const historyError = await logHistory(existing.id as string, c);
      if (historyError) return { ok: false, error: `${c.first_name ?? ""} ${c.last_name ?? ""}: ${historyError}` };
      continue;
    }

    const row: TablesInsert<"contacts"> = {
      company_id: c.companyId,
      ...fields,
      attempts: c.attempts,
      status: c.status,
      role: c.role,
      source: SOURCE,
      sources: [SOURCE],
      ...(phone ? { phone, phone_type: phoneTypeFor(phone), phone_source: SOURCE, phone_found_at: now } : {}),
      ...(email ? { email, email_status: "unknown" as const, email_source: SOURCE, email_found_at: now } : {}),
    };
    const { data: inserted, error } = await supabase.from("contacts").insert(row).select("id").single();
    if (error) {
      if (error.code === "23505") {
        skipped += 1;
        continue;
      }
      return { ok: false, error: `${c.first_name ?? ""} ${c.last_name ?? ""}: ${error.message}` };
    }
    created += 1;
    const historyError = await logHistory(inserted.id, c);
    if (historyError) return { ok: false, error: `${c.first_name ?? ""} ${c.last_name ?? ""}: ${historyError}` };
  }
  revalidatePath("/dashboard/contacts");
  return { ok: true, created, updated, skipped, calls };
}

export async function importSignals(input: z.input<typeof signalSchema>[]): Promise<ChunkResult> {
  await requireModule("sales");
  const parsed = z.array(signalSchema).max(CHUNK).safeParse(input);
  if (!parsed.success) return { ok: false, error: "The vacancies of this block could not be read." };
  const supabase = await createClient();
  let created = 0;
  let updated = 0;
  for (const s of parsed.data) {
    const dedupe = s.link
      ? `import:${s.link.trim().toLowerCase()}`
      : `import:${s.companyId}:${slug(s.title ?? "")}:${s.posted_at ?? ""}`;
    const { data: existing } = await supabase.from("signals").select("id, role_group, posted_at").eq("dedupe_key", dedupe).maybeSingle();
    const seen = s.posted_at ? `${s.posted_at}T12:00:00Z` : new Date().toISOString();
    if (existing) {
      const patch: { role_group?: string; posted_at?: string; last_seen_at: string } = { last_seen_at: new Date().toISOString() };
      if (!existing.role_group && s.role_group) patch.role_group = s.role_group;
      if (!existing.posted_at && s.posted_at) patch.posted_at = s.posted_at;
      await supabase.from("signals").update(patch).eq("id", existing.id);
      updated += 1;
      continue;
    }
    const { error } = await supabase.from("signals").insert({
      company_id: s.companyId,
      type: "vacature",
      title: s.title,
      role_group: s.role_group,
      posted_at: s.posted_at,
      source: "import",
      source_url: s.link,
      dedupe_key: dedupe,
      first_seen_at: seen,
      last_seen_at: new Date().toISOString(),
      raw_json: s.source ? { source: s.source } : null,
    });
    if (error && error.code !== "23505") return { ok: false, error: `${s.title ?? "Vacancy"}: ${error.message}` };
    created += 1;
  }
  return { ok: true, created, updated, skipped: 0 };
}
