import "server-only";
import { z } from "zod";
import type { CallContactResult } from "@/lib/sales/call-screen-database";
import type { CallActor, CallContactPerson } from "@/lib/sales/call-session";

// Changing contacts on the call screen (feedback Julius, 7200c28b): name, job
// title, mobile number and mail, marking a number as wrong, and adding a
// contact. Every write is one of the three functions of
// 20261124300000_call_screen_contacts.sql, which check what a caller may do
// (only a company where they hold a contact, only these fields). Shared by
// the team (session client) and external callers (secret key client with
// p_actor, after requireCaller()).

const text = (max: number) => z.string().trim().max(max, { error: `Use at most ${max} characters.` }).nullish();

export const personInputSchema = z
  .object({
    firstName: text(100),
    lastName: text(100),
    title: text(200),
    phone: text(50),
    email: text(320),
  })
  .refine((v) => Boolean(v.firstName?.trim() || v.lastName?.trim()), { error: "A contact needs a name.", path: ["firstName"] })
  .refine((v) => !v.phone?.trim() || /^[0-9+()./ -]{5,50}$/.test(v.phone.trim()), {
    error: "That number does not look right.",
    path: ["phone"],
  })
  .refine((v) => !v.email?.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim()), {
    error: "That mail address does not look right.",
    path: ["email"],
  });

export type PersonInput = z.input<typeof personInputSchema>;

export type ContactEdit = { ok: true; person: CallContactPerson } | { ok: false; error: string };

function toPerson(r: CallContactResult): CallContactPerson {
  const name = r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "Unknown contact";
  return {
    id: r.id,
    name,
    firstName: r.first_name,
    lastName: r.last_name,
    title: r.title,
    phone: r.phone,
    phoneWrong: Boolean(r.phone_wrong_at),
    email: r.email,
  };
}

function failure(where: string, error: { code?: string; message: string }): ContactEdit {
  console.error(where, error.code, error.message);
  // The functions raise readable messages for what a person can fix (22023, 23505) and for missing rights (42501).
  if (error.code === "22023" || error.code === "23505") return { ok: false, error: error.message };
  if (error.code === "42501") return { ok: false, error: "Open a contact of this company on the call screen first." };
  if (/does not exist|schema cache/i.test(error.message)) return { ok: false, error: "Apply the latest database migrations first." };
  return { ok: false, error: "The change was not saved. Please try again." };
}

const clean = (v: string | null | undefined) => v?.trim() || null;

/** Saves name, job title, mobile number and mail of a contact. */
export async function updateCallContact(actor: CallActor, contactId: string, input: PersonInput): Promise<ContactEdit> {
  const id = z.guid().safeParse(contactId);
  const parsed = personInputSchema.safeParse(input);
  if (!id.success) return { ok: false, error: "Unknown contact." };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  const v = parsed.data;
  const { data, error } = await actor.db.rpc("sales_caller_update_contact", {
    p_contact: id.data,
    p_first_name: clean(v.firstName),
    p_last_name: clean(v.lastName),
    p_title: clean(v.title),
    p_phone: clean(v.phone),
    p_email: clean(v.email),
    p_actor: actor.pActor,
  });
  if (error || !data) return failure("updateCallContact", error ?? { message: "no data" });
  return { ok: true, person: toPerson(data) };
}

/** Marks the mobile number of a contact as wrong, or takes the mark away. */
export async function markCallPhone(actor: CallActor, contactId: string, wrong: boolean): Promise<ContactEdit> {
  const id = z.guid().safeParse(contactId);
  if (!id.success) return { ok: false, error: "Unknown contact." };
  const { data, error } = await actor.db.rpc("sales_caller_mark_phone", {
    p_contact: id.data,
    p_wrong: wrong,
    p_actor: actor.pActor,
  });
  if (error || !data) return failure("markCallPhone", error ?? { message: "no data" });
  return { ok: true, person: toPerson(data) };
}

/** Adds a contact at a company the caller is calling. */
export async function addCallContact(actor: CallActor, companyId: string, input: PersonInput): Promise<ContactEdit> {
  const id = z.guid().safeParse(companyId);
  const parsed = personInputSchema.safeParse(input);
  if (!id.success) return { ok: false, error: "Unknown company." };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  const v = parsed.data;
  const { data, error } = await actor.db.rpc("sales_caller_add_contact", {
    p_company: id.data,
    p_first_name: clean(v.firstName),
    p_last_name: clean(v.lastName),
    p_title: clean(v.title),
    p_phone: clean(v.phone),
    p_email: clean(v.email),
    p_actor: actor.pActor,
  });
  if (error || !data) return failure("addCallContact", error ?? { message: "no data" });
  return { ok: true, person: toPerson(data) };
}
