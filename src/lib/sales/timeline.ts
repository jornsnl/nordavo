import type { Json } from "@/lib/database.types";
import { contactStatuses, icpDecisions } from "@/lib/labels";
import { companyCategories, contactRoles, leadStatuses, pipelineStages } from "@/lib/sales/labels";

// Change rows of Activities ("lead status from Ready to In sequence"). Pure.

const fieldLabels: Record<string, string> = {
  name: "Name",
  website: "Website",
  prio: "Prio",
  category: "Category",
  description: "What they do",
  sector: "Sector",
  employees: "Employees",
  city: "City",
  linkedin_url: "LinkedIn",
  general_phone: "General number",
  red_flags: "Red flags",
  opening_line: "Opening line",
  source_note: "Source note",
  icp_decision: "ICP verdict",
  lead_status: "Lead status",
  pipeline_stage: "Pipeline stage",
  lost_reason: "Lost reason",
  owner_id: "Owner",
  partner_id: "Partner",
  next_action: "Next action",
  next_action_date: "Next action date",
  pinned_at: "Pinned",
  first_name: "First name",
  last_name: "Last name",
  title: "Job title",
  tier: "Tier",
  role: "Role",
  route: "Route",
  phone: "Mobile",
  email: "Mail",
  status: "Contact status",
  attempts: "Attempts",
  callback_at: "Call back on",
  referred_to: "Referred to",
  caller_note: "Caller note",
  assigned_caller_id: "Caller",
  assigned_until: "Caller until",
  company_id: "Company",
  is_primary: "Primary contact",
  segment: "Segment",
  icp_reason: "ICP reason",
  icp_score: "ICP score",
  legal_form: "Legal form",
  kvk_number: "KvK number",
  phone_type: "Phone type",
  email_status: "Mail status",
  manual_position: "Manual order",
  draft_body: "Concept text",
};

const valueLabels: Record<string, { value: string; label: string }[]> = {
  lead_status: leadStatuses,
  pipeline_stage: pipelineStages,
  status: contactStatuses,
  category: companyCategories,
  role: contactRoles,
  icp_decision: icpDecisions,
};

export function fieldLabel(field: string | null | undefined): string {
  if (!field) return "Field";
  return fieldLabels[field] ?? field.replace(/_/g, " ");
}

export function valueText(field: string | null | undefined, value: Json | null | undefined): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.length === 0 ? "empty" : value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (field === "prio" && typeof value === "number") return `P${value}`;
  if (field === "pinned_at") return "pinned";
  if (field && (field.endsWith("_id") || field === "company_id")) return "changed";
  const options = field ? valueLabels[field] : undefined;
  const text = String(value);
  return options?.find((o) => o.value === text)?.label ?? (text.length > 80 ? `${text.slice(0, 77)}...` : text);
}

/** One sentence for a change row. */
export function describeChange(field: string | null, oldValue: Json | null, newValue: Json | null): string {
  if (field === "pinned_at") return newValue ? "Pinned on top" : "Unpinned";
  if (field === "manual_position") return newValue === null ? "Taken out of the manual order" : "Moved in the manual order";
  if (field === "draft_body") return "Concept text written, waits for approval";
  if (field === "is_primary") return newValue ? "Made the primary contact" : "No longer the primary contact";
  if (field && field.endsWith("_id")) return `${fieldLabel(field)} changed`;
  return `${fieldLabel(field)} from ${valueText(field, oldValue)} to ${valueText(field, newValue)}`;
}
