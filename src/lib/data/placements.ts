import "server-only";
import { requireStaff } from "@/lib/auth";
import type { PlacementStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

const LIST_COLUMNS = `
  id, status, start_date, end_date, monthly_rate, guarantee_until,
  next_checkin_at, notice_given_at,
  client:clients(id, name),
  candidate:candidates(id, full_name),
  vacancy:vacancies(id, title)
` as const;

export type PlacementFilter = {
  statuses: PlacementStatus[];
  clientId?: string;
};

export async function listPlacements({ statuses, clientId }: PlacementFilter) {
  await requireStaff();
  const supabase = await createClient();

  let query = supabase
    .from("placements")
    .select(LIST_COLUMNS)
    .order("start_date", { ascending: false });

  if (statuses.length > 0) query = query.in("status", statuses);
  if (clientId) query = query.eq("client_id", clientId);

  const { data, error } = await query;
  if (error) throw new Error(`Plaatsingen laden mislukt: ${error.message}`);
  return data;
}

export type PlacementListItem = Awaited<ReturnType<typeof listPlacements>>[number];

export async function getPlacement(id: string) {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("placements")
    .select(
      `
      id, status, start_date, end_date, monthly_rate, guarantee_until,
      next_checkin_at, notice_given_at, notes, application_id,
      client_id, candidate_id, vacancy_id, created_at,
      client:clients(id, name),
      candidate:candidates(id, full_name, current_title),
      vacancy:vacancies(id, title)
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Plaatsing laden mislukt: ${error.message}`);
  return data;
}

export type PlacementDetail = NonNullable<Awaited<ReturnType<typeof getPlacement>>>;

export async function listCheckins(placementId: string) {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("placement_checkins")
    .select("id, checkin_date, rating, notes, created_at, author:profiles(full_name)")
    .eq("placement_id", placementId)
    .order("checkin_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Check-ins laden mislukt: ${error.message}`);
  return data;
}

export type CheckinItem = Awaited<ReturnType<typeof listCheckins>>[number];

/** Clients, candidates and vacancies for the placement form. */
export async function getPlacementFormOptions() {
  await requireStaff();
  const supabase = await createClient();

  const [clients, candidates, vacancies] = await Promise.all([
    supabase.from("clients").select("id, name, status").order("name"),
    supabase.from("candidates").select("id, full_name, status").order("full_name"),
    supabase
      .from("vacancies")
      .select("id, title, client_id, status")
      .order("opened_at", { ascending: false }),
  ]);

  const error = clients.error ?? candidates.error ?? vacancies.error;
  if (error) throw new Error(`Formuliergegevens laden mislukt: ${error.message}`);

  return {
    clients: clients.data ?? [],
    candidates: candidates.data ?? [],
    vacancies: vacancies.data ?? [],
  };
}

export type PlacementFormOptions = Awaited<ReturnType<typeof getPlacementFormOptions>>;

/** Clients for the filter on the list page. */
export async function listPlacementClientOptions() {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").select("id, name").order("name");
  if (error) throw new Error(`Klanten laden mislukt: ${error.message}`);
  return data;
}

/** The application a placement is created from (pipeline "placed"). */
export async function getApplicationForPlacement(applicationId: string) {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select(
      `
      id, stage, vacancy_id, candidate_id,
      vacancy:vacancies(id, title, client_id, monthly_budget, desired_start_date, client:clients(id, name)),
      candidate:candidates(id, full_name)
    `,
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (error) throw new Error(`Sollicitatie laden mislukt: ${error.message}`);
  return data;
}

export type PlacementApplication = NonNullable<
  Awaited<ReturnType<typeof getApplicationForPlacement>>
>;

/** An existing placement for this application, to avoid placing twice. */
export async function findPlacementForApplication(applicationId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from("placements")
    .select("id")
    .eq("application_id", applicationId)
    .limit(1)
    .maybeSingle();
  return data;
}
