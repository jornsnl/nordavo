import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ApplicationStage } from "@/lib/database.types";
import { todayIso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { addDays, diffDays } from "@/components/placements/dates";

/** Nordavo promises three candidates within three weeks. */
export const PROMISED_CANDIDATES = 3;
export const PROMISED_DAYS = 21;

const PRESENTED_STAGES: ApplicationStage[] = ["presented", "final_interview", "placed"];

export async function getOverviewStats() {
  await requireStaff();
  const supabase = await createClient();

  const [clients, vacancies, applications, placements] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("vacancies").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .not("stage", "in", "(placed,rejected)"),
    supabase
      .from("placements")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "notice"]),
  ]);

  const error = clients.error ?? vacancies.error ?? applications.error ?? placements.error;
  if (error) throw new Error(`Kerncijfers laden mislukt: ${error.message}`);

  return {
    activeClients: clients.count ?? 0,
    openVacancies: vacancies.count ?? 0,
    candidatesInSelection: applications.count ?? 0,
    activePlacements: placements.count ?? 0,
  };
}

export type AttentionSignal = "late" | "soon" | "on_track" | "done";

/** Open vacancies, longest open first, with the 3 in 3 weeks signal. */
export async function getVacanciesNeedingAttention(limit = 6) {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vacancies")
    .select("id, title, opened_at, client:clients(id, name), applications(stage, presented_at)")
    .eq("status", "open")
    .order("opened_at", { ascending: true });

  if (error) throw new Error(`Vacatures laden mislukt: ${error.message}`);

  const today = todayIso();
  const rows = data.map((vacancy) => {
    const daysOpen = Math.max(0, diffDays(vacancy.opened_at, today));
    const presented = vacancy.applications.filter(
      // Also counts candidates the client saw and later turned down.
      (a) => PRESENTED_STAGES.includes(a.stage) || a.presented_at !== null,
    ).length;
    const signal: AttentionSignal =
      presented >= PROMISED_CANDIDATES
        ? "done"
        : daysOpen >= PROMISED_DAYS
          ? "late"
          : daysOpen >= 14
            ? "soon"
            : "on_track";
    return {
      id: vacancy.id,
      title: vacancy.title,
      client: vacancy.client,
      daysOpen,
      presented,
      signal,
    };
  });

  return {
    total: rows.length,
    // Vacancies that already have three candidates presented need less attention.
    items: rows
      .sort((a, b) => Number(a.signal === "done") - Number(b.signal === "done") || b.daysOpen - a.daysOpen)
      .slice(0, limit),
  };
}

export type MomentKind = "checkin" | "guarantee" | "notice";

export type Moment = {
  kind: MomentKind;
  date: string;
  overdue: boolean;
  placementId: string;
  candidateName: string;
  clientName: string;
};

/**
 * Check-ins due within 14 days (or overdue), guarantee periods ending
 * within 7 days and notice periods ending within 30 days.
 */
export async function getUpcomingMoments() {
  await requireStaff();
  const supabase = await createClient();

  const today = todayIso();
  const in14 = addDays(today, 14);
  const in7 = addDays(today, 7);
  const in30 = addDays(today, 30);

  const { data, error } = await supabase
    .from("placements")
    .select(
      "id, status, next_checkin_at, guarantee_until, end_date, candidate:candidates(full_name), client:clients(name)",
    )
    .in("status", ["active", "notice"]);

  if (error) throw new Error(`Momenten laden mislukt: ${error.message}`);

  const moments: Moment[] = [];
  for (const p of data) {
    const base = {
      placementId: p.id,
      candidateName: p.candidate?.full_name ?? "Onbekende kandidaat",
      clientName: p.client?.name ?? "Onbekende klant",
    };
    if (p.next_checkin_at && p.next_checkin_at <= in14) {
      moments.push({ ...base, kind: "checkin", date: p.next_checkin_at, overdue: p.next_checkin_at < today });
    }
    if (p.status === "active" && p.guarantee_until && p.guarantee_until >= today && p.guarantee_until <= in7) {
      moments.push({ ...base, kind: "guarantee", date: p.guarantee_until, overdue: false });
    }
    if (p.status === "notice" && p.end_date && p.end_date <= in30) {
      moments.push({ ...base, kind: "notice", date: p.end_date, overdue: p.end_date < today });
    }
  }

  return moments.sort((a, b) => a.date.localeCompare(b.date));
}

/** Number of applications per stage, across open vacancies. */
export async function getPipelineFunnel() {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select("stage, vacancy:vacancies!inner(status)")
    .eq("vacancy.status", "open");

  if (error) throw new Error(`Pipeline laden mislukt: ${error.message}`);

  const counts = new Map<ApplicationStage, number>();
  for (const row of data) {
    counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1);
  }
  return counts;
}
