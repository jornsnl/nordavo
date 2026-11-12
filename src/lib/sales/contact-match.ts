import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { likeExact } from "@/lib/gtm/manual";
import { nameMatchAllowed, type PersonKeys } from "@/lib/sales/contact-keys";

type Db = SupabaseClient<Database>;

export type MatchedBy = "linkedin" | "member_id" | "email" | "name";

/**
 * The contact that is this person: the same LinkedIn link anywhere, the same
 * member id anywhere, the same email at this company, or the same first and
 * last name at this company (unless their LinkedIn says otherwise). Used by
 * the MCP, the gtm upsert and the portal forms.
 */
export async function findSalesContact<F extends string>(
  db: Db,
  companyId: string | null,
  keys: PersonKeys,
  fields: F,
): Promise<{ row: Record<string, unknown> & { id: string; company_id: string; linkedin_url: string | null; linkedin_member_urn: string | null }; by: MatchedBy } | null> {
  const select = `id, company_id, linkedin_url, linkedin_member_urn, ${fields}`;
  type Row = Record<string, unknown> & { id: string; company_id: string; linkedin_url: string | null; linkedin_member_urn: string | null };
  const one = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as Row | null) ?? null;
  };

  if (keys.linkedinKey) {
    const row = await one(db.from("contacts").select(select).eq("linkedin_key", keys.linkedinKey).limit(1).maybeSingle());
    if (row) return { row, by: "linkedin" };
  }
  if (keys.memberUrn) {
    const row = await one(db.from("contacts").select(select).ilike("linkedin_member_urn", likeExact(keys.memberUrn)).limit(1).maybeSingle());
    if (row) return { row, by: "member_id" };
  }
  if (!companyId) return null;
  if (keys.email) {
    const row = await one(db.from("contacts").select(select).eq("company_id", companyId).eq("email", keys.email).limit(1).maybeSingle());
    if (row) return { row, by: "email" };
  }
  if (keys.first) {
    let q = db.from("contacts").select(select).eq("company_id", companyId).ilike("first_name", likeExact(keys.first));
    q = keys.last ? q.ilike("last_name", likeExact(keys.last)) : q.is("last_name", null);
    const { data, error } = await q.limit(5);
    if (error) throw new Error(error.message);
    const hit = ((data ?? []) as unknown as Row[]).find((r) => nameMatchAllowed(r, keys));
    if (hit) return { row: hit, by: "name" };
  }
  return null;
}
