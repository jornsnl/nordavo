import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { defaultChoiceLists, mergeAllChoices, type ChoiceLists } from "@/lib/sales/choices";
import type { OccupancyRow, SalesBucket } from "@/lib/sales/flow-database";
import { customKey, type CustomColumn } from "@/lib/sales/grid-extras";
import { groupOccupancy, isFree, occupancyText, type CompanyOccupancy } from "@/lib/sales/triage";

// Loaders for the extra columns of the sales tables, the choice lists and
// occupancy (feedback Julius, round 4). They read as the signed-in user, so
// row level security applies.

type Db = SupabaseClient<Database>;

async function all<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max = 30000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** The choice lists as the team set them up; the defaults when nothing is stored or the table is missing. */
export async function loadChoiceLists(db: Db): Promise<ChoiceLists> {
  const { data, error } = await db
    .from("sales_choice_options")
    .select("list_key, value, label, description, position, hidden, tone");
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("loadChoiceLists", error.message);
    return defaultChoiceLists;
  }
  return mergeAllChoices(data ?? []);
}

/** The own columns of the sales tables, in their order. */
export async function loadCustomColumns(db: Db, entities: ("company" | "contact")[]): Promise<CustomColumn[]> {
  if (entities.length === 0) return [];
  const { data, error } = await db
    .from("custom_field_definitions")
    .select("key, label, field_type, options, entity")
    .in("entity", entities)
    .is("archived_at", null)
    .order("position")
    .order("created_at");
  if (error) {
    console.error("loadCustomColumns", error.message);
    return [];
  }
  return (data ?? []).map((d) => ({
    entity: d.entity as "company" | "contact",
    key: d.key,
    label: d.label,
    fieldType: d.field_type,
    options: d.options ?? [],
  }));
}

/** Running and past occupancy per company (campaigns, sequences, call lists, callers). */
export async function loadOccupancy(db: Db, companyIds?: string[]): Promise<Map<string, CompanyOccupancy[]>> {
  if (companyIds && companyIds.length === 0) return new Map();
  if (companyIds && companyIds.length <= 200) {
    const { data, error } = await db.from("sales_occupancy").select("*").in("company_id", companyIds);
    if (error) {
      console.error("loadOccupancy", error.message);
      return new Map();
    }
    return groupOccupancy((data ?? []) as OccupancyRow[]);
  }
  try {
    const rows = await all<OccupancyRow>((from, to) => db.from("sales_occupancy").select("*").range(from, to) as never);
    return groupOccupancy(rows);
  } catch (e) {
    console.error("loadOccupancy", e);
    return new Map();
  }
}

type FlowCompany = {
  id: string;
  bucket: SalesBucket;
  source_list: string | null;
  prio_reason: string | null;
  followed_at: string | null;
  custom_fields: unknown;
};

function values(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/**
 * Puts the extra column values on the rows of a table: bucket, source list,
 * occupancy, free, prio reason, followed and the own columns. Rows are
 * copied; a table without the new columns (migration not applied) keeps its
 * rows as they are.
 */
export async function attachFlow<T extends { id: string }>(
  db: Db,
  kind: "companies" | "contacts" | "pipeline",
  rows: T[],
  customColumns: CustomColumn[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const companyOf = (row: T) => (kind === "contacts" ? (row as unknown as { company_id: string }).company_id : row.id);
  try {
    const [companies, contacts, occupancy] = await Promise.all([
      all<FlowCompany>(
        (from, to) =>
          db
            .from("companies")
            .select("id, bucket, source_list, prio_reason, followed_at, custom_fields")
            .order("id")
            .range(from, to) as never,
      ),
      kind === "contacts" && customColumns.some((c) => c.entity === "contact")
        ? all<{ id: string; custom_fields: unknown }>(
            (from, to) => db.from("contacts").select("id, custom_fields").order("id").range(from, to) as never,
          )
        : Promise.resolve([]),
      loadOccupancy(db),
    ]);
    const byCompany = new Map(companies.map((c) => [c.id, c]));
    const contactValues = new Map(contacts.map((c) => [c.id, values(c.custom_fields)]));
    const companyCols = customColumns.filter((c) => c.entity === "company");
    const contactCols = customColumns.filter((c) => c.entity === "contact");
    const prefix = kind === "contacts" ? "company_" : "";

    return rows.map((row) => {
      const company = byCompany.get(companyOf(row));
      const occ = occupancy.get(companyOf(row)) ?? [];
      const running = occ.filter((o) => o.active || o.repliedAt);
      const extra: Record<string, unknown> = {
        flow_bucket: company?.bucket ?? null,
        flow_source_list: company?.source_list ?? null,
        flow_occupancy: running.length ? running.map(occupancyText).join("; ") : null,
        flow_free: company ? isFree(company.bucket, occ) : false,
        [`${prefix}prio_reason`]: company?.prio_reason ?? null,
        [`${prefix}followed`]: Boolean(company?.followed_at),
      };
      const cv = values(company?.custom_fields);
      for (const c of companyCols) extra[customKey("company", c.key)] = cv[c.key] ?? null;
      if (kind === "contacts") {
        const own = contactValues.get(row.id) ?? {};
        for (const c of contactCols) extra[customKey("contact", c.key)] = own[c.key] ?? null;
      }
      return { ...row, ...extra };
    });
  } catch (e) {
    console.error("attachFlow", e);
    return rows;
  }
}
