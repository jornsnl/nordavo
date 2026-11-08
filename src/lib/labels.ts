import type {
  ActivityChannel,
  ActivityOutcome,
  CompanyStatus,
  ContactStatus,
  EmailStatus,
  IcpDecision,
  JobStatus,
  MatchStatus,
  Segment,
  SignalType,
  SuppressionReason,
  SuppressionScope,
  TalentStage,
  ApplicationStage,
  AttachmentKind,
  BackgroundCheckStatus,
  CandidateOrigin,
  CandidateSource,
  CvVerdict,
  NoteKind,
  CandidateStatus,
  ClientDecision,
  ClientStatus,
  EntityType,
  PlacementStatus,
  ProfileRole,
  Seniority,
  TaskPriority,
  TaskStatus,
  VacancyStatus,
} from "@/lib/database.types";

/** Visual tone for a Badge. */
export type Tone = "neutral" | "brand" | "accent" | "success" | "warning" | "danger";

type Option<T extends string> = { value: T; label: string; tone: Tone };

export const clientStatuses: Option<ClientStatus>[] = [
  { value: "lead", label: "Lead", tone: "accent" },
  { value: "active", label: "Active", tone: "success" },
  { value: "inactive", label: "Inactive", tone: "neutral" },
];

export const vacancyStatuses: Option<VacancyStatus>[] = [
  { value: "open", label: "Open", tone: "brand" },
  { value: "on_hold", label: "Parked", tone: "warning" },
  { value: "filled", label: "Filled", tone: "success" },
  { value: "closed", label: "Closed", tone: "neutral" },
];

export const seniorities: Option<Seniority>[] = [
  { value: "medior", label: "Medior", tone: "neutral" },
  { value: "senior", label: "Senior", tone: "brand" },
  { value: "lead", label: "Lead", tone: "accent" },
];

export const candidateStatuses: Option<CandidateStatus>[] = [
  { value: "available", label: "Available", tone: "success" },
  { value: "in_process", label: "In process", tone: "brand" },
  { value: "parked", label: "Parked", tone: "warning" },
  { value: "placed", label: "Placed", tone: "accent" },
  { value: "unavailable", label: "Unavailable", tone: "neutral" },
];

/** Pipeline columns, in order (recruitment brief 2.1). Parked and rejected are shown apart from the flow. */
export const applicationStages: Option<ApplicationStage>[] = [
  { value: "sourced", label: "Sourced", tone: "neutral" },
  { value: "techstack_check", label: "Techstack check", tone: "neutral" },
  { value: "fill_out", label: "Fill out", tone: "neutral" },
  { value: "video_review", label: "Video review", tone: "brand" },
  { value: "technical_test", label: "Technical test", tone: "brand" },
  { value: "interview", label: "Interview", tone: "brand" },
  { value: "matched", label: "Matched to client", tone: "accent" },
  { value: "client_interview", label: "Client interview", tone: "accent" },
  { value: "final_screening", label: "Final screening", tone: "accent" },
  { value: "placed", label: "Placed", tone: "success" },
  { value: "parked", label: "Parked", tone: "warning" },
  { value: "rejected", label: "Rejected", tone: "danger" },
];

/** Stages apart from the flow: a card there remembers where it left (exit_from_stage). */
export const exitStages = ["parked", "rejected"] as const satisfies readonly ApplicationStage[];

export const candidateSources: Option<CandidateSource>[] = [
  { value: "linkedin", label: "LinkedIn", tone: "brand" },
  { value: "naukri", label: "Naukri", tone: "brand" },
  { value: "manatal", label: "Manatal", tone: "neutral" },
  { value: "indeed", label: "Indeed", tone: "neutral" },
  { value: "monster", label: "Monster", tone: "neutral" },
  { value: "instagram", label: "Instagram", tone: "neutral" },
  { value: "referral", label: "Referral", tone: "accent" },
  { value: "website", label: "Website", tone: "neutral" },
  { value: "headhunted", label: "Headhunted", tone: "accent" },
  { value: "other", label: "Other", tone: "neutral" },
];

export const candidateOrigins: Option<CandidateOrigin>[] = [
  { value: "applied", label: "Applied", tone: "neutral" },
  { value: "headhunted", label: "Headhunted", tone: "accent" },
];

export const cvVerdicts: Option<CvVerdict>[] = [
  { value: "fit", label: "Fits", tone: "success" },
  { value: "maybe", label: "Maybe", tone: "warning" },
  { value: "no_fit", label: "Does not fit", tone: "danger" },
];

export const backgroundCheckStatuses: Option<BackgroundCheckStatus>[] = [
  { value: "not_started", label: "Not started", tone: "neutral" },
  { value: "requested", label: "Requested", tone: "warning" },
  { value: "passed", label: "Passed", tone: "success" },
  { value: "failed", label: "Failed", tone: "danger" },
];

export const noteKinds: Option<NoteKind>[] = [
  { value: "note", label: "Note", tone: "neutral" },
  { value: "call", label: "Call", tone: "brand" },
  { value: "screening_call", label: "Screening call", tone: "brand" },
  { value: "video_review", label: "Video review", tone: "brand" },
  { value: "interview", label: "Interview", tone: "accent" },
  { value: "client_feedback", label: "Client feedback", tone: "accent" },
  { value: "background_check", label: "Background check", tone: "warning" },
];

export const attachmentKinds: Option<AttachmentKind>[] = [
  { value: "cv", label: "CV", tone: "brand" },
  { value: "payslip", label: "Payslip", tone: "warning" },
  { value: "background_check", label: "Background check", tone: "warning" },
  { value: "video", label: "Video", tone: "neutral" },
  { value: "test_result", label: "Test result", tone: "neutral" },
  { value: "other", label: "Other", tone: "neutral" },
];

export const clientDecisions: Option<ClientDecision>[] = [
  { value: "pending", label: "Awaiting client", tone: "warning" },
  { value: "approved", label: "Approved", tone: "success" },
  { value: "rejected", label: "Rejected", tone: "danger" },
];

export const placementStatuses: Option<PlacementStatus>[] = [
  { value: "active", label: "Active", tone: "success" },
  { value: "notice", label: "Notice given", tone: "warning" },
  { value: "ended", label: "Ended", tone: "neutral" },
];

export const taskStatuses: Option<TaskStatus>[] = [
  { value: "todo", label: "To do", tone: "neutral" },
  { value: "in_progress", label: "In progress", tone: "brand" },
  { value: "done", label: "Done", tone: "success" },
];

export const taskPriorities: Option<TaskPriority>[] = [
  { value: "low", label: "Low", tone: "neutral" },
  { value: "normal", label: "Normal", tone: "brand" },
  { value: "high", label: "High", tone: "danger" },
];

export const profileRoles: Option<ProfileRole>[] = [
  { value: "admin", label: "Admin", tone: "accent" },
  { value: "member", label: "Member", tone: "brand" },
  { value: "client", label: "Client", tone: "neutral" },
  { value: "external", label: "Work only", tone: "neutral" },
];

// ---------------------------------------------------------------------------
// GTM
// ---------------------------------------------------------------------------

export const segments: Option<Segment>[] = [
  { value: "saas", label: "SaaS", tone: "brand" },
  { value: "productie", label: "Manufacturing", tone: "neutral" },
  { value: "agency_automation", label: "Automation agency", tone: "accent" },
  { value: "agency_overig", label: "Other agency", tone: "neutral" },
];

export const icpDecisions: Option<IcpDecision>[] = [
  { value: "GO", label: "GO", tone: "success" },
  { value: "REVIEW", label: "Review", tone: "warning" },
  { value: "NO_GO", label: "No go", tone: "danger" },
];

export const companyStatuses: Option<CompanyStatus>[] = [
  { value: "nieuw", label: "New", tone: "neutral" },
  { value: "actief", label: "Active", tone: "brand" },
  { value: "klant", label: "Client", tone: "success" },
  { value: "verloren", label: "Lost", tone: "neutral" },
  { value: "uitgesloten", label: "Suppressed", tone: "danger" },
];

export const contactStatuses: Option<ContactStatus>[] = [
  { value: "nieuw", label: "New", tone: "neutral" },
  { value: "gekwalificeerd", label: "Qualified", tone: "brand" },
  { value: "verrijkt", label: "Enriched", tone: "brand" },
  { value: "op_bellijst", label: "On call list", tone: "accent" },
  { value: "in_mailcampagne", label: "In mail campaign", tone: "accent" },
  { value: "bereikt", label: "Reached", tone: "brand" },
  { value: "afspraak", label: "Meeting", tone: "success" },
  { value: "kans", label: "Opportunity", tone: "success" },
  { value: "klant", label: "Client", tone: "success" },
  { value: "verloren", label: "Lost", tone: "neutral" },
  { value: "uitgesloten", label: "Suppressed", tone: "danger" },
];

/** Contact tiers: who to approach first. */
export const contactTiers: Option<"1" | "2" | "3">[] = [
  { value: "1", label: "Tier 1: CTO, Head of Engineering or Data", tone: "accent" },
  { value: "2", label: "Tier 2: owner or director", tone: "brand" },
  { value: "3", label: "Tier 3: recruiter or HR", tone: "neutral" },
];

export const emailStatuses: Option<EmailStatus>[] = [
  { value: "valid", label: "Verified", tone: "success" },
  { value: "catch_all", label: "Catch-all", tone: "warning" },
  { value: "unknown", label: "Unknown", tone: "neutral" },
  { value: "invalid", label: "Invalid", tone: "danger" },
];

export const signalTypes: Option<SignalType>[] = [
  { value: "vacature", label: "Vacancy", tone: "brand" },
  { value: "lang_open", label: "Open for long", tone: "accent" },
  { value: "meerdere_rollen", label: "Multiple roles", tone: "accent" },
  { value: "remote_extern", label: "Remote or external team", tone: "accent" },
  { value: "freelance", label: "Freelance assignment", tone: "neutral" },
  { value: "funding", label: "Funding", tone: "success" },
  { value: "nieuwe_cto", label: "New CTO", tone: "success" },
  { value: "overig", label: "Other", tone: "neutral" },
];

export const activityChannels: Option<ActivityChannel>[] = [
  { value: "bellen", label: "Call", tone: "brand" },
  { value: "mail", label: "Mail", tone: "brand" },
  { value: "linkedin", label: "LinkedIn", tone: "brand" },
  { value: "meeting", label: "Meeting", tone: "success" },
];

export const activityOutcomes: Option<ActivityOutcome>[] = [
  { value: "verstuurd", label: "Sent", tone: "neutral" },
  { value: "geen_gehoor", label: "No answer", tone: "neutral" },
  { value: "bereikt", label: "Reached", tone: "brand" },
  { value: "terugbellen", label: "Call back", tone: "warning" },
  { value: "afspraak", label: "Meeting booked", tone: "success" },
  { value: "afspraak_goedgekeurd", label: "Meeting approved", tone: "success" },
  { value: "afspraak_afgekeurd", label: "Meeting rejected", tone: "danger" },
  { value: "niet_geinteresseerd", label: "Not interested", tone: "neutral" },
  { value: "reply_positief", label: "Positive reply", tone: "success" },
  { value: "reply_neutraal", label: "Neutral reply", tone: "brand" },
  { value: "reply_negatief", label: "Negative reply", tone: "neutral" },
  { value: "bounce", label: "Bounce", tone: "danger" },
  { value: "afgemeld", label: "Unsubscribed", tone: "danger" },
  { value: "gesprek_gehad", label: "Call held", tone: "success" },
  { value: "gewonnen", label: "Won", tone: "success" },
  { value: "verloren", label: "Lost", tone: "neutral" },
  { value: "notitie", label: "Note", tone: "neutral" },
];

export const suppressionReasons: Option<SuppressionReason>[] = [
  { value: "afgemeld", label: "Unsubscribed", tone: "danger" },
  { value: "bezwaar", label: "Objection", tone: "danger" },
  { value: "klant", label: "Is a client", tone: "success" },
  { value: "lopend_gesprek", label: "Ongoing conversation", tone: "brand" },
  { value: "niet_bellen", label: "Do not call", tone: "warning" },
];

export const suppressionScopes: Option<SuppressionScope>[] = [
  { value: "alle_kanalen", label: "All channels", tone: "danger" },
  { value: "alleen_bellen", label: "Calls only", tone: "warning" },
  { value: "alleen_mail", label: "Mail only", tone: "warning" },
];

export const jobStatuses: Option<JobStatus>[] = [
  { value: "running", label: "Running", tone: "brand" },
  { value: "success", label: "Succeeded", tone: "success" },
  { value: "failed", label: "Failed", tone: "danger" },
];

export const talentStages: Option<TalentStage>[] = [
  { value: "intake", label: "Intake", tone: "neutral" },
  { value: "zoeken", label: "Searching", tone: "brand" },
  { value: "profielen_verstuurd", label: "Profiles sent", tone: "accent" },
  { value: "gesprekken", label: "Interviews", tone: "accent" },
  { value: "geplaatst", label: "Placed", tone: "success" },
  { value: "gesloten", label: "Closed", tone: "neutral" },
];

export const matchStatuses: Option<MatchStatus>[] = [
  { value: "voorgesteld", label: "Suggested", tone: "neutral" },
  { value: "goedgekeurd", label: "Approved", tone: "brand" },
  { value: "verstuurd", label: "Sent", tone: "accent" },
  { value: "gesprek", label: "Interview", tone: "accent" },
  { value: "aangenomen", label: "Hired", tone: "success" },
  { value: "afgewezen", label: "Rejected", tone: "danger" },
];

export const entityTypes: Record<EntityType, { label: string; href: (id: string) => string }> = {
  client: { label: "Client", href: (id) => `/dashboard/clients/${id}` },
  vacancy: { label: "Vacancy", href: (id) => `/dashboard/vacancies/${id}` },
  candidate: { label: "Candidate", href: (id) => `/dashboard/candidates/${id}` },
  application: { label: "Application", href: (id) => `/dashboard/candidates?application=${id}` },
  placement: { label: "Placement", href: (id) => `/dashboard/placements/${id}` },
  company: { label: "Lead", href: (id) => `/dashboard/leads/${id}` },
};

/** Look up the option for a value, e.g. optionFor(clientStatuses, "active"). */
export function optionFor<T extends string>(options: Option<T>[], value: T): Option<T> {
  return options.find((o) => o.value === value) ?? { value, label: value, tone: "neutral" };
}
