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
  { value: "active", label: "Actief", tone: "success" },
  { value: "inactive", label: "Inactief", tone: "neutral" },
];

export const vacancyStatuses: Option<VacancyStatus>[] = [
  { value: "open", label: "Open", tone: "brand" },
  { value: "on_hold", label: "On hold", tone: "warning" },
  { value: "filled", label: "Ingevuld", tone: "success" },
  { value: "closed", label: "Gesloten", tone: "neutral" },
];

export const seniorities: Option<Seniority>[] = [
  { value: "medior", label: "Medior", tone: "neutral" },
  { value: "senior", label: "Senior", tone: "brand" },
  { value: "lead", label: "Lead", tone: "accent" },
];

export const candidateStatuses: Option<CandidateStatus>[] = [
  { value: "available", label: "Beschikbaar", tone: "success" },
  { value: "in_process", label: "In proces", tone: "brand" },
  { value: "placed", label: "Geplaatst", tone: "accent" },
  { value: "unavailable", label: "Niet beschikbaar", tone: "neutral" },
];

/** Pipeline columns, in order. "rejected" is shown apart from the flow. */
export const applicationStages: Option<ApplicationStage>[] = [
  { value: "sourced", label: "Gesourcet", tone: "neutral" },
  { value: "screening", label: "Screening", tone: "neutral" },
  { value: "technical_test", label: "Technische test", tone: "brand" },
  { value: "english_interview", label: "Engels interview", tone: "brand" },
  { value: "presented", label: "Voorgesteld aan klant", tone: "accent" },
  { value: "final_interview", label: "Eindgesprek", tone: "accent" },
  { value: "placed", label: "Geplaatst", tone: "success" },
  { value: "rejected", label: "Afgewezen", tone: "danger" },
];

export const clientDecisions: Option<ClientDecision>[] = [
  { value: "pending", label: "Wacht op klant", tone: "warning" },
  { value: "approved", label: "Akkoord", tone: "success" },
  { value: "rejected", label: "Afgewezen", tone: "danger" },
];

export const placementStatuses: Option<PlacementStatus>[] = [
  { value: "active", label: "Actief", tone: "success" },
  { value: "notice", label: "Opgezegd", tone: "warning" },
  { value: "ended", label: "Beëindigd", tone: "neutral" },
];

export const taskStatuses: Option<TaskStatus>[] = [
  { value: "todo", label: "Te doen", tone: "neutral" },
  { value: "in_progress", label: "Bezig", tone: "brand" },
  { value: "done", label: "Klaar", tone: "success" },
];

export const taskPriorities: Option<TaskPriority>[] = [
  { value: "low", label: "Laag", tone: "neutral" },
  { value: "normal", label: "Normaal", tone: "brand" },
  { value: "high", label: "Hoog", tone: "danger" },
];

export const profileRoles: Option<ProfileRole>[] = [
  { value: "admin", label: "Beheerder", tone: "accent" },
  { value: "member", label: "Teamlid", tone: "brand" },
  { value: "client", label: "Klant", tone: "neutral" },
];

// ---------------------------------------------------------------------------
// GTM
// ---------------------------------------------------------------------------

export const segments: Option<Segment>[] = [
  { value: "saas", label: "SaaS", tone: "brand" },
  { value: "productie", label: "Productie", tone: "neutral" },
  { value: "agency_automation", label: "Automation agency", tone: "accent" },
  { value: "agency_overig", label: "Overige agency", tone: "neutral" },
];

export const icpDecisions: Option<IcpDecision>[] = [
  { value: "GO", label: "GO", tone: "success" },
  { value: "REVIEW", label: "Review", tone: "warning" },
  { value: "NO_GO", label: "No go", tone: "danger" },
];

export const companyStatuses: Option<CompanyStatus>[] = [
  { value: "nieuw", label: "Nieuw", tone: "neutral" },
  { value: "actief", label: "Actief", tone: "brand" },
  { value: "klant", label: "Klant", tone: "success" },
  { value: "verloren", label: "Verloren", tone: "neutral" },
  { value: "uitgesloten", label: "Uitgesloten", tone: "danger" },
];

export const contactStatuses: Option<ContactStatus>[] = [
  { value: "nieuw", label: "Nieuw", tone: "neutral" },
  { value: "gekwalificeerd", label: "Gekwalificeerd", tone: "brand" },
  { value: "verrijkt", label: "Verrijkt", tone: "brand" },
  { value: "op_bellijst", label: "Op bellijst", tone: "accent" },
  { value: "in_mailcampagne", label: "In mailcampagne", tone: "accent" },
  { value: "bereikt", label: "Bereikt", tone: "brand" },
  { value: "afspraak", label: "Afspraak", tone: "success" },
  { value: "kans", label: "Kans", tone: "success" },
  { value: "klant", label: "Klant", tone: "success" },
  { value: "verloren", label: "Verloren", tone: "neutral" },
  { value: "uitgesloten", label: "Uitgesloten", tone: "danger" },
];

/** Contact tiers: who to approach first. */
export const contactTiers: Option<"1" | "2" | "3">[] = [
  { value: "1", label: "Tier 1: CTO, Head of Engineering of Data", tone: "accent" },
  { value: "2", label: "Tier 2: eigenaar of directeur", tone: "brand" },
  { value: "3", label: "Tier 3: recruiter of HR", tone: "neutral" },
];

export const emailStatuses: Option<EmailStatus>[] = [
  { value: "valid", label: "Geverifieerd", tone: "success" },
  { value: "catch_all", label: "Catch-all", tone: "warning" },
  { value: "unknown", label: "Onbekend", tone: "neutral" },
  { value: "invalid", label: "Ongeldig", tone: "danger" },
];

export const signalTypes: Option<SignalType>[] = [
  { value: "vacature", label: "Vacature", tone: "brand" },
  { value: "lang_open", label: "Lang open", tone: "accent" },
  { value: "meerdere_rollen", label: "Meerdere rollen", tone: "accent" },
  { value: "remote_extern", label: "Remote of extern team", tone: "accent" },
  { value: "freelance", label: "Freelance opdracht", tone: "neutral" },
  { value: "funding", label: "Funding", tone: "success" },
  { value: "nieuwe_cto", label: "Nieuwe CTO", tone: "success" },
  { value: "overig", label: "Overig", tone: "neutral" },
];

export const activityChannels: Option<ActivityChannel>[] = [
  { value: "bellen", label: "Bellen", tone: "brand" },
  { value: "mail", label: "Mail", tone: "brand" },
  { value: "linkedin", label: "LinkedIn", tone: "brand" },
  { value: "meeting", label: "Meeting", tone: "success" },
];

export const activityOutcomes: Option<ActivityOutcome>[] = [
  { value: "verstuurd", label: "Verstuurd", tone: "neutral" },
  { value: "geen_gehoor", label: "Geen gehoor", tone: "neutral" },
  { value: "bereikt", label: "Bereikt", tone: "brand" },
  { value: "terugbellen", label: "Terugbellen", tone: "warning" },
  { value: "afspraak", label: "Afspraak gepland", tone: "success" },
  { value: "afspraak_goedgekeurd", label: "Afspraak goedgekeurd", tone: "success" },
  { value: "afspraak_afgekeurd", label: "Afspraak afgekeurd", tone: "danger" },
  { value: "niet_geinteresseerd", label: "Niet geïnteresseerd", tone: "neutral" },
  { value: "reply_positief", label: "Positieve reply", tone: "success" },
  { value: "reply_neutraal", label: "Neutrale reply", tone: "brand" },
  { value: "reply_negatief", label: "Negatieve reply", tone: "neutral" },
  { value: "bounce", label: "Bounce", tone: "danger" },
  { value: "afgemeld", label: "Afgemeld", tone: "danger" },
  { value: "gesprek_gehad", label: "Gesprek gehad", tone: "success" },
  { value: "gewonnen", label: "Gewonnen", tone: "success" },
  { value: "verloren", label: "Verloren", tone: "neutral" },
  { value: "notitie", label: "Notitie", tone: "neutral" },
];

export const suppressionReasons: Option<SuppressionReason>[] = [
  { value: "afgemeld", label: "Afgemeld", tone: "danger" },
  { value: "bezwaar", label: "Bezwaar", tone: "danger" },
  { value: "klant", label: "Is klant", tone: "success" },
  { value: "lopend_gesprek", label: "Lopend gesprek", tone: "brand" },
  { value: "niet_bellen", label: "Niet bellen", tone: "warning" },
];

export const suppressionScopes: Option<SuppressionScope>[] = [
  { value: "alle_kanalen", label: "Alle kanalen", tone: "danger" },
  { value: "alleen_bellen", label: "Alleen bellen", tone: "warning" },
  { value: "alleen_mail", label: "Alleen mail", tone: "warning" },
];

export const jobStatuses: Option<JobStatus>[] = [
  { value: "running", label: "Bezig", tone: "brand" },
  { value: "success", label: "Gelukt", tone: "success" },
  { value: "failed", label: "Mislukt", tone: "danger" },
];

export const talentStages: Option<TalentStage>[] = [
  { value: "intake", label: "Intake", tone: "neutral" },
  { value: "zoeken", label: "Zoeken", tone: "brand" },
  { value: "profielen_verstuurd", label: "Profielen verstuurd", tone: "accent" },
  { value: "gesprekken", label: "Gesprekken", tone: "accent" },
  { value: "geplaatst", label: "Geplaatst", tone: "success" },
  { value: "gesloten", label: "Gesloten", tone: "neutral" },
];

export const matchStatuses: Option<MatchStatus>[] = [
  { value: "voorgesteld", label: "Voorgesteld", tone: "neutral" },
  { value: "goedgekeurd", label: "Goedgekeurd", tone: "brand" },
  { value: "verstuurd", label: "Verstuurd", tone: "accent" },
  { value: "gesprek", label: "Gesprek", tone: "accent" },
  { value: "aangenomen", label: "Aangenomen", tone: "success" },
  { value: "afgewezen", label: "Afgewezen", tone: "danger" },
];

export const entityTypes: Record<EntityType, { label: string; href: (id: string) => string }> = {
  client: { label: "Klant", href: (id) => `/dashboard/klanten/${id}` },
  vacancy: { label: "Vacature", href: (id) => `/dashboard/vacatures/${id}` },
  candidate: { label: "Kandidaat", href: (id) => `/dashboard/kandidaten/${id}` },
  application: { label: "Sollicitatie", href: (id) => `/dashboard/kandidaten?application=${id}` },
  placement: { label: "Plaatsing", href: (id) => `/dashboard/plaatsingen/${id}` },
};

/** Look up the option for a value, e.g. optionFor(clientStatuses, "active"). */
export function optionFor<T extends string>(options: Option<T>[], value: T): Option<T> {
  return options.find((o) => o.value === value) ?? { value, label: value, tone: "neutral" };
}
