import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { nameKey } from "@/lib/recruitment/candidate-fields";
import { CandidateIndex, dedupeKeys } from "@/lib/screening/candidate-csv";
import { findExistingCandidates } from "@/lib/screening/import";

/**
 * Duplicate check for candidates (feedback round 3): before saving a new
 * candidate or importing a list, look for existing candidates with the
 * same email, phone, LinkedIn or name. Runs with the user's client.
 */

type Db = SupabaseClient<Database>;

export type CandidateDuplicate = { id: string; full_name: string; on: "email" | "phone" | "LinkedIn" | "name" };

export type NameMatch = { id: string; full_name: string; email: string | null; phone: string | null };

/** Existing candidates per name key (see nameKey). */
export async function findNameMatches(db: Db, names: (string | null | undefined)[]): Promise<Map<string, NameMatch[]>> {
  const keys = [...new Set(names.map(nameKey).filter((k): k is string => Boolean(k)))];
  const out = new Map<string, NameMatch[]>();
  if (keys.length === 0) return out;
  const { data, error } = await db.rpc("screening_find_candidates_by_name", { p_names: keys });
  if (error) throw new Error(`Could not look for candidates by name: ${error.message}`);
  for (const row of data ?? []) {
    const key = nameKey(row.full_name);
    if (!key) continue;
    out.set(key, [...(out.get(key) ?? []), row]);
  }
  return out;
}

/** Possible duplicates of one candidate, contact matches first. */
export async function findDuplicateCandidates(
  db: Db,
  c: { full_name: string; email: string | null; phone: string | null; linkedin_url: string | null },
): Promise<CandidateDuplicate[]> {
  const keys = dedupeKeys(c);
  const out: CandidateDuplicate[] = [];
  const seen = new Set<string>();
  if (keys.email || keys.phone || keys.linkedin) {
    const found = await findExistingCandidates(db, [keys]);
    const index = new CandidateIndex(found);
    const hit = index.find(keys);
    if (hit) {
      const { data } = await db.from("candidates").select("full_name").eq("id", hit.id).maybeSingle();
      out.push({ id: hit.id, full_name: data?.full_name ?? "Candidate", on: hit.on === "linkedin" ? "LinkedIn" : (hit.on as "email" | "phone") });
      seen.add(hit.id);
    }
  }
  const key = nameKey(c.full_name);
  if (key) {
    const byName = (await findNameMatches(db, [c.full_name])).get(key) ?? [];
    for (const m of byName) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ id: m.id, full_name: m.full_name, on: "name" });
    }
  }
  return out.slice(0, 5);
}
