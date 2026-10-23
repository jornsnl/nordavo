import type {
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
