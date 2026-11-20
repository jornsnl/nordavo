import {
  companyColumns,
  contactColumns,
  defaultCompanySort,
  defaultContactSort,
  defaultPipelineSort,
  pipelineColumns,
  type ColumnDef,
  type CompanyRow,
  type ContactRow,
} from "@/lib/sales/rows";
import type { ColumnFilter, SortRule } from "@/lib/sales/grid";
import { contactStatuses } from "@/lib/labels";
import { hiddenByDefaultLeadStatuses, leadStatuses, pipelineExits, pipelineFlow } from "@/lib/sales/labels";

// The three tables (Leads, Contacts with call lists, Pipeline) share one grid
// and one board. Functions cannot cross from server to client components,
// so the client picks its columns by kind.

export type GridKind = "companies" | "contacts" | "pipeline";
export type AnyRow = CompanyRow | ContactRow;

export type KindConfig = {
  columns: ColumnDef<AnyRow>[];
  defaultSort: SortRule[];
  /** Filters of the table without a saved view (Leads hides no go and do not contact, leadregels deel 5). */
  defaultFilters?: ColumnFilter[];
  /** The entity of the row itself (pin, manual order). */
  rowEntity: "company" | "contact";
  href: (row: AnyRow) => string;
  title: (row: AnyRow) => string;
  /** The id an edit of a column of this entity goes to. */
  idFor: (row: AnyRow, entity: "company" | "contact") => string;
  board: {
    field: string;
    key: string;
    columns: { value: string; label: string; tone: string; description?: string }[];
    /** Drop zones off to the side, reachable from every column (Lost, Parked). */
    exits?: { value: string; label: string; tone: string; description?: string }[];
  };
  noun: string;
};

const companyHref = (row: AnyRow) => `/dashboard/leads/${(row as CompanyRow).id}`;

export const kinds: Record<GridKind, KindConfig> = {
  companies: {
    columns: companyColumns as ColumnDef<AnyRow>[],
    defaultSort: defaultCompanySort,
    defaultFilters: [{ column: "lead_status", op: "not_in", value: [...hiddenByDefaultLeadStatuses] }],
    rowEntity: "company",
    href: companyHref,
    title: (row) => (row as CompanyRow).name,
    idFor: (row) => row.id,
    board: { field: "lead_status", key: "lead_status", columns: leadStatuses },
    noun: "companies",
  },
  pipeline: {
    columns: pipelineColumns as ColumnDef<AnyRow>[],
    defaultSort: defaultPipelineSort,
    rowEntity: "company",
    href: companyHref,
    title: (row) => (row as CompanyRow).name,
    idFor: (row) => row.id,
    board: { field: "pipeline_stage", key: "pipeline_stage", columns: pipelineFlow, exits: pipelineExits },
    noun: "companies",
  },
  contacts: {
    columns: contactColumns as ColumnDef<AnyRow>[],
    defaultSort: defaultContactSort,
    rowEntity: "contact",
    href: (row) => `/dashboard/leads/${(row as ContactRow).company_id}#contact-${row.id}`,
    title: (row) => (row as ContactRow).full_name || (row as ContactRow).email || "Unnamed contact",
    idFor: (row, entity) => (entity === "company" ? (row as ContactRow).company_id : row.id),
    board: { field: "status", key: "status", columns: contactStatuses },
    noun: "contacts",
  },
};
