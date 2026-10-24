import "server-only";
import { requireStaff } from "@/lib/auth";
import type { SuppressionReason, SuppressionScope } from "@/lib/database.types";
import { suppressionReasons, suppressionScopes } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export function isSuppressionReason(value: unknown): value is SuppressionReason {
  return suppressionReasons.some((r) => r.value === value);
}

export function isSuppressionScope(value: unknown): value is SuppressionScope {
  return suppressionScopes.some((s) => s.value === value);
}

export type SuppressionItem = {
  id: string;
  reason: SuppressionReason;
  scope: SuppressionScope;
  email: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  company: { id: string; name: string; domain: string } | null;
  contact: { id: string; name: string; email: string | null; companyName: string | null } | null;
};

/** The newest rows we search through in the app. Older rows stay active in every export. */
export const SUPPRESSION_LIST_LIMIT = 1000;

export async function listSuppressions({
  q,
  reason,
  scope,
}: {
  q?: string;
  reason?: SuppressionReason;
  scope?: SuppressionScope;
}): Promise<{ items: SuppressionItem[]; total: number }> {
  await requireStaff();
  const supabase = await createClient();
  let query = supabase
    .from("suppression")
    .select(
      "id, reason, scope, email, notes, created_at, company:companies(id, name, domain), contact:contacts(id, first_name, last_name, email, company:companies(name)), creator:profiles!suppression_created_by_fkey(full_name, email)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(SUPPRESSION_LIST_LIMIT);
  if (reason) query = query.eq("reason", reason);
  if (scope) query = query.eq("scope", scope);
  const { data, error, count } = await query;
  if (error) throw new Error(`Uitsluitingen laden mislukt: ${error.message}`);

  const items: SuppressionItem[] = data.map((row) => {
    const company = Array.isArray(row.company) ? row.company[0] : row.company;
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
    const contactCompany = contact ? (Array.isArray(contact.company) ? contact.company[0] : contact.company) : null;
    const creator = Array.isArray(row.creator) ? row.creator[0] : row.creator;
    return {
      id: row.id,
      reason: row.reason,
      scope: row.scope,
      email: row.email,
      notes: row.notes,
      createdAt: row.created_at,
      createdBy: creator ? creator.full_name || creator.email : null,
      company: company ? { id: company.id, name: company.name, domain: company.domain } : null,
      contact: contact
        ? {
            id: contact.id,
            name: [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email || "Onbekend",
            email: contact.email,
            companyName: contactCompany?.name ?? null,
          }
        : null,
    };
  });

  const needle = q?.trim().toLowerCase();
  const filtered = needle
    ? items.filter((i) =>
        [i.email, i.notes, i.company?.name, i.company?.domain, i.contact?.name, i.contact?.email, i.contact?.companyName]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(needle)),
      )
    : items;
  return { items: filtered, total: count ?? items.length };
}
