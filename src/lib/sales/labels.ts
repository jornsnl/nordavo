import type { Tone } from "@/lib/labels";
import type { TaskPriority } from "@/lib/database.types";
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

/** The 8 stages of the pipeline (section 2.8). Lost needs a reason. */
export const pipelineStages: Option<PipelineStage>[] = [
  { value: "interested", label: "Interested", tone: "brand" },
  { value: "meeting_planned", label: "Meeting planned", tone: "brand" },
  { value: "meeting_held", label: "Meeting held", tone: "accent" },
  { value: "intake_done", label: "Intake done", tone: "accent" },
  { value: "profiles_sent", label: "Profiles sent", tone: "accent" },
  { value: "candidate_interviews", label: "Candidate interviews", tone: "accent" },
  { value: "won", label: "Won", tone: "success" },
  { value: "lost", label: "Lost", tone: "danger" },
];

/** Stages 4 to 7 follow from the recruitment data (vacancy, presented candidates, interviews, placement). */
export const derivedPipelineStages: PipelineStage[] = ["intake_done", "profiles_sent", "candidate_interviews", "won"];

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

/** Suggestions for the route column; any text is allowed. */
export const contactRoutes = ["Mobile", "Main number", "Via reception", "LinkedIn", "Mail"];

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
export const priorityStyles: Record<WorkPriority | TaskPriority, { label: string; dot: string; chip: string; border: string }> = {
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
