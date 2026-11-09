"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR } from "@/lib/action-state";
import { requireAdmin, requireModule } from "@/lib/auth";
import { roundRobinByCompany } from "@/lib/sales/assign";
import { createClient } from "@/lib/supabase/server";

// Opening lists, companies and loose contacts for external callers
// (feedback Julius, section 2.10). Only admins manage callers and what is
// open for them (RLS: admins manage call_list_callers; sales_update checks
// the caller is active); internal users may still call every list themselves.

const ids = z.array(z.guid()).max(5000);
const until = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform((v) => v || null);

function revalidate() {
  revalidatePath("/dashboard/call-lists");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/leads");
}

async function assign(contacts: { id: string; company_id: string }[], callerIds: string[], untilDate: string | null): Promise<ActionState> {
  if (contacts.length === 0) return { error: "Select at least one contact." };
  const supabase = await createClient();
  const { data: active, error: callersError } = await supabase
    .from("callers")
    .select("id, name")
    .in("id", callerIds)
    .eq("status", "active");
  if (callersError) return { error: GENERIC_ERROR };
  const activeIds = callerIds.filter((id) => (active ?? []).some((c) => c.id === id));
  if (activeIds.length === 0) return { error: "Pick at least one active caller." };

  const plan = roundRobinByCompany(contacts, activeIds);
  let count = 0;
  for (const [callerId, contactIds] of plan) {
    for (let i = 0; i < contactIds.length; i += 500) {
      const { data, error } = await supabase.rpc("sales_update", {
        p_entity: "contact",
        p_ids: contactIds.slice(i, i + 500),
        p_fields: { assigned_caller_id: callerId, assigned_until: untilDate },
      });
      if (error) {
        console.error("assign callers", error.code, error.message);
        return { error: error.message || GENERIC_ERROR };
      }
      count += data ?? 0;
    }
  }
  revalidate();
  const names = (active ?? []).filter((c) => activeIds.includes(c.id)).map((c) => c.name).join(", ");
  return { ok: true, message: `${count} ${count === 1 ? "contact" : "contacts"} open for ${names}${untilDate ? ` until ${untilDate}` : ""}.` };
}

/** Loose contacts for one or more callers until a date, round robin by company. */
export async function assignContactsToCallers(contactIds: string[], callerIds: string[], untilDate: string | null): Promise<ActionState> {
  await requireAdmin();
  const parsed = z.object({ contactIds: ids, callerIds: ids.min(1), until }).safeParse({ contactIds, callerIds, until: untilDate });
  if (!parsed.success) return { error: "Pick at least one caller and check the date." };
  const supabase = await createClient();
  const contacts: { id: string; company_id: string }[] = [];
  for (let i = 0; i < parsed.data.contactIds.length; i += 500) {
    const { data, error } = await supabase.from("contacts").select("id, company_id").in("id", parsed.data.contactIds.slice(i, i + 500));
    if (error) return { error: GENERIC_ERROR };
    contacts.push(...(data ?? []));
  }
  // Keep the order of the selection.
  const order = new Map(parsed.data.contactIds.map((id, i) => [id, i]));
  contacts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return assign(contacts, parsed.data.callerIds, parsed.data.until);
}

/** Every contact of these companies for one or more callers until a date. */
export async function assignCompaniesToCallers(companyIds: string[], callerIds: string[], untilDate: string | null): Promise<ActionState> {
  await requireAdmin();
  const parsed = z.object({ companyIds: ids, callerIds: ids.min(1), until }).safeParse({ companyIds, callerIds, until: untilDate });
  if (!parsed.success) return { error: "Pick at least one caller and check the date." };
  const supabase = await createClient();
  const contacts: { id: string; company_id: string }[] = [];
  for (let i = 0; i < parsed.data.companyIds.length; i += 500) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company_id, tier")
      .in("company_id", parsed.data.companyIds.slice(i, i + 500))
      .order("tier", { ascending: true, nullsFirst: false });
    if (error) return { error: GENERIC_ERROR };
    contacts.push(...(data ?? []));
  }
  if (contacts.length === 0) return { error: "These companies have no contacts yet." };
  const order = new Map(parsed.data.companyIds.map((id, i) => [id, i]));
  contacts.sort((a, b) => (order.get(a.company_id) ?? 0) - (order.get(b.company_id) ?? 0));
  return assign(contacts, parsed.data.callerIds, parsed.data.until);
}

/** Takes contacts away from their caller. */
export async function unassignContacts(contactIds: string[]): Promise<ActionState> {
  await requireAdmin();
  const parsed = ids.min(1).safeParse(contactIds);
  if (!parsed.success) return { error: "Select at least one contact." };
  const supabase = await createClient();
  let count = 0;
  for (let i = 0; i < parsed.data.length; i += 500) {
    const { data, error } = await supabase.rpc("sales_update", {
      p_entity: "contact",
      p_ids: parsed.data.slice(i, i + 500),
      p_fields: { assigned_caller_id: null, assigned_until: null },
    });
    if (error) {
      console.error("unassignContacts", error.code, error.message);
      return { error: error.message || GENERIC_ERROR };
    }
    count += data ?? 0;
  }
  revalidate();
  return { ok: true, message: `${count} ${count === 1 ? "contact is" : "contacts are"} no longer with a caller.` };
}

/** Gives back every contact assigned to one caller. */
export async function unassignCaller(callerId: string): Promise<ActionState> {
  await requireAdmin();
  if (!z.guid().safeParse(callerId).success) return { error: "Caller not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("contacts").select("id").eq("assigned_caller_id", callerId).limit(5000);
  if (error) return { error: GENERIC_ERROR };
  if (!data || data.length === 0) return { ok: true, message: "No contacts were assigned." };
  return unassignContacts(data.map((c) => c.id));
}

/** Opens a call list for exactly these callers until a date; unticked callers lose it. */
export async function setListCallers(viewId: string, callerIds: string[], untilDate: string | null): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ viewId: z.guid(), callerIds: ids, until }).safeParse({ viewId, callerIds, until: untilDate });
  if (!parsed.success) return { error: "Check the callers and the date." };
  const supabase = await createClient();
  const { data: view } = await supabase.from("sales_views").select("id, is_call_list").eq("id", parsed.data.viewId).maybeSingle();
  if (!view?.is_call_list) return { error: "This view is not a call list." };

  const { data: current, error } = await supabase.from("call_list_callers").select("caller_id").eq("view_id", view.id);
  if (error) return { error: GENERIC_ERROR };
  const keep = new Set(parsed.data.callerIds);
  const remove = (current ?? []).map((r) => r.caller_id).filter((id) => !keep.has(id));
  if (remove.length > 0) {
    const { error: deleteError } = await supabase.from("call_list_callers").delete().eq("view_id", view.id).in("caller_id", remove);
    if (deleteError) return { error: GENERIC_ERROR };
  }

  const existing = new Set((current ?? []).map((r) => r.caller_id));
  for (const callerId of parsed.data.callerIds) {
    if (existing.has(callerId)) {
      const { error: updateError } = await supabase
        .from("call_list_callers")
        .update({ open_until: parsed.data.until })
        .eq("view_id", view.id)
        .eq("caller_id", callerId);
      if (updateError) return { error: GENERIC_ERROR };
      continue;
    }
    // A new list goes to the end of the caller's order.
    const { data: last } = await supabase
      .from("call_list_callers")
      .select("position")
      .eq("caller_id", callerId)
      .order("position", { ascending: false })
      .limit(1);
    const { error: insertError } = await supabase.from("call_list_callers").insert({
      view_id: view.id,
      caller_id: callerId,
      open_until: parsed.data.until,
      position: (last?.[0]?.position ?? -1) + 1,
      opened_by: user.id,
    });
    if (insertError) {
      console.error("setListCallers", insertError);
      return { error: GENERIC_ERROR };
    }
  }
  revalidate();
  return {
    ok: true,
    message:
      parsed.data.callerIds.length === 0
        ? "The list is closed for every caller."
        : `Saved. Open for ${parsed.data.callerIds.length} ${parsed.data.callerIds.length === 1 ? "caller" : "callers"}.`,
  };
}

/** Moves a list up or down in the order one caller works through. */
export async function moveCallerList(callerId: string, viewId: string, direction: "up" | "down"): Promise<ActionState> {
  await requireAdmin();
  if (!z.guid().safeParse(callerId).success || !z.guid().safeParse(viewId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("call_list_callers")
    .select("view_id, position, created_at")
    .eq("caller_id", callerId)
    .order("position")
    .order("created_at");
  if (error || !data) return { error: GENERIC_ERROR };
  const order = data.map((r) => r.view_id);
  const from = order.indexOf(viewId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= order.length) return { ok: true };
  [order[from], order[to]] = [order[to], order[from]];
  return saveCallerOrder(callerId, order);
}

/** Saves the whole order of a caller's lists (dragging). */
export async function saveCallerOrder(callerId: string, viewIds: string[]): Promise<ActionState> {
  await requireAdmin();
  const parsed = z.object({ callerId: z.guid(), viewIds: ids }).safeParse({ callerId, viewIds });
  if (!parsed.success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  for (const [position, viewId] of parsed.data.viewIds.entries()) {
    const { error } = await supabase
      .from("call_list_callers")
      .update({ position })
      .eq("caller_id", parsed.data.callerId)
      .eq("view_id", viewId);
    if (error) return { error: GENERIC_ERROR };
  }
  revalidate();
  return { ok: true };
}

/** Closes one list for one caller. */
export async function closeCallerList(callerId: string, viewId: string): Promise<ActionState> {
  await requireAdmin();
  if (!z.guid().safeParse(callerId).success || !z.guid().safeParse(viewId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("call_list_callers").delete().eq("caller_id", callerId).eq("view_id", viewId);
  if (error) return { error: GENERIC_ERROR };
  revalidate();
  return { ok: true, message: "Closed." };
}

/** Marks a saved Contacts view as a call list, or back to a plain view. */
export async function setCallList(viewId: string, isCallList: boolean): Promise<ActionState> {
  await requireModule("sales");
  if (!z.guid().safeParse(viewId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_views")
    .update({ is_call_list: isCallList })
    .eq("id", viewId)
    .eq("entity", "contacts")
    .select("id");
  if (error || !data?.length) {
    console.error("setCallList", error);
    return { error: "This view could not be changed. Only shared views and your own can be changed." };
  }
  revalidate();
  return { ok: true, message: isCallList ? "This view is now a call list." : "This view is no longer a call list." };
}
