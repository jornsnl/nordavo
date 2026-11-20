"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModule } from "@/lib/auth";
import { fieldErrorsFrom, formValues, type ActionState } from "@/lib/action-state";
import type { Json, SignalType } from "@/lib/database.types";
import { parseLinkedinProfile } from "@/lib/gtm/manual";
import { normalizeEmail, normalizePhone, phoneTypeFor } from "@/lib/gtm/normalize";
import { classifyLeadsForDelete } from "@/lib/sales/delete-leads";
import { createClient } from "@/lib/supabase/server";

/*
 * Editing a lead like a spreadsheet (feedback Julius, "ik kan bij leads nergens
 * gegevens aanpassen"): change and delete contacts, switch channels off per
 * contact, flag a contact as left or wrong, own contact protection, delete a
 * lead made by mistake, change or delete a signal. Every change goes through
 * sales_update or a sales_* function, so it is logged in Activities with who
 * and when. Migration 20261124700000_leads_own_contact_edit.sql.
 */

const CHECK_FIELDS = "Check the highlighted fields.";
const GENERIC_ERROR = "Something went wrong. Nothing was changed. Please try again.";
const uuid = z.guid();

function revalidateLead(companyId: string) {
  revalidatePath("/dashboard/leads", "layout");
  revalidatePath("/dashboard/contacts", "layout");
  revalidatePath("/dashboard/pipeline", "layout");
  revalidatePath(`/dashboard/leads/${companyId}`);
}

function friendly(message: string): string {
  if (/No access to sales/.test(message)) return "You need the Sales module for this.";
  if (/Callers (change|cannot)/.test(message)) return "Callers change contacts on the call screen.";
  if (/linkedin_key|duplicate key/.test(message)) return "Another contact already has this LinkedIn profile. Merge the two instead.";
  if (/does not exist|schema cache/.test(message)) return "This is not set up yet: apply the latest database migrations.";
  if (/not found/i.test(message)) return "That record no longer exists.";
  return GENERIC_ERROR;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const optional = (max: number) => z.string().max(max, `Use at most ${max} characters.`).optional();

const contactSchema = z.object({
  first_name: optional(100),
  last_name: optional(150),
  title: optional(200),
  tier: z.enum(["1", "2", "3"]).optional(),
  role: z.enum(["main", "reserve", "extra"]).optional(),
  email: optional(320),
  phone: optional(50),
  linkedin_url: optional(500),
});

/** Change a contact: name, title, tier, role, email, phone, LinkedIn. Empty fields clear the value. */
export async function updateContactAction(
  companyId: string,
  contactId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireModule("sales");
  if (!uuid.safeParse(companyId).success || !uuid.safeParse(contactId).success) return { error: GENERIC_ERROR };
  const parsed = contactSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;

  const fieldErrors: Record<string, string> = {};
  if (!d.first_name && !d.last_name) fieldErrors.first_name = "Enter a first or last name.";
  const email = d.email ? normalizeEmail(d.email) : null;
  if (d.email && !email) fieldErrors.email = "Enter a valid email address.";
  const phone = d.phone ? normalizePhone(d.phone) : null;
  if (d.phone && !phone) fieldErrors.phone = "Enter a valid phone number, for example 06 12345678.";
  const linkedin = d.linkedin_url ? parseLinkedinProfile(d.linkedin_url) : null;
  if (d.linkedin_url && !linkedin) fieldErrors.linkedin_url = "Enter a LinkedIn profile URL, for example linkedin.com/in/jane-doe.";
  if (Object.keys(fieldErrors).length > 0) return { error: CHECK_FIELDS, fieldErrors };

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("contacts")
    .select("id, company_id, email, phone, role")
    .eq("id", contactId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (readError || !current) return { error: "That contact no longer exists." };

  const patch: Record<string, Json> = {
    first_name: d.first_name ?? null,
    last_name: d.last_name ?? null,
    title: d.title ?? null,
    tier: d.tier ? Number(d.tier) : null,
    email,
    phone,
    phone_type: phoneTypeFor(phone),
    linkedin_url: linkedin,
  };
  // A changed address is not verified yet.
  if (email !== current.email) patch.email_status = email ? "unknown" : null;
  if (d.role && d.role !== current.role) {
    patch.role = d.role;
    if (d.role === "main") patch.is_primary = true;
  }

  const { error } = await supabase.rpc("sales_update", {
    p_entity: "contact",
    p_ids: [contactId],
    p_fields: patch as Json,
    p_source: "handmatig",
  });
  if (error) return { error: friendly(error.message) };
  revalidateLead(companyId);
  return { ok: true, message: "Contact saved." };
}

/** Delete a contact for good (a wrong or double entry). The deletion stays in the timeline. */
export async function deleteContactAction(companyId: string, contactId: string): Promise<ActionState> {
  await requireModule("sales");
  if (!uuid.safeParse(companyId).success || !uuid.safeParse(contactId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, title, email, role")
    .eq("id", contactId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!contact) return { error: "That contact no longer exists." };
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email || "Contact";

  const { error } = await supabase.from("contacts").delete().eq("id", contactId);
  if (error) return { error: friendly(error.message) };

  await supabase.rpc("sales_log_activity", {
    p_company: companyId,
    p_contact: null,
    p_channel: "system",
    p_type: "system",
    p_notes: `Contact deleted: ${name}${contact.title ? `, ${contact.title}` : ""}`,
    p_source: "handmatig",
  });

  // The main contact is gone: the best of the rest takes over.
  if (contact.role === "main") {
    const { data: rest } = await supabase
      .from("contacts")
      .select("id, role, tier")
      .eq("company_id", companyId)
      .not("role", "eq", "main")
      .order("role", { ascending: false })
      .order("tier", { ascending: true, nullsFirst: false })
      .limit(1);
    const next = rest?.[0];
    if (next) {
      await supabase.rpc("sales_update", {
        p_entity: "contact",
        p_ids: [next.id],
        p_fields: { role: "main", is_primary: true } as Json,
        p_source: "handmatig",
      });
    }
  }
  revalidateLead(companyId);
  return { ok: true, message: `${name} deleted.` };
}

const flagsSchema = z.object({
  mail: z.boolean(),
  call: z.boolean(),
  linkedin: z.boolean(),
  flag: z.enum(["left_company", "wrong_person", "wrong_number"]).nullable(),
});

/**
 * Which channels may be used for a contact, and whether the contact is marked
 * as left the company, wrong person or wrong number. Switched off means not in
 * a mail campaign, not on a call list.
 */
export async function setContactChannelsAction(
  companyId: string,
  contactId: string,
  input: z.input<typeof flagsSchema>,
): Promise<ActionState> {
  await requireModule("sales");
  const parsed = flagsSchema.safeParse(input);
  if (!uuid.safeParse(companyId).success || !uuid.safeParse(contactId).success || !parsed.success) return { error: GENERIC_ERROR };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("sales_set_contact_flags", {
    p_contact: contactId,
    p_fields: { no_mail: !v.mail, no_call: !v.call, no_linkedin: !v.linkedin, contact_flag: v.flag } as Json,
    p_source: "handmatig",
  });
  if (error) return { error: friendly(error.message) };
  revalidateLead(companyId);
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------
// Company: own contact, delete
// ---------------------------------------------------------------------------

/** Switch the own contact protection on or off (partners, network, clients). */
export async function setOwnContactAction(companyId: string, value: boolean, reason?: string): Promise<ActionState> {
  await requireModule("sales");
  if (!uuid.safeParse(companyId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sales_set_own_contact", {
    p_company: companyId,
    p_value: value,
    p_reason: reason?.trim().slice(0, 500) || null,
    p_source: "handmatig",
  });
  if (error) return { error: friendly(error.message) };
  revalidateLead(companyId);
  return {
    ok: true,
    message: value ? "Own contact: this company never goes into cold outreach." : "No longer an own contact.",
  };
}

export type DeleteLeadsResult = { ok: true; message: string; deleted: number; kept: { id: string; name: string; reason: string }[] } | { ok: false; error: string };

/**
 * Delete leads that were made by mistake. A lead that has been approached
 * (a call, mail, reply or meeting), is in the pipeline or is linked to a
 * client is kept: park it or send it to No go instead. Contacts, signals and
 * the timeline of a deleted lead go with it.
 */
export async function deleteLeadsAction(ids: string[]): Promise<DeleteLeadsResult> {
  await requireModule("sales");
  const parsed = z.array(uuid).min(1).max(200).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Select at least one lead." };
  const supabase = await createClient();
  const checked = await classifyLeadsForDelete(supabase, parsed.data);
  if (!checked.ok) return { ok: false, error: GENERIC_ERROR };
  const { kept } = checked;
  const deletable = checked.deletable.map((c) => c.id);

  if (deletable.length > 0) {
    const { error: deleteError } = await supabase.from("companies").delete().in("id", deletable);
    if (deleteError) return { ok: false, error: friendly(deleteError.message) };
  }
  revalidatePath("/dashboard/leads", "layout");
  revalidatePath("/dashboard/contacts", "layout");
  revalidatePath("/dashboard/inbox");

  const parts = [`${deletable.length} ${deletable.length === 1 ? "lead" : "leads"} deleted.`];
  if (kept.length) parts.push(`${kept.length} kept: ${kept.slice(0, 3).map((k) => `${k.name} (${k.reason})`).join(", ")}${kept.length > 3 ? ", ..." : ""}.`);
  if (deletable.length === 0) return { ok: false, error: parts.join(" ") };
  return { ok: true, message: parts.join(" "), deleted: deletable.length, kept };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30.")
  .optional();

const signalSchema = z.object({
  title: z.string().min(1, "Enter a title.").max(300, "Use at most 300 characters."),
  source_url: optional(1000),
  description: optional(20000),
  closed: z.string().optional(),
  posted_at: dateField,
  valid_until: dateField,
});

const newSignalSchema = signalSchema.extend({
  type: z.string().regex(/^[a-z0-9_]{1,40}$/, "Pick a kind of signal."),
});

/** A signal added by hand on the lead page (leadregels, deel 4): the score follows at once. */
export async function addSignalAction(companyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("sales");
  if (!uuid.safeParse(companyId).success) return { error: GENERIC_ERROR };
  const parsed = newSignalSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  if (d.source_url && !/^https?:\/\/\S+$/i.test(d.source_url)) {
    return { error: CHECK_FIELDS, fieldErrors: { source_url: "Use a link that starts with https://." } };
  }
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("signals").insert({
    company_id: companyId,
    // Any kind of the Signal types list; the database checks the format.
    type: d.type as SignalType,
    title: d.title,
    source: "overig",
    source_url: d.source_url ?? null,
    description: d.description ?? null,
    posted_at: d.posted_at ?? null,
    valid_until: d.valid_until ?? null,
    dedupe_key: `manual:${companyId}:${crypto.randomUUID()}`,
    first_seen_at: now,
    last_seen_at: now,
  });
  if (error) return { error: friendly(error.message) };
  revalidateLead(companyId);
  return { ok: true, message: "Signal added. The score is computed again." };
}

export async function updateSignalAction(
  companyId: string,
  signalId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireModule("sales");
  if (!uuid.safeParse(companyId).success || !uuid.safeParse(signalId).success) return { error: GENERIC_ERROR };
  const parsed = signalSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  if (d.source_url && !/^https?:\/\/\S+$/i.test(d.source_url)) {
    return { error: CHECK_FIELDS, fieldErrors: { source_url: "Use a link that starts with https://." } };
  }
  const supabase = await createClient();
  const { data: current } = await supabase.from("signals").select("closed_at").eq("id", signalId).eq("company_id", companyId).maybeSingle();
  if (!current) return { error: "That signal no longer exists." };
  const closed = d.closed === "on";
  const { error } = await supabase
    .from("signals")
    .update({
      title: d.title,
      source_url: d.source_url ?? null,
      description: d.description ?? null,
      closed_at: closed ? (current.closed_at ?? new Date().toISOString()) : null,
      ...(d.posted_at !== undefined ? { posted_at: d.posted_at } : {}),
      valid_until: d.valid_until ?? null,
    })
    .eq("id", signalId)
    .eq("company_id", companyId);
  if (error) return { error: friendly(error.message) };
  revalidateLead(companyId);
  return { ok: true, message: "Signal saved." };
}

export async function deleteSignalAction(companyId: string, signalId: string): Promise<ActionState> {
  await requireModule("sales");
  if (!uuid.safeParse(companyId).success || !uuid.safeParse(signalId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("signals").delete().eq("id", signalId).eq("company_id", companyId);
  if (error) return { error: friendly(error.message) };
  revalidateLead(companyId);
  return { ok: true, message: "Signal deleted." };
}
