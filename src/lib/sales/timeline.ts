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
  parked_until: "Parked until",
  profiles_due_on: "Send profiles on",
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
  phone_wrong_at: "Number marked wrong",
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
  if (field === "phone_wrong_at") return newValue ? "Mobile number marked as wrong" : "Wrong number mark removed";
  if (field === "is_primary") return newValue ? "Made the primary contact" : "No longer the primary contact";
  if (field && field.endsWith("_id")) return `${fieldLabel(field)} changed`;
  return `${fieldLabel(field)} from ${valueText(field, oldValue)} to ${valueText(field, newValue)}`;
}

// ---------------------------------------------------------------------------
// Contact moments for the call screen (feedback Julius, 596fde2b): only what
// was done to reach the company (calls with outcome and note, mails,
// LinkedIn, meetings) and who did it. No field changes, no views.
// ---------------------------------------------------------------------------

/** Activity types that are a contact moment. */
export const contactMomentTypes = ["contact", "reply", "meeting"] as const;

export type ContactMomentRow = {
  id: string;
  date: string;
  type: string;
  channel: string;
  outcome: string | null;
  notes: string | null;
  contact_id: string | null;
  created_by: string | null;
  caller_id?: string | null;
};

export type CallTimelineItem = {
  id: string;
  date: string;
  type: string;
  channel: string;
  outcome: string | null;
  /** Short text: "Call: No answer", "Mail: Sent", "Meeting: Meeting booked". */
  summary: string;
  notes: string | null;
  /** Who did it: the team member or the external caller. */
  who: string | null;
  contactName: string | null;
};

const channelNames: Record<string, string> = {
  bellen: "Call",
  mail: "Mail",
  linkedin: "LinkedIn",
  meeting: "Meeting",
  system: "System",
};

const outcomeNames: Record<string, string> = {
  afspraak: "Meeting booked",
  afspraak_goedgekeurd: "Meeting approved",
  afspraak_afgekeurd: "Meeting rejected",
  meeting_held: "Meeting held",
  meeting_no_show: "No show",
  meeting_cancelled: "Meeting cancelled",
  geen_gehoor: "No answer",
  bereikt: "Reached",
  terugbellen: "Call back",
  niet_geinteresseerd: "Not interested",
  reply_positief: "Positive reply",
  reply_neutraal: "Neutral reply",
  reply_negatief: "Negative reply",
  verstuurd: "Sent",
  bounce: "Bounce",
  afgemeld: "Unsubscribed",
  gesprek_gehad: "Call held",
  notitie: "Note",
  no_answer: "No answer",
  call_back: "Call back",
  reached_interested: "Reached: interested",
  meeting_planned: "Meeting planned",
  reached_not_interested: "Reached: not interested",
  referred: "Referred",
  wrong_person: "Wrong person",
  wrong_number: "Wrong number",
};

/** "Call: No answer", "Mail: Positive reply". */
export function describeContactMoment(row: Pick<ContactMomentRow, "channel" | "outcome" | "type">): string {
  const channel = channelNames[row.channel] ?? row.channel;
  const outcome = row.outcome ? (outcomeNames[row.outcome] ?? row.outcome.replace(/_/g, " ")) : row.type === "reply" ? "Reply" : null;
  return [channel, outcome].filter(Boolean).join(": ");
}

/**
 * The contact moments of a company, newest first: calls, mails, LinkedIn and
 * meetings. Anything else in Activities (changes, views, notes, system rows)
 * stays out. `names` maps a profile id to a name, `contacts` a contact id to
 * its name and `callers` a caller id to the name of the external caller.
 */
export function buildContactTimeline(
  rows: ContactMomentRow[],
  names: Map<string, string>,
  contacts: Map<string, string>,
  callers: Map<string, string> = new Map(),
): CallTimelineItem[] {
  return rows
    .filter((r) => (contactMomentTypes as readonly string[]).includes(r.type))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((r) => ({
      id: r.id,
      date: r.date,
      type: r.type,
      channel: r.channel,
      outcome: r.outcome,
      summary: describeContactMoment(r),
      notes: r.notes?.trim() || null,
      who: (r.created_by ? names.get(r.created_by) : null) ?? (r.caller_id ? callers.get(r.caller_id) : null) ?? null,
      contactName: r.contact_id ? (contacts.get(r.contact_id) ?? null) : null,
    }));
}

/** The latest contact moment: when and by whom. Null when the company was never contacted. */
export function lastContact(items: CallTimelineItem[]): CallTimelineItem | null {
  return items[0] ?? null;
}
