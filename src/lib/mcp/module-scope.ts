import type { PortalModule } from "@/lib/database.types";
import { moduleForEntity } from "@/lib/modules";

/**
 * Who sees what (2.5) for the MCP server. The MCP route reads with the secret
 * key, so RLS (public.has_module) does not apply there: this wrapper does the
 * same split in code. Every db.from(table) of a module the token owner lacks
 * answers with an error, and notes, tasks, attachments and the activity log
 * are filtered to the record types the owner may see.
 *
 * Keep tableModules in line with the RLS policies of the migrations. New
 * tables of a module belong in this list. Embedded resources in a select
 * (vacancies with company:companies(name)) are not filtered; the RLS split
 * allows reading client names from recruitment too, and a GTM company name
 * next to a vacancy is the only thing that can show up that way.
 */
export const tableModules: Record<string, PortalModule[]> = {
  // Sales (GTM).
  companies: ["sales"],
  contacts: ["sales"],
  signals: ["sales"],
  campaigns: ["sales"],
  activities: ["sales"],
  suppression: ["sales"],
  list_exports: ["sales"],
  call_list_candidates: ["sales"],
  mail_list_candidates: ["sales"],
  appointment_attribution: ["sales"],
  partners: ["sales"],
  callers: ["sales"],
  meetings: ["sales"],
  sequences: ["sales"],
  sequence_steps: ["sales"],
  sequence_enrollments: ["sales"],
  sequence_tasks: ["sales"],
  sales_views: ["sales"],
  call_list_callers: ["sales"],
  // Recruitment.
  vacancies: ["recruitment"],
  candidates: ["recruitment"],
  applications: ["recruitment"],
  placements: ["recruitment"],
  placement_checkins: ["recruitment"],
  matches: ["recruitment"],
  anonymous_profiles: ["recruitment"],
  application_stage_events: ["recruitment"],
  interviews: ["recruitment"],
  // Clients: names are readable from recruitment and sales as well.
  clients: ["clients", "recruitment", "sales"],
  client_contacts: ["clients", "recruitment"],
};

/** Tables with entity_type/entity_id; work_task_links holds the record of a Work task. */
const polymorphicTables = new Set(["work_task_links", "notes", "attachments", "activity_log"]);

const moduleLabels: Record<PortalModule, string> = {
  sales: "Sales",
  recruitment: "Recruitment",
  clients: "Clients",
  report: "Report",
  academy: "Academy",
};

/** The module a table belongs to; every academy_* table is Academy. */
export function modulesForTable(table: string): PortalModule[] | undefined {
  return tableModules[table] ?? (table.startsWith("academy_") ? ["academy"] : undefined);
}

type QueryResult = {
  data: null;
  error: { message: string; code: string; details: string; hint: string };
  count: null;
  status: number;
  statusText: string;
};

/** A query builder that accepts any chain and resolves to an access error. */
function deniedQuery(message: string): unknown {
  const result: QueryResult = {
    data: null,
    error: { message, code: "42501", details: "", hint: "" },
    count: null,
    status: 403,
    statusText: "Forbidden",
  };
  const query: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
      }
      return () => query;
    },
    apply() {
      return query;
    },
  });
  return query;
}

export function accessError(modules: PortalModule[]): string {
  return `No access: this account does not have the ${modules.map((m) => moduleLabels[m]).join(" or ")} module. An admin can add it under Settings, Users.`;
}

/** Entity types this user may not see, for a NOT IN filter. */
function hiddenEntityTypes(modules: readonly PortalModule[]): string[] {
  return ["client", "vacancy", "candidate", "application", "placement", "company"].filter((type) => {
    const mod = moduleForEntity(type);
    return mod !== null && !modules.includes(mod);
  });
}

type Filterable = { or: (filter: string) => unknown };
type FromBuilder = Record<string, (...args: unknown[]) => unknown>;

/** Tasks without a record stay visible; a bare NOT IN would drop the null rows. */
function entityFilter(hidden: string[]): string {
  return `entity_type.is.null,entity_type.not.in.(${hidden.join(",")})`;
}

/** Wrap a Supabase client (or anything with from()) so it only reaches the user's modules. */
export function scopeDbToModules<D extends object>(db: D, modules: readonly PortalModule[]): D {
  const hidden = hiddenEntityTypes(modules);

  const from = (table: string): unknown => {
    const needs = modulesForTable(table);
    if (needs && !needs.some((module) => modules.includes(module))) {
      return deniedQuery(accessError(needs));
    }
    const builder = (db as unknown as { from: (t: string) => FromBuilder }).from(table);
    if (!polymorphicTables.has(table) || hidden.length === 0) return builder;

    const filter = entityFilter(hidden);
    return new Proxy(builder, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        if (prop === "select" || prop === "update" || prop === "delete") {
          return (...args: unknown[]) => (value.apply(target, args) as Filterable).or(filter);
        }
        if (prop === "insert" || prop === "upsert") {
          return (values: unknown, ...rest: unknown[]) => {
            const rows = (Array.isArray(values) ? values : [values]) as { entity_type?: string | null }[];
            const blocked = rows.find((row) => row?.entity_type && hidden.includes(row.entity_type));
            if (blocked) {
              const mod = moduleForEntity(blocked.entity_type);
              return deniedQuery(accessError(mod ? [mod] : []));
            }
            return value.apply(target, [values, ...rest]);
          };
        }
        return value.bind(target);
      },
    });
  };

  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "from") return from;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
