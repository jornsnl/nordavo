// Rows and columns of the sales tables (Leads, Contacts, Pipeline, Call
// lists). Pure, shared by the spreadsheet table in the browser and the call
// queue on the server.

import type { ContactStatus, EmailStatus, IcpDecision, PhoneType } from "@/lib/database.types";
import type { CompanyCategory, ContactRole, LeadStatus, PipelineStage } from "@/lib/sales/database";
import type { Accessor, SortRule } from "@/lib/sales/grid";
import { contactStatuses, contactTiers, icpDecisions } from "@/lib/labels";
import { companyCategories, companyPrios, contactRoles, contactRouteOptions, leadStatuses, parseRoute, pipelineStages } from "@/lib/sales/labels";

export type PrimaryContact = {
  id: string;
  name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  linkedinUrl: string | null;
};

export type CompanyRow = {
  id: string;
  name: string;
  domain: string;
  website: string | null;
  prio: number | null;
  category: CompanyCategory | null;
  description: string | null;
  sector: string | null;
  employees: number | null;
  city: string | null;
  linkedin_url: string | null;
  general_phone: string | null;
  red_flags: string[];
  opening_line: string | null;
  source_note: string | null;
  icp_decision: IcpDecision | null;
  icp_score: number | null;
  lead_status: LeadStatus;
  lead_status_changed_at: string;
  pipeline_stage: PipelineStage | null;
  pipeline_stage_changed_at: string | null;
  pipeline_entered_at: string | null;
  lost_reason: string | null;
  owner_id: string | null;
  owner_name: string | null;
  partner_id: string | null;
  partner_name: string | null;
  next_action: string | null;
  next_action_date: string | null;
  pinned_at: string | null;
  manual_position: number | null;
  client_id: string | null;
  source: string | null;
  created_at: string;
  primary_contact: PrimaryContact | null;
  contacts_count: number;
  signals_count: number;
  last_activity_at: string | null;
  last_activity: string | null;
};

export type ContactRow = {
  id: string;
  company_id: string;
  company_name: string;
  company_prio: number | null;
  company_category: CompanyCategory | null;
  company_lead_status: LeadStatus;
  company_pipeline_stage: PipelineStage | null;
  company_city: string | null;
  company_sector: string | null;
  company_icp: IcpDecision | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  tier: number | null;
  role: ContactRole;
  route: string | null;
  phone: string | null;
  phone_type: PhoneType | null;
  email: string | null;
  email_status: EmailStatus | null;
  linkedin_url: string | null;
  status: ContactStatus;
  status_changed_at: string;
  attempts: number;
  last_attempt_at: string | null;
  callback_at: string | null;
  referred_to: string | null;
  caller_note: string | null;
  assigned_caller_id: string | null;
  assigned_caller_name: string | null;
  assigned_until: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  is_primary: boolean;
  pinned_at: string | null;
  manual_position: number | null;
  last_contacted_at: string | null;
  created_at: string;
};

export type CellType = "text" | "longtext" | "number" | "select" | "multiselect" | "date" | "datetime" | "boolean" | "url" | "phone" | "email";

export type ColumnDef<T> = {
  key: string;
  label: string;
  type: CellType;
  /** Database column that an edit writes (sales_update); absent means read only. */
  field?: string;
  /** Which record an edit goes to. */
  entity?: "company" | "contact";
  options?: { value: string; label: string }[];
  width?: number;
  /** Shown when a view does not list its columns. */
  defaultVisible?: boolean;
  get: Accessor<T>;
  /** Value written for the edited text, or an error message. */
  parse?: (input: string) => { value: unknown } | { error: string };
};

function opts<T extends string>(list: { value: T; label: string }[]) {
  return list.map((o) => ({ value: o.value, label: o.label }));
}

const text = (input: string) => ({ value: input.trim() === "" ? null : input.trim() });
const number = (min: number, max: number) => (input: string) => {
  if (input.trim() === "") return { value: null };
  const n = Number(input.replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) return { error: `Enter a number from ${min} to ${max}.` };
  return { value: Math.round(n) };
};
const date = (input: string) => {
  const v = input.trim();
  if (v === "") return { value: null };
  const nl = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  const iso = nl ? `${nl[3]}-${nl[2].padStart(2, "0")}-${nl[1].padStart(2, "0")}` : v;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso))
    ? { value: iso }
    : { error: "Use a date like 2026-11-30." };
};
const choice = (list: { value: string; label: string }[]) => (input: string) => {
  const v = input.trim().toLowerCase();
  if (v === "") return { value: null };
  const hit = list.find((o) => o.value.toLowerCase() === v || o.label.toLowerCase() === v);
  return hit ? { value: hit.value } : { error: `Pick one of: ${list.map((o) => o.label).join(", ")}.` };
};
const requiredChoice = (list: { value: string; label: string }[]) => (input: string) => {
  const r = choice(list)(input);
  return "value" in r && r.value === null ? { error: "This field cannot be empty." } : r;
};
const prio = (input: string) => {
  const v = input.trim().replace(/^p/i, "");
  return number(1, 5)(v);
};
const list = (input: string) => ({
  value: input
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean),
});

/** Pasted Excel text such as "Bellen" or "06" becomes one of the fixed routes. */
const route = (input: string) => {
  if (input.trim() === "") return { value: null };
  const hit = parseRoute(input);
  return hit ? { value: hit } : { error: `Pick one of: ${routeOptions.map((o) => o.label).join(", ")}.` };
};

const prioOptions = opts(companyPrios);
const categoryOptions = opts(companyCategories);
const leadStatusOptions = opts(leadStatuses);
const stageOptions = opts(pipelineStages);
const icpOptions = opts(icpDecisions);
const roleOptions = opts(contactRoles);
const statusOptions = opts(contactStatuses);
const routeOptions = contactRouteOptions.map((o) => ({ value: o.value as string, label: o.label }));
const tierOptions = contactTiers.map((t) => ({ value: t.value, label: `Tier ${t.value}` }));

export const companyColumns: ColumnDef<CompanyRow>[] = [
  { key: "name", label: "Company", type: "text", field: "name", entity: "company", width: 220, defaultVisible: true, get: (r) => r.name, parse: (i) => (i.trim() ? { value: i.trim() } : { error: "A company needs a name." }) },
  { key: "prio", label: "Prio", type: "select", field: "prio", entity: "company", options: prioOptions, width: 80, defaultVisible: true, get: (r) => (r.prio == null ? null : String(r.prio)), parse: prio },
  { key: "lead_status", label: "Lead status", type: "select", field: "lead_status", entity: "company", options: leadStatusOptions, width: 140, defaultVisible: true, get: (r) => r.lead_status, parse: requiredChoice(leadStatusOptions) },
  { key: "category", label: "Category", type: "select", field: "category", entity: "company", options: categoryOptions, width: 130, defaultVisible: true, get: (r) => r.category, parse: choice(categoryOptions) },
  { key: "primary_contact", label: "Contact person", type: "text", width: 180, defaultVisible: true, get: (r) => r.primary_contact?.name ?? null },
  { key: "primary_phone", label: "Phone", type: "phone", width: 140, defaultVisible: true, get: (r) => r.primary_contact?.phone ?? r.general_phone },
  { key: "icp_decision", label: "ICP", type: "select", field: "icp_decision", entity: "company", options: icpOptions, width: 90, defaultVisible: true, get: (r) => r.icp_decision, parse: choice(icpOptions) },
  { key: "sector", label: "Sector", type: "text", field: "sector", entity: "company", width: 140, defaultVisible: true, get: (r) => r.sector, parse: text },
  { key: "employees", label: "Employees", type: "number", field: "employees", entity: "company", width: 100, defaultVisible: true, get: (r) => r.employees, parse: number(0, 1000000) },
  { key: "city", label: "City", type: "text", field: "city", entity: "company", width: 120, defaultVisible: true, get: (r) => r.city, parse: text },
  { key: "last_activity_at", label: "Last activity", type: "datetime", width: 140, defaultVisible: true, get: (r) => r.last_activity_at },
  { key: "next_action", label: "Next action", type: "text", field: "next_action", entity: "company", width: 180, defaultVisible: true, get: (r) => r.next_action, parse: text },
  { key: "next_action_date", label: "Next action date", type: "date", field: "next_action_date", entity: "company", width: 130, defaultVisible: false, get: (r) => r.next_action_date, parse: date },
  { key: "description", label: "What they do", type: "longtext", field: "description", entity: "company", width: 240, defaultVisible: false, get: (r) => r.description, parse: text },
  { key: "website", label: "Website", type: "url", field: "website", entity: "company", width: 180, defaultVisible: false, get: (r) => r.website ?? r.domain, parse: text },
  { key: "linkedin_url", label: "LinkedIn company", type: "url", field: "linkedin_url", entity: "company", width: 180, defaultVisible: false, get: (r) => r.linkedin_url, parse: text },
  { key: "general_phone", label: "General number", type: "phone", field: "general_phone", entity: "company", width: 140, defaultVisible: false, get: (r) => r.general_phone, parse: text },
  { key: "red_flags", label: "Red flags", type: "multiselect", field: "red_flags", entity: "company", width: 180, defaultVisible: false, get: (r) => r.red_flags, parse: list },
  { key: "opening_line", label: "Opening line", type: "longtext", field: "opening_line", entity: "company", width: 260, defaultVisible: false, get: (r) => r.opening_line, parse: text },
  { key: "source_note", label: "Source note", type: "longtext", field: "source_note", entity: "company", width: 200, defaultVisible: false, get: (r) => r.source_note, parse: text },
  { key: "pipeline_stage", label: "Pipeline stage", type: "select", field: "pipeline_stage", entity: "company", options: stageOptions, width: 160, defaultVisible: false, get: (r) => r.pipeline_stage, parse: choice(stageOptions) },
  { key: "owner_name", label: "Owner", type: "text", width: 140, defaultVisible: false, get: (r) => r.owner_name },
  { key: "partner_name", label: "Partner", type: "text", width: 140, defaultVisible: false, get: (r) => r.partner_name },
  { key: "contacts_count", label: "Contacts", type: "number", width: 90, defaultVisible: false, get: (r) => r.contacts_count },
  { key: "signals_count", label: "Vacancies", type: "number", width: 90, defaultVisible: false, get: (r) => r.signals_count },
  { key: "icp_score", label: "ICP score", type: "number", width: 90, defaultVisible: false, get: (r) => r.icp_score },
  { key: "lead_status_changed_at", label: "In status since", type: "datetime", width: 140, defaultVisible: false, get: (r) => r.lead_status_changed_at },
  { key: "source", label: "Source", type: "text", width: 120, defaultVisible: false, get: (r) => r.source },
  { key: "created_at", label: "Added", type: "datetime", width: 140, defaultVisible: false, get: (r) => r.created_at },
];

/** The pipeline view of the same companies: only those that showed interest. */
export const pipelineColumns: ColumnDef<CompanyRow>[] = [
  companyColumns[0],
  { key: "pipeline_stage", label: "Stage", type: "select", field: "pipeline_stage", entity: "company", options: stageOptions, width: 170, defaultVisible: true, get: (r) => r.pipeline_stage, parse: choice(stageOptions) },
  companyColumns[1],
  companyColumns[4],
  companyColumns[5],
  { key: "pipeline_stage_changed_at", label: "In stage since", type: "datetime", width: 140, defaultVisible: true, get: (r) => r.pipeline_stage_changed_at },
  companyColumns[10],
  companyColumns[11],
  { key: "next_action_date", label: "Next action date", type: "date", field: "next_action_date", entity: "company", width: 130, defaultVisible: true, get: (r) => r.next_action_date, parse: date },
  { key: "owner_name", label: "Owner", type: "text", width: 140, defaultVisible: true, get: (r) => r.owner_name },
  { key: "lost_reason", label: "Lost reason", type: "text", field: "lost_reason", entity: "company", width: 200, defaultVisible: true, get: (r) => r.lost_reason, parse: text },
  { key: "pipeline_entered_at", label: "In pipeline since", type: "datetime", width: 140, defaultVisible: false, get: (r) => r.pipeline_entered_at },
  companyColumns[3],
  companyColumns[7],
  companyColumns[9],
  { key: "partner_name", label: "Partner", type: "text", width: 140, defaultVisible: false, get: (r) => r.partner_name },
];

export const contactColumns: ColumnDef<ContactRow>[] = [
  { key: "full_name", label: "Contact person", type: "text", width: 180, defaultVisible: true, get: (r) => r.full_name },
  { key: "company_name", label: "Company", type: "text", width: 200, defaultVisible: true, get: (r) => r.company_name },
  { key: "company_prio", label: "Prio", type: "select", field: "prio", entity: "company", options: prioOptions, width: 80, defaultVisible: true, get: (r) => (r.company_prio == null ? null : String(r.company_prio)), parse: prio },
  { key: "status", label: "Contact status", type: "select", field: "status", entity: "contact", options: statusOptions, width: 150, defaultVisible: true, get: (r) => r.status, parse: requiredChoice(statusOptions) },
  { key: "title", label: "Job title", type: "text", field: "title", entity: "contact", width: 160, defaultVisible: true, get: (r) => r.title, parse: text },
  { key: "tier", label: "Tier", type: "select", field: "tier", entity: "contact", options: tierOptions, width: 80, defaultVisible: true, get: (r) => (r.tier == null ? null : String(r.tier)), parse: (i) => { const r = choice(tierOptions)(i.replace(/^tier\s*/i, "")); return "value" in r && r.value != null ? { value: Number(r.value) } : r; } },
  { key: "role", label: "Role", type: "select", field: "role", entity: "contact", options: roleOptions, width: 100, defaultVisible: true, get: (r) => r.role, parse: requiredChoice(roleOptions) },
  { key: "route", label: "Route", type: "select", field: "route", entity: "contact", options: routeOptions, width: 130, defaultVisible: true, get: (r) => r.route, parse: route },
  { key: "phone", label: "Mobile", type: "phone", field: "phone", entity: "contact", width: 140, defaultVisible: true, get: (r) => r.phone, parse: text },
  { key: "email", label: "Mail", type: "email", field: "email", entity: "contact", width: 200, defaultVisible: true, get: (r) => r.email, parse: text },
  { key: "attempts", label: "Attempts", type: "number", field: "attempts", entity: "contact", width: 90, defaultVisible: true, get: (r) => r.attempts, parse: number(0, 99) },
  { key: "last_attempt_at", label: "Last attempt", type: "datetime", width: 140, defaultVisible: true, get: (r) => r.last_attempt_at },
  { key: "callback_at", label: "Call back on", type: "date", field: "callback_at", entity: "contact", width: 120, defaultVisible: true, get: (r) => r.callback_at, parse: date },
  { key: "assigned_caller_name", label: "Caller", type: "text", width: 130, defaultVisible: true, get: (r) => r.assigned_caller_name },
  { key: "linkedin_url", label: "LinkedIn", type: "url", field: "linkedin_url", entity: "contact", width: 180, defaultVisible: false, get: (r) => r.linkedin_url, parse: text },
  { key: "referred_to", label: "Referred to", type: "text", field: "referred_to", entity: "contact", width: 160, defaultVisible: false, get: (r) => r.referred_to, parse: text },
  { key: "caller_note", label: "Caller note", type: "longtext", field: "caller_note", entity: "contact", width: 240, defaultVisible: false, get: (r) => r.caller_note, parse: text },
  { key: "company_lead_status", label: "Lead status", type: "select", field: "lead_status", entity: "company", options: leadStatusOptions, width: 140, defaultVisible: false, get: (r) => r.company_lead_status, parse: requiredChoice(leadStatusOptions) },
  { key: "company_category", label: "Category", type: "select", field: "category", entity: "company", options: categoryOptions, width: 130, defaultVisible: false, get: (r) => r.company_category, parse: choice(categoryOptions) },
  { key: "company_city", label: "City", type: "text", width: 120, defaultVisible: false, get: (r) => r.company_city },
  { key: "company_sector", label: "Sector", type: "text", width: 140, defaultVisible: false, get: (r) => r.company_sector },
  { key: "is_primary", label: "Primary", type: "boolean", field: "is_primary", entity: "contact", width: 80, defaultVisible: false, get: (r) => r.is_primary, parse: (i) => ({ value: /^(1|true|yes|ja|y|x)$/i.test(i.trim()) }) },
  { key: "assigned_until", label: "Caller until", type: "date", field: "assigned_until", entity: "contact", width: 120, defaultVisible: false, get: (r) => r.assigned_until, parse: date },
  { key: "status_changed_at", label: "In status since", type: "datetime", width: 140, defaultVisible: false, get: (r) => r.status_changed_at },
  { key: "last_contacted_at", label: "Last contacted", type: "datetime", width: 140, defaultVisible: false, get: (r) => r.last_contacted_at },
  { key: "created_at", label: "Added", type: "datetime", width: 140, defaultVisible: false, get: (r) => r.created_at },
];

export function accessorsFor<T>(columns: ColumnDef<T>[]): Record<string, Accessor<T>> {
  return Object.fromEntries(columns.map((c) => [c.key, c.get]));
}

/** Default orders when a view sets none (section 2.4 point 6: the reset button goes back to these). */
export const defaultCompanySort: SortRule[] = [
  { column: "prio", dir: "asc" },
  { column: "name", dir: "asc" },
];
export const defaultPipelineSort: SortRule[] = [
  { column: "pipeline_stage_changed_at", dir: "desc" },
];
export const defaultContactSort: SortRule[] = [
  { column: "company_prio", dir: "asc" },
  { column: "company_name", dir: "asc" },
  { column: "tier", dir: "asc" },
];

/** Contacts a caller may never get on their list. */
export const closedContactStatuses: ContactRow["status"][] = ["not_interested", "do_not_contact", "not_reached"];
