/**
 * Possible duplicate companies: the same name with another domain
 * ("Brightcape" on brightcape.nl and brightcape.com). Pure; mirrors the SQL
 * functions company_name_key and domain_stem
 * (migration 20261123320000_leads_duplicates_merge.sql), which the database
 * uses in sales_similar_companies().
 */

const LEGAL_WORDS =
  /(^|[^a-z0-9])(b\.?\s?v\.?|n\.?\s?v\.?|v\.?o\.?f\.?|holding|group|groep|nederland|netherlands|benelux|europe|international|nl|the|de|het|gmbh|ltd|limited|inc|llc|bvba|sa|ag)(?=$|[^a-z0-9])/g;

/** "Brightcape B.V." -> "brightcape"; "The Data Company Nederland" -> "datacompany". */
export function companyNameKey(name: string | null | undefined): string | null {
  const key = (name ?? "")
    .toLowerCase()
    .replace(LEGAL_WORDS, " ")
    .replace(/[^a-z0-9]+/g, "");
  return key || null;
}

/** "app.brightcape.co.uk" -> "brightcape"; "brightcape.nl" -> "brightcape". */
export function domainStem(domain: string | null | undefined): string | null {
  if (!domain || domain.startsWith("nodomain:")) return null;
  const m = /([a-z0-9-]+)\.(?:co\.uk|org\.uk|com\.au|co\.nz|com\.br|co\.za|[a-z0-9-]+)$/.exec(domain.toLowerCase());
  return m?.[1] || null;
}

export type SimilarCompany = { id: string; name: string; domain: string; lead_status: string; reason: string };

/** "Possible duplicate: Brightcape (brightcape.com, same name)". */
export function duplicateWarning(list: SimilarCompany[]): string | null {
  if (list.length === 0) return null;
  const names = list.slice(0, 3).map((c) => `${c.name} (${c.domain.startsWith("nodomain:") ? "no website" : c.domain}, ${c.reason})`);
  const more = list.length > 3 ? ` and ${list.length - 3} more` : "";
  return `Possible duplicate of ${names.join(", ")}${more}. Check it, and merge the two on the lead page if they are the same company.`;
}
