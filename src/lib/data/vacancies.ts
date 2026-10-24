import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ApplicationStage, Seniority, TalentStage, VacancyStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { applicationStages, talentStages, vacancyStatuses } from "@/lib/labels";
import { leadTime, type LeadTime } from "@/lib/talent/lead-time";
import { daysBetween } from "@/lib/format";
import { isUuid, likePattern } from "@/lib/data/clients";

/** Our promise: 3 candidates within 3 weeks. */
export const PRESENTED_TARGET = 3;

/** Stages that count as "presented to the client". */
const PRESENTED_STAGES: ApplicationStage[] = ["presented", "final_interview", "placed"];

export function isVacancyStatus(value: unknown): value is VacancyStatus {
  return vacancyStatuses.some((s) => s.value === value);
}

export function isTalentStage(value: unknown): value is TalentStage {
  return talentStages.some((s) => s.value === value);
}

/** Days a vacancy has been open, counted up to closed_at when it is closed. */
export function vacancyDaysOpen(v: { opened_at: string; closed_at: string | null }) {
  return Math.max(0, daysBetween(v.opened_at, v.closed_at ?? new Date()));
}

export type VacancyListItem = {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  /** GTM prospect, for vacancies of a company that is not a client yet. */
  companyId: string | null;
  companyName: string | null;
  talentStage: TalentStage;
  leadTime: LeadTime;
  seniority: Seniority;
  status: VacancyStatus;
  stack: string[];
  inPipeline: number;
  daysOpen: number;
};

export async function listVacancies({
  q,
  statuses,
  clientId,
  talentStage,
}: {
  q?: string;
  statuses?: VacancyStatus[];
  clientId?: string;
  talentStage?: TalentStage;
}): Promise<VacancyListItem[]> {
  await requireStaff();
  const supabase = await createClient();

  let query = supabase
    .from("vacancies")
    .select(
      "id, title, client_id, company_id, seniority, status, stack, opened_at, closed_at, talent_stage, intake_at, profiles_sent_at, client:clients(name), company:companies(name), applications(stage)",
    )
    .order("opened_at", { ascending: true });

  if (q) query = query.ilike("title", likePattern(q));
  if (statuses && statuses.length > 0) query = query.in("status", statuses);
  if (clientId && isUuid(clientId)) query = query.eq("client_id", clientId);
  if (talentStage) query = query.eq("talent_stage", talentStage);

  const { data, error } = await query;
  if (error) throw new Error(`Vacatures laden mislukt: ${error.message}`);

  return data.map((v) => ({
    id: v.id,
    title: v.title,
    clientId: v.client_id,
    clientName: v.client?.name ?? null,
    companyId: v.company_id,
    companyName: v.company?.name ?? null,
    talentStage: v.talent_stage,
    leadTime: leadTime(v),
    seniority: v.seniority,
    status: v.status,
    stack: v.stack,
    inPipeline: v.applications.filter((a) => a.stage !== "rejected").length,
    daysOpen: vacancyDaysOpen(v),
  }));
}

export async function getVacancy(id: string) {
  await requireStaff();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancies")
    .select(
      "*, client:clients(id, name), company:companies(id, name, domain), owner:profiles!vacancies_owner_id_fkey(id, full_name, email)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Vacature laden mislukt: ${error.message}`);
  if (!data) return null;
  return { ...data, daysOpen: vacancyDaysOpen(data), leadTime: leadTime(data) };
}

/**
 * GTM companies a vacancy can belong to: GO prospects and active or client
 * companies, plus the one already selected. Capped, sorted by name.
 */
export async function listCompanyOptions(selectedId?: string | null): Promise<{ id: string; label: string }[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, domain")
    .or("icp_decision.eq.GO,status.in.(actief,klant)")
    .order("name")
    .limit(500);
  if (error) throw new Error(`Bedrijven laden mislukt: ${error.message}`);
  const options = data.map((c) => ({ id: c.id, label: `${c.name} (${c.domain})` }));
  if (selectedId && isUuid(selectedId) && !options.some((o) => o.id === selectedId)) {
    const { data: selected } = await supabase.from("companies").select("id, name, domain").eq("id", selectedId).maybeSingle();
    if (selected) options.unshift({ id: selected.id, label: `${selected.name} (${selected.domain})` });
  }
  return options;
}

export type PipelineSummary = {
  stages: { stage: ApplicationStage; label: string; count: number }[];
  total: number;
  active: number;
  rejected: number;
  presented: number;
};

export async function getVacancyPipelineSummary(vacancyId: string): Promise<PipelineSummary> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("stage, presented_at")
    .eq("vacancy_id", vacancyId);
  if (error) throw new Error(`Pipeline laden mislukt: ${error.message}`);

  const counts = new Map<ApplicationStage, number>();
  for (const a of data) counts.set(a.stage, (counts.get(a.stage) ?? 0) + 1);

  const rejected = counts.get("rejected") ?? 0;
  return {
    stages: applicationStages.map((s) => ({
      stage: s.value,
      label: s.label,
      count: counts.get(s.value) ?? 0,
    })),
    total: data.length,
    active: data.length - rejected,
    rejected,
    presented: data.filter((a) => a.presented_at !== null || PRESENTED_STAGES.includes(a.stage))
      .length,
  };
}
