import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ClientStatus, PlacementStatus, VacancyStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { clientStatuses } from "@/lib/labels";
import { daysBetween } from "@/lib/format";

/** Escape % and _ so user input is matched literally in ilike. */
export function likePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from the URL are checked first, so a malformed id becomes a 404, not a database error. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isClientStatus(value: unknown): value is ClientStatus {
  return clientStatuses.some((s) => s.value === value);
}

export type ClientListItem = {
  id: string;
  name: string;
  status: ClientStatus;
  city: string | null;
  industry: string | null;
  openVacancies: number;
  ownerName: string | null;
};

export async function listClients({
  q,
  status,
}: {
  q?: string;
  status?: ClientStatus;
}): Promise<ClientListItem[]> {
  await requireStaff();
  const supabase = await createClient();

  let query = supabase
    .from("clients")
    .select(
      "id, name, status, city, industry, owner:profiles!clients_owner_id_fkey(full_name, email), vacancies(status)",
    )
    .order("name");

  if (q) query = query.ilike("name", likePattern(q));
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(`Klanten laden mislukt: ${error.message}`);

  return data.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    city: c.city,
    industry: c.industry,
    openVacancies: c.vacancies.filter((v) => v.status === "open").length,
    ownerName: c.owner?.full_name || c.owner?.email || null,
  }));
}

export async function getClient(id: string) {
  await requireStaff();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*, owner:profiles!clients_owner_id_fkey(id, full_name, email)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Klant laden mislukt: ${error.message}`);
  return data;
}

export async function getClientContacts(clientId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_contacts")
    .select("id, full_name, email, phone, job_title, is_primary")
    .eq("client_id", clientId)
    .order("is_primary", { ascending: false })
    .order("full_name");
  if (error) throw new Error(`Contactpersonen laden mislukt: ${error.message}`);
  return data;
}

export type ClientVacancyItem = {
  id: string;
  title: string;
  status: VacancyStatus;
  openedAt: string;
  daysOpen: number;
};

export async function getClientVacancies(clientId: string): Promise<ClientVacancyItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancies")
    .select("id, title, status, opened_at, closed_at")
    .eq("client_id", clientId)
    .order("opened_at", { ascending: false });
  if (error) throw new Error(`Vacatures laden mislukt: ${error.message}`);
  return data.map((v) => ({
    id: v.id,
    title: v.title,
    status: v.status,
    openedAt: v.opened_at,
    daysOpen: Math.max(0, daysBetween(v.opened_at, v.closed_at ?? new Date())),
  }));
}

export type ClientPlacementItem = {
  id: string;
  candidateName: string;
  vacancyTitle: string | null;
  startDate: string;
  status: PlacementStatus;
};

export async function getClientPlacements(clientId: string): Promise<ClientPlacementItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("placements")
    .select("id, start_date, status, candidate:candidates(full_name), vacancy:vacancies(title)")
    .eq("client_id", clientId)
    .order("start_date", { ascending: false });
  if (error) throw new Error(`Plaatsingen laden mislukt: ${error.message}`);
  return data.map((p) => ({
    id: p.id,
    candidateName: p.candidate?.full_name ?? "Onbekende kandidaat",
    vacancyTitle: p.vacancy?.title ?? null,
    startDate: p.start_date,
    status: p.status,
  }));
}

export type Option = { id: string; label: string };

/** Nordavo team members, for owner pickers. */
export async function listStaffOptions(): Promise<Option[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("role", ["admin", "member"])
    .order("full_name");
  if (error) throw new Error(`Teamleden laden mislukt: ${error.message}`);
  return data.map((p) => ({ id: p.id, label: p.full_name || p.email || "Teamlid" }));
}

/** All clients as picker options. */
export async function listClientOptions(): Promise<Option[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").select("id, name").order("name");
  if (error) throw new Error(`Klanten laden mislukt: ${error.message}`);
  return data.map((c) => ({ id: c.id, label: c.name }));
}
