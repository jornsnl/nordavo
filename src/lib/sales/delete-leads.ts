import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * The safety checks for deleting leads that were made by mistake, shared by
 * the portal (deleteLeadsAction) and the MCP (delete_company). A lead that has
 * been approached (a call, mail, reply or meeting), is in the pipeline or is
 * linked to a client is kept: park it or send it to No go instead.
 */

export type KeptLead = { id: string; name: string; reason: string };
export type DeletableLead = { id: string; name: string };

export async function classifyLeadsForDelete(
  db: SupabaseClient<Database>,
  ids: string[],
): Promise<{ ok: true; deletable: DeletableLead[]; kept: KeptLead[]; missing: string[] } | { ok: false }> {
  const unique = [...new Set(ids)];
  const [{ data: companies, error }, { data: contacted }, { data: meetings }] = await Promise.all([
    db.from("companies").select("id, name, pipeline_stage, client_id").in("id", unique),
    db.from("activities").select("company_id").in("company_id", unique).in("type", ["contact", "reply", "meeting"]),
    db.from("meetings").select("company_id").in("company_id", unique),
  ]);
  if (error || !companies) return { ok: false };
  const approached = new Set([...(contacted ?? []), ...(meetings ?? [])].map((r) => r.company_id));

  const kept: KeptLead[] = [];
  const deletable: DeletableLead[] = [];
  for (const c of companies) {
    if (c.pipeline_stage) kept.push({ id: c.id, name: c.name, reason: "In the pipeline" });
    else if (c.client_id) kept.push({ id: c.id, name: c.name, reason: "Linked to a client" });
    else if (approached.has(c.id)) kept.push({ id: c.id, name: c.name, reason: "Already approached: send it to No go instead" });
    else deletable.push({ id: c.id, name: c.name });
  }
  const found = new Set(companies.map((c) => c.id));
  return { ok: true, deletable, kept, missing: unique.filter((id) => !found.has(id)) };
}
