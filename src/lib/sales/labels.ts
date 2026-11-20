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

/** The lead statuses with the explanation of 01 Leadregels, deel 5 (the tooltips). */
export const leadStatuses: Option<LeadStatus>[] = [
  { value: "new", label: "New", tone: "neutral", description: "Net binnen, nog niet beoordeeld." },
  { value: "enrich", label: "Enrich", tone: "warning", description: "GO, er mist een nummer of mailadres." },
  { value: "ready", label: "Ready", tone: "brand", description: "GO met score, wacht op de start van de route." },
  { value: "in_sequence", label: "In sequence", tone: "accent", description: "Zit nu in een route (campagne, sequence of bellijst)." },
  {
    value: "cooled_down",
    label: "Cooled down",
    tone: "neutral",
    description:
      "Route afgelopen zonder reactie. Opnieuw benaderen mag: zonder nieuw signaal minimaal 1 week tussen het einde van de ene en het begin van de volgende route. Bij een nieuwe vacature of ander sterk signaal direct, met dat signaal als haak.",
  },
  {
    value: "nee_geen_interesse",
    label: "Nee / geen interesse",
    tone: "warning",
    description:
      "Nee of geen interesse (via mail, bellen of LinkedIn). Na 3 maanden mag het bedrijf opnieuw benaderd worden, bij voorkeur via een ander kanaal en met een nieuwe haak. Een nieuwe vacature of ander sterk signaal mag eerder, maar dan persoonlijk en niet via een standaard campagne.",
  },
  {
    value: "nu_niet",
    label: "Nu niet",
    tone: "warning",
    description: "Geparkeerd tot de datum die ze zelf noemen, anders 3 maanden. Daarna persoonlijk opvolgen.",
  },
  { value: "no_go", label: "No go", tone: "danger", description: "Past niet bij de ICP, met reden." },
  {
    value: "do_not_contact",
    label: "Do not contact",
    tone: "danger",
    description:
      "Nooit meer. Bij een boze reactie of afmelden, en voor concurrenten en klanten van Smartshore. Geldt ook als er later een signaal komt. Alleen een admin kan dit terugzetten.",
  },
];

/** Hidden in the Leads table by default (leadregels, deel 5). */
export const hiddenByDefaultLeadStatuses: LeadStatus[] = ["no_go", "do_not_contact"];

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

/** Contact 1 (stored as main), contact 2 (stored as reserve), then extra (leadregels, deel 4). */
export const contactRoles: Option<ContactRole>[] = [
  { value: "main", label: "Contact 1", tone: "brand", description: "Wordt als eerste benaderd." },
  { value: "reserve", label: "Contact 2", tone: "accent", description: "Bellen: na twee pogingen zonder gehoor op contact 1. Mail: tegelijk met contact 1." },
  { value: "extra", label: "Extra", tone: "neutral", description: "Overige contacten van het bedrijf." },
];

/** What the tiers mean (leadregels, deel 4): the tooltip next to every tier. */
export const tierMeanings: Record<1 | 2 | 3, string> = {
  1: "Tier 1, technisch: CTO, head of engineering, data of IT, tech lead.",
  2: "Tier 2, eigenaar of directie: CEO, founder, directeur.",
  3: "Tier 3, HR of recruitment. Alleen als tier 1 en tier 2 ontbreken.",
};

/** The default order of contact 1 and 2, as one line for the screens. */
export const contactOrderRule =
  "Onder ongeveer 30 FTE eerst tier 2, daarboven eerst tier 1. Bij een data vacature eerst de head of data of BI. Tier 3 alleen als tier 1 en tier 2 ontbreken.";

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
export const callOutcomes: (Option<CallOutcome> & { needs?: "date" | "name"; legacy?: boolean })[] = [
  { value: "no_answer", label: "No answer", tone: "neutral", description: "Na 2 pogingen op contact 1 volgt contact 2." },
  { value: "call_back", label: "Call back", tone: "warning", needs: "date" },
  { value: "reached_interested", label: "Reached: interested", tone: "success" },
  { value: "meeting_planned", label: "Meeting planned", tone: "success" },
  {
    value: "not_interested_person",
    label: "Not interested: person",
    tone: "neutral",
    description: "Alleen dit contact. Twijfel? Kies bedrijf.",
  },
  {
    value: "not_interested_company",
    label: "No interest: company",
    tone: "neutral",
    description: "Hele bedrijf, 3 maanden niet benaderen.",
  },
  { value: "not_now", label: "Not now", tone: "warning", description: "Hele bedrijf, tot een datum." },
  { value: "do_not_contact", label: "Angry or unsubscribe", tone: "danger", description: "Hele bedrijf, nooit meer." },
  { value: "referred", label: "Referred", tone: "brand", needs: "name" },
  { value: "wrong_person", label: "Wrong person", tone: "warning" },
  { value: "wrong_number", label: "Wrong number", tone: "danger" },
  // The old single button (before 20 November 2026): kept for old calls, not offered any more.
  { value: "reached_not_interested", label: "Reached: not interested (old)", tone: "neutral", legacy: true },
];

/** The outcomes that need a short note: was it the person or the company? */
export const noteRequiredOutcomes: CallOutcome[] = ["not_interested_person", "not_interested_company", "not_now", "do_not_contact"];

/** The built in reasons for a "no" (Settings, Sales lists adds, renames and hides). */
export const rejectReasons: Option<string>[] = [
  { value: "no_vacancies", label: "No vacancies", tone: "neutral" },
  { value: "has_agency", label: "Already has an agency or partner", tone: "neutral" },
  { value: "offshore_no", label: "India or offshore is not an option", tone: "neutral" },
  { value: "too_small", label: "Too small", tone: "neutral" },
  { value: "too_expensive", label: "Too expensive", tone: "neutral" },
  { value: "no_time", label: "No time or no priority", tone: "neutral" },
  { value: "bad_experience", label: "Bad experience before", tone: "neutral" },
  { value: "wrong_moment", label: "Wrong moment", tone: "warning", description: "Pick a date: the company is parked until then" },
];

/** The reason that parks the company until a date instead of closing it. */
export const WRONG_MOMENT = "wrong_moment";

export const callerStatuses: Option<CallerStatus>[] = [
  { value: "active", label: "Active", tone: "success" },
  { value: "paused", label: "Paused", tone: "warning" },
  { value: "stopped", label: "Stopped", tone: "neutral" },
];

export const meetingStatuses: Option<MeetingStatus>[] = [
  { value: "awaiting_booking", label: "Awaiting booking", tone: "warning" },
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
