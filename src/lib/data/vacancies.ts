import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ApplicationStage, Seniority, VacancyStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { applicationStages, vacancyStatuses } from "@/lib/labels";
import { daysBetween } from "@/lib/format";
import { likePattern } from "@/lib/data/clients";

/** Our promise: 3 candidates within 3 weeks. */
export const PRESENTED_TARGET = 3;

/** Stages that count as "presented to the client". */
const PRESENTED_STAGES: ApplicationStage[] = ["presented", "final_interview", "placed"];

export function isVacancyStatus(value: unknown): value is VacancyStatus {
  return vacancyStatuses.some((s) => s.value === value);
}

/** Days a vacancy has been open, counted up to closed_at when it is closed. */
export function vacancyDaysOpen(v: { opened_at: string; closed_at: string | null }) {
  return Math.max(0, daysBetween(v.opened_at, v.closed_at ?? new Date()));
}

export type VacancyListItem = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
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
}: {
  q?: string;
  statuses?: VacancyStatus[];
  clientId?: string;
}): Promise<VacancyListItem[]> {
  await requireStaff();
  const supabase = await createClient();

  let query = supabase
    .from("vacancies")
    .select(
      "id, title, client_id, seniority, status, stack, opened_at, closed_at, client:clients(name), applications(stage)",
    )
    .order("opened_at", { ascending: true });

  if (q) query = query.ilike("title", likePattern(q));
  if (statuses && statuses.length > 0) query = query.in("status", statuses);
  if (clientId) query = query.eq("client_id", clientId);

  const { data, error } = await query;
  if (error) throw new Error(`Vacatures laden mislukt: ${error.message}`);

  return data.map((v) => ({
    id: v.id,
    title: v.title,
    clientId: v.client_id,
    clientName: v.client?.name ?? "Onbekende klant",
    seniority: v.seniority,
    status: v.status,
    stack: v.stack,
    inPipeline: v.applications.filter((a) => a.stage !== "rejected").length,
    daysOpen: vacancyDaysOpen(v),
  }));
}

export async function getVacancy(id: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancies")
    .select(
      "*, client:clients(id, name), owner:profiles!vacancies_owner_id_fkey(id, full_name, email)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Vacature laden mislukt: ${error.message}`);
  if (!data) return null;
  return { ...data, daysOpen: vacancyDaysOpen(data) };
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
