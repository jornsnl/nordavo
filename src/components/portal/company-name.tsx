import { getPortalCompany } from "@/lib/data/portal";

/** The client company name for the top bar. */
export async function CompanyName() {
  const company = await getPortalCompany();
  if (!company) return null;
  return (
    <span className="truncate text-sm font-medium text-muted" title={company.name}>
      {company.name}
    </span>
  );
}
