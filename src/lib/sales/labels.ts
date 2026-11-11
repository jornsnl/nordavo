import type { Tone } from "@/lib/labels";
import type {
  ActivityType,
  CallerStatus,
  CallOutcome,
  CompanyCategory,
  ContactRole,
  LeadStatus,
  MeetingStatus,
  PipelineStage,
  SequenceChannel,
  SequenceStatus,
} from "@/lib/sales/database";
import type { WorkPriority } from "@/lib/work/database";

// Labels of the sales CRM. Pure, safe for client components.

type Option<T extends string> = { value: T; label: string; tone: Tone; description?: string };

export const leadStatuses: Option<LeadStatus>[] = [
  { value: "new", label: "New", tone: "neutral", description: "Came in" },
  { value: "review", label: "Review", tone: "warning", description: "Waits for the ICP verdict" },
  { value: "ready", label: "Ready", tone: "brand", description: "GO and ready to approach" },
  { value: "enrich", label: "Enrich", tone: "warning", description: "No number yet, goes to Max" },
  { value: "in_sequence", label: "In sequence", tone: "accent", description: "Being approached" },
  { value: "cooled_down", label: "Cooled down", tone: "neutral", description: "Approached without result" },
  { value: "no_go", label: "No go", tone: "danger" },
  { value: "do_not_contact", label: "Do not contact", tone: "danger" },
];

/** The 9 stages of the pipeline, in order. */
export const pipelineFlow: Option<PipelineStage>[] = [
  { value: "contact", label: "Contact", tone: "neutral", description: "Two way contact, no clear interest yet" },
  { value: "interested", label: "Interested", tone: "brand" },
  { value: "meeting_planned", label: "Meeting planned", tone: "brand" },
  { value: "meeting_held", label: "Meeting held", tone: "accent" },
  { value: "vacancy_drafted", label: "Vacancy drafted", tone: "accent", description: "Written with the client, or they sent one" },
  { value: "agreed_paid", label: "Agreed + starter fee paid", tone: "accent", description: "With the date the profiles go out" },
  { value: "profiles_sent", label: "Profiles sent", tone: "accent" },
  { value: "candidate_interviews", label: "Candidate interviews", tone: "accent" },
  { value: "won", label: "Won", tone: "success", description: "A candidate is chosen; onboarding goes on in Placements" },
];

/** Ways off the pipeline from any stage: Lost needs a reason, Parked a date to get in touch again. */
export const pipelineExits: Option<PipelineStage>[] = [
  { value: "lost", label: "Lost", tone: "danger", description: "Needs a reason" },
  { value: "parked", label: "Parked", tone: "warning", description: "With a date to get in touch again" },
];

/** Every stage value: the flow, then the exits. */
export const pipelineStages: Option<PipelineStage>[] = [...pipelineFlow, ...pipelineExits];

/** The stages a company goes into the pipeline at with one click. */
export const pipelineEntryStages: PipelineStage[] = ["contact", "interested"];

/** Stages that follow from the recruitment data (vacancy, presented candidates, interviews, placement). */
export const derivedPipelineStages: PipelineStage[] = ["vacancy_drafted", "profiles_sent", "candidate_interviews", "won"];

/** Still being worked on: in the pipeline, not won, lost or parked. */
export function isOpenStage(stage: PipelineStage | null | undefined): boolean {
  return stage != null && stage !== "won" && stage !== "lost" && stage !== "parked";
}

/** Weeks from Agreed + starter fee paid to the profiles going out, by default (the database sets the date). */
export const PROFILES_WEEKS = 3;

export const companyCategories: Option<CompanyCategory>[] = [
  { value: "development", label: "Development", tone: "brand" },
  { value: "data_bi", label: "Data & BI", tone: "accent" },
  { value: "both", label: "Both", tone: "success" },
];

export const contactRoles: Option<ContactRole>[] = [
  { value: "main", label: "Main", tone: "brand" },
  { value: "extra", label: "Extra", tone: "neutral" },
  { value: "reserve", label: "Reserve", tone: "neutral" },
];

/** Priority of a company in the call list, 1 is first. */
export const companyPrios: Option<"1" | "2" | "3" | "4" | "5">[] = [
  { value: "1", label: "P1", tone: "danger" },
  { value: "2", label: "P2", tone: "warning" },
  { value: "3", label: "P3", tone: "brand" },
  { value: "4", label: "P4", tone: "neutral" },
  { value: "5", label: "P5", tone: "neutral" },
];

/**
 * How a contact is best reached (section 2.3: a pick list). The value is
 * stored as is; contacts_route_check in the database allows only these.
 */
export const contactRoutes = ["Mobile", "Main number", "Via reception", "LinkedIn", "Mail"] as const;
export type ContactRoute = (typeof contactRoutes)[number];

export const contactRouteOptions = contactRoutes.map((value) => ({ value, label: value }));

/**
 * A route as people write it in the Excel ("Bellen", "06", "Receptie",
 * "e-mail") to one of the fixed routes, or null when it is none of them.
 * "Bellen" without more is the mobile number when the contact has one.
 */
export function parseRoute(value: unknown, phone?: string | null): ContactRoute | null {
  const s = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!s) return null;
  if (/recept|reception|centrale|front ?desk|doorverbind|switchboard/.test(s)) return "Via reception";
  if (/linked ?in|^li$|inmail|seleqt/.test(s)) return "LinkedIn";
  if (/^e ?mail|^mail|mailen|instantly/.test(s)) return "Mail";
  if (/mobi|^06|gsm|cell|direct/.test(s)) return "Mobile";
  if (/main|algemeen|hoofdnummer|vast|kantoor|bedrijfsnummer|general/.test(s)) return "Main number";
  if (/bel|call|phone|telefo/.test(s)) {
    const digits = String(phone ?? "").replace(/[^\d+]/g, "");
    const mobile = /^(\+316|00316|06)/.test(digits);
    return phone && !mobile ? "Main number" : "Mobile";
  }
  return null;
}

/** The buttons on the call screen, in the order of the Excel (section 2.9). */
export const callOutcomes: (Option<CallOutcome> & { needs?: "date" | "name" })[] = [
  { value: "no_answer", label: "No answer", tone: "neutral" },
  { value: "call_back", label: "Call back", tone: "warning", needs: "date" },
  { value: "reached_interested", label: "Reached: interested", tone: "success" },
  { value: "meeting_planned", label: "Meeting planned", tone: "success" },
  { value: "reached_not_interested", label: "Reached: not interested", tone: "neutral" },
  { value: "referred", label: "Referred", tone: "brand", needs: "name" },
  { value: "wrong_person", label: "Wrong person", tone: "warning" },
  { value: "wrong_number", label: "Wrong number", tone: "danger" },
];

export const callerStatuses: Option<CallerStatus>[] = [
  { value: "active", label: "Active", tone: "success" },
  { value: "paused", label: "Paused", tone: "warning" },
  { value: "stopped", label: "Stopped", tone: "neutral" },
];

export const meetingStatuses: Option<MeetingStatus>[] = [
  { value: "planned", label: "Planned", tone: "brand" },
  { value: "held", label: "Held", tone: "accent" },
  { value: "approved", label: "Approved", tone: "success" },
  { value: "rejected", label: "Rejected", tone: "danger" },
  { value: "no_show", label: "No show", tone: "warning" },
  { value: "cancelled", label: "Cancelled", tone: "neutral" },
];

export const sequenceStatuses: Option<SequenceStatus>[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "active", label: "Active", tone: "success" },
  { value: "archived", label: "Archived", tone: "neutral" },
];

export const sequenceChannels: Option<SequenceChannel>[] = [
  { value: "mail", label: "Mail", tone: "brand" },
  { value: "linkedin", label: "LinkedIn", tone: "accent" },
  { value: "call", label: "Call", tone: "success" },
];

export const activityTypes: Option<ActivityType>[] = [
  { value: "contact", label: "Contact", tone: "brand" },
  { value: "change", label: "Change", tone: "neutral" },
  { value: "note", label: "Note", tone: "neutral" },
  { value: "view", label: "Opened", tone: "neutral" },
  { value: "meeting", label: "Meeting", tone: "success" },
  { value: "reply", label: "Reply", tone: "accent" },
  { value: "system", label: "System", tone: "neutral" },
];

/**
 * One fixed color per priority, the same everywhere (feedback Julius, Tasks
 * en Work samenvoegen, point 4): filters, lists, boards and the task itself.
 * Classes use the design tokens of globals.css.
 */
export const priorityStyles: Record<WorkPriority, { label: string; dot: string; chip: string; border: string }> = {
  urgent: {
    label: "Urgent",
    dot: "bg-red-600",
    chip: "bg-red-600 text-white border-red-600",
    border: "border-l-red-600",
  },
  high: {
    label: "High",
    dot: "bg-orange-500",
    chip: "bg-orange-100 text-orange-800 border-orange-300",
    border: "border-l-orange-500",
  },
  normal: {
    label: "Normal",
    dot: "bg-sky-500",
    chip: "bg-sky-100 text-sky-800 border-sky-300",
    border: "border-l-sky-500",
  },
  low: {
    label: "Low",
    dot: "bg-slate-400",
    chip: "bg-slate-100 text-slate-700 border-slate-300",
    border: "border-l-slate-400",
  },
};

export function labelOf<T extends string>(options: { value: T; label: string }[], value: T | null | undefined): string {
  if (value == null) return "";
  return options.find((o) => o.value === value)?.label ?? value;
}
