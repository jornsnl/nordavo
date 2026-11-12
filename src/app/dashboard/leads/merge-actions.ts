"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModule } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import type { CompanyOption } from "@/lib/data/sequences";
import type { MergeResult } from "@/lib/sales/leads-database";
import { createClient } from "@/lib/supabase/server";

/*
 * Merging two companies or two contacts without losing anything
 * (sales_merge_companies / sales_merge_contacts, migration
 * 20261123320000_leads_duplicates_merge.sql). The record of the page stays;
 * the other one is merged into it and deleted, its full row stays in
 * Activities.
 */

const uuid = z.guid();

function revalidateSales(companyId: string) {
  revalidatePath("/dashboard/leads", "layout");
  revalidatePath("/dashboard/contacts", "layout");
  revalidatePath("/dashboard/pipeline", "layout");
  revalidatePath(`/dashboard/leads/${companyId}`);
}

function friendly(message: string) {
  if (/No access to sales/.test(message)) return "You need the Sales module to merge.";
  if (/two different/.test(message)) return "Pick another record than this one.";
  if (/not found/.test(message)) return "That record no longer exists.";
  return "The merge did not go through. Nothing was changed.";
}

/** Every company (also No go and Do not contact) by name or domain, for the merge picker. */
export async function searchMergeCompanies(query: string): Promise<CompanyOption[]> {
  await requireModule("sales");
  const supabase = await createClient();
  const cleaned = (typeof query === "string" ? query : "").replace(/[,()"'*:%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!cleaned) return [];
  const { data } = await supabase
    .from("companies")
    .select("id, name, domain, lead_status, city")
    .or(`name.ilike.%${cleaned}%,domain.ilike.%${cleaned}%`)
    .order("name")
    .limit(20);
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, domain: c.domain, leadStatus: c.lead_status, city: c.city }));
}

export async function mergeCompaniesAction(keepId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("sales");
  const mergeId = formData.getAll("merge_id").map(String).find(Boolean) ?? "";
  if (!uuid.safeParse(keepId).success || !uuid.safeParse(mergeId).success) {
    return { error: "Pick the company to merge into this one.", fieldErrors: { merge_id: "Pick a company." } };
  }
  if (formData.get("confirm") !== "on") {
    return { error: "Tick the box to confirm. The other company is deleted after the merge.", fieldErrors: { confirm: "Confirm the merge." } };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sales_merge_companies", { p_keep: keepId, p_merge: mergeId });
  if (error) return { error: friendly(error.message) };
  const result = data as unknown as MergeResult;
  revalidateSales(keepId);
  return {
    ok: true,
    message: `Merged. ${result.contacts_moved ?? 0} contacts and ${result.references_moved} other records moved${
      result.filled_in.length ? `, ${result.filled_in.length} empty fields filled in` : ""
    }.`,
  };
}

export async function mergeContactsAction(companyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("sales");
  const keepId = String(formData.get("keep_id") ?? "");
  const mergeId = String(formData.get("merge_id") ?? "");
  if (!uuid.safeParse(keepId).success) return { error: "Pick the contact that stays.", fieldErrors: { keep_id: "Pick a contact." } };
  if (!uuid.safeParse(mergeId).success) return { error: "Pick the duplicate.", fieldErrors: { merge_id: "Pick a contact." } };
  if (keepId === mergeId) return { error: "Pick two different contacts.", fieldErrors: { merge_id: "Pick another contact." } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sales_merge_contacts", { p_keep: keepId, p_merge: mergeId });
  if (error) return { error: friendly(error.message) };
  const result = data as unknown as MergeResult;
  revalidateSales(companyId);
  return {
    ok: true,
    message: `Contacts merged. ${result.references_moved} records moved${result.filled_in.length ? `, ${result.filled_in.length} empty fields filled in` : ""}.`,
  };
}
