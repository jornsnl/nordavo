import "server-only";
import { requireModule } from "@/lib/auth";
import { listCustomFieldDefinitions } from "@/lib/custom-fields/data";
import { customFieldColumns, exportFileName, toCsv, type ExportColumn } from "@/lib/custom-fields/export";
import type { LayoutEntity } from "@/lib/custom-fields/layout";
import { todayIso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

/**
 * CSV export of one record type with every custom field (Settings, Fields
 * decides which fields exist). Read with the user's own session, so row level
 * security applies. GET /dashboard/<candidates|vacancies|clients|placements>/export
 */

type Person = { full_name: string | null; email: string | null } | null;
const person = (p: Person) => (p ? p.full_name || p.email : null);

const MAX_ROWS = 20_000;

async function rowsAndColumns(entity: LayoutEntity): Promise<{ csv: string; what: string }> {
  const supabase = await createClient();
  const defs = await listCustomFieldDefinitions({ entity });

  if (entity === "candidate") {
    const { data, error } = await supabase
      .from("candidates")
      .select(
        "id, full_name, email, phone, location, current_title, years_experience, seniority, skills, status, availability, english_level, origin, source, is_topper, linkedin_url, created_at, custom_fields, owner:profiles!candidates_owner_id_fkey(full_name, email)",
      )
      .order("full_name")
      .limit(MAX_ROWS);
    if (error) throw new Error(`Could not load candidates: ${error.message}`);
    type Row = (typeof data)[number];
    const fixed: ExportColumn<Row>[] = [
      { header: "Id", value: (r) => r.id },
      { header: "Name", value: (r) => r.full_name },
      { header: "Email", value: (r) => r.email },
      { header: "Phone", value: (r) => r.phone },
      { header: "Location", value: (r) => r.location },
      { header: "Role", value: (r) => r.current_title },
      { header: "Years of experience", value: (r) => r.years_experience },
      { header: "Seniority", value: (r) => r.seniority },
      { header: "Skills", value: (r) => r.skills },
      { header: "Status", value: (r) => r.status },
      { header: "Availability", value: (r) => r.availability },
      { header: "English", value: (r) => r.english_level },
      { header: "Origin", value: (r) => r.origin },
      { header: "Source", value: (r) => r.source },
      { header: "Topper", value: (r) => r.is_topper },
      { header: "LinkedIn", value: (r) => r.linkedin_url },
      { header: "Owner", value: (r) => person(r.owner) },
      { header: "Created", value: (r) => r.created_at.slice(0, 10) },
    ];
    const columns = [...fixed, ...customFieldColumns<Row>(defs, (r) => r.custom_fields, fixed.map((c) => c.header))];
    return { csv: toCsv(columns, data), what: "candidates" };
  }

  if (entity === "vacancy") {
    const { data, error } = await supabase
      .from("vacancies")
      .select(
        "id, title, status, seniority, stack, monthly_budget, desired_start_date, opened_at, closed_at, intake_at, profiles_sent_at, first_interview_at, start_at, is_talent_pool, created_at, custom_fields, client:clients(name), company:companies(name), owner:profiles!vacancies_owner_id_fkey(full_name, email)",
      )
      .order("opened_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw new Error(`Could not load vacancies: ${error.message}`);
    type Row = (typeof data)[number];
    const day = (v: string | null) => (v ? v.slice(0, 10) : null);
    const fixed: ExportColumn<Row>[] = [
      { header: "Id", value: (r) => r.id },
      { header: "Title", value: (r) => r.title },
      { header: "Client", value: (r) => r.client?.name ?? (r.company ? `${r.company.name} (prospect)` : r.is_talent_pool ? "Talent pool" : null) },
      { header: "Status", value: (r) => r.status },
      { header: "Seniority", value: (r) => r.seniority },
      { header: "Stack", value: (r) => r.stack },
      { header: "Monthly budget", value: (r) => r.monthly_budget },
      { header: "Opened on", value: (r) => day(r.opened_at) },
      { header: "Intake", value: (r) => day(r.intake_at) },
      { header: "Profiles sent", value: (r) => day(r.profiles_sent_at) },
      { header: "First interview", value: (r) => day(r.first_interview_at) },
      { header: "Desired start", value: (r) => day(r.desired_start_date) },
      { header: "Start", value: (r) => day(r.start_at) },
      { header: "Closed on", value: (r) => day(r.closed_at) },
      { header: "Talent pool", value: (r) => r.is_talent_pool },
      { header: "Owner", value: (r) => person(r.owner) },
    ];
    const columns = [...fixed, ...customFieldColumns<Row>(defs, (r) => r.custom_fields, fixed.map((c) => c.header))];
    return { csv: toCsv(columns, data), what: "vacancies" };
  }

  if (entity === "client") {
    const { data, error } = await supabase
      .from("clients")
      .select("id, name, status, website, industry, city, notes, created_at, custom_fields, owner:profiles!clients_owner_id_fkey(full_name, email)")
      .order("name")
      .limit(MAX_ROWS);
    if (error) throw new Error(`Could not load clients: ${error.message}`);
    type Row = (typeof data)[number];
    const fixed: ExportColumn<Row>[] = [
      { header: "Id", value: (r) => r.id },
      { header: "Name", value: (r) => r.name },
      { header: "Status", value: (r) => r.status },
      { header: "Website", value: (r) => r.website },
      { header: "Industry", value: (r) => r.industry },
      { header: "Location", value: (r) => r.city },
      { header: "Owner", value: (r) => person(r.owner) },
      { header: "Client since", value: (r) => r.created_at.slice(0, 10) },
      { header: "Notes", value: (r) => r.notes },
    ];
    const columns = [...fixed, ...customFieldColumns<Row>(defs, (r) => r.custom_fields, fixed.map((c) => c.header))];
    return { csv: toCsv(columns, data), what: "clients" };
  }

  const { data, error } = await supabase
    .from("placements")
    .select(
      "id, status, start_date, end_date, monthly_rate, hours_per_week, guarantee_until, next_checkin_at, notice_given_at, probation_end_date, custom_fields, candidate:candidates(full_name), client:clients(name), vacancy:vacancies(title)",
    )
    .order("start_date", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new Error(`Could not load placements: ${error.message}`);
  type Row = (typeof data)[number];
  const fixed: ExportColumn<Row>[] = [
    { header: "Id", value: (r) => r.id },
    { header: "Candidate", value: (r) => r.candidate?.full_name ?? null },
    { header: "Client", value: (r) => r.client?.name ?? null },
    { header: "Vacancy", value: (r) => r.vacancy?.title ?? null },
    { header: "Status", value: (r) => r.status },
    { header: "Start date", value: (r) => r.start_date },
    { header: "End date", value: (r) => r.end_date },
    { header: "Monthly rate", value: (r) => r.monthly_rate },
    { header: "Hours per week", value: (r) => r.hours_per_week },
    { header: "Probation ends", value: (r) => r.probation_end_date },
    { header: "Guarantee until", value: (r) => r.guarantee_until },
    { header: "Next check-in", value: (r) => r.next_checkin_at },
    { header: "Notice given on", value: (r) => r.notice_given_at },
  ];
  const columns = [...fixed, ...customFieldColumns<Row>(defs, (r) => r.custom_fields, fixed.map((c) => c.header))];
  return { csv: toCsv(columns, data), what: "placements" };
}

/** The CSV response for a record type; module rights as on the list page. */
export async function exportResponse(entity: LayoutEntity): Promise<Response> {
  await requireModule(entity === "client" ? "clients" : "recruitment");
  const { csv, what } = await rowsAndColumns(entity);
  // A BOM so Excel reads the file as UTF-8.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(what, todayIso())}"`,
      "Cache-Control": "no-store",
    },
  });
}
