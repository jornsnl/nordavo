import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ActivityAction, EntityType, Json } from "@/lib/database.types";
import {
  applicationStages,
  candidateStatuses,
  clientDecisions,
  clientStatuses,
  entityTypes,
  placementStatuses,
  seniorities,
  taskPriorities,
  taskStatuses,
  vacancyStatuses,
} from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { recordKey, resolveRecords, type RecordLink } from "@/lib/data/search";

export type ActivityItem = {
  id: number;
  entityType: string;
  entityId: string;
  /** Dutch name of the record type, e.g. "Kandidaat". */
  typeLabel: string;
  action: ActivityAction;
  /** Short Dutch verb phrase, e.g. "status gewijzigd". */
  verb: string;
  /** Extra detail, e.g. "van Lead naar Actief" or "Gewijzigd: naam, website". */
  detail: string | null;
  /** The summary stored by the database trigger, includes the record name at that time. */
  summary: string;
  record: RecordLink | null;
  actorName: string | null;
  createdAt: string;
};

const typeLabels: Record<string, string> = {
  ...Object.fromEntries(Object.entries(entityTypes).map(([key, value]) => [key, value.label])),
  task: "Taak",
};

const fieldLabels: Record<string, string> = {
  name: "naam",
  title: "titel",
  full_name: "naam",
  website: "website",
  industry: "branche",
  city: "plaats",
  notes: "notities",
  owner_id: "eigenaar",
  client_id: "klant",
  description: "omschrijving",
  stack: "stack",
  seniority: "senioriteit",
  monthly_budget: "maandbudget",
  desired_start_date: "gewenste startdatum",
  opened_at: "geopend op",
  closed_at: "gesloten op",
  email: "e-mailadres",
  phone: "telefoon",
  location: "locatie",
  current_title: "huidige functie",
  years_experience: "jaren ervaring",
  skills: "vaardigheden",
  linkedin_url: "LinkedIn",
  video_url: "video",
  cv_path: "cv",
  summary: "samenvatting",
  status: "status",
  stage: "fase",
  technical_score: "technische score",
  english_score: "Engelse score",
  assessment_notes: "assessmentnotities",
  presented_at: "voorgesteld op",
  client_decision: "beslissing klant",
  client_feedback: "feedback klant",
  client_decided_at: "beslist op",
  rejection_reason: "reden afwijzing",
  candidate_id: "kandidaat",
  vacancy_id: "vacature",
  application_id: "sollicitatie",
  start_date: "startdatum",
  end_date: "einddatum",
  monthly_rate: "maandtarief",
  notice_given_at: "opgezegd op",
  next_checkin_at: "volgende check-in",
  priority: "prioriteit",
  due_date: "deadline",
  assignee_id: "toegewezen aan",
  entity_type: "gekoppeld record",
  entity_id: "gekoppeld record",
};

/** Fields that change as a side effect and say nothing on their own. */
const hiddenFields = new Set(["completed_at", "guarantee_until", "updated_at", "position", "id"]);

function statusLabel(entityType: string, value: string) {
  const lists: Record<string, { value: string; label: string }[]> = {
    client: clientStatuses,
    vacancy: vacancyStatuses,
    candidate: candidateStatuses,
    placement: placementStatuses,
    task: taskStatuses,
  };
  return lists[entityType]?.find((o) => o.value === value)?.label ?? value;
}

function valueLabel(entityType: string, field: string, value: Json | undefined): string {
  if (value === null || value === undefined || value === "") return "leeg";
  if (typeof value !== "string") return String(value);
  if (field === "status") return statusLabel(entityType, value);
  if (field === "stage") return applicationStages.find((o) => o.value === value)?.label ?? value;
  if (field === "priority") return taskPriorities.find((o) => o.value === value)?.label ?? value;
  if (field === "seniority") return seniorities.find((o) => o.value === value)?.label ?? value;
  if (field === "client_decision") return clientDecisions.find((o) => o.value === value)?.label ?? value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  return value;
}

type Change = { from?: Json; to?: Json };

function asChanges(changes: Json): Record<string, Change> {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return {};
  const result: Record<string, Change> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = value as Change;
    }
  }
  return result;
}

/** Turn a raw activity row into a Dutch verb and detail line. */
export function describeActivity(
  entityType: string,
  action: ActivityAction,
  changesJson: Json,
): { verb: string; detail: string | null } {
  const changes = asChanges(changesJson);
  const fromTo = (field: string) => {
    const change = changes[field];
    if (!change) return null;
    return `van ${valueLabel(entityType, field, change.from)} naar ${valueLabel(entityType, field, change.to)}`;
  };
  const otherFields = (skip: string[]) => {
    const names = [
      ...new Set(
        Object.keys(changes)
          .filter((key) => !skip.includes(key) && !hiddenFields.has(key))
          .map((key) => fieldLabels[key] ?? key.replace(/_/g, " ")),
      ),
    ];
    return names.length > 0 ? names.join(", ") : null;
  };

  switch (action) {
    case "created":
      return { verb: "aangemaakt", detail: null };
    case "deleted":
      return { verb: "verwijderd", detail: null };
    case "stage_changed": {
      const others = otherFields(["stage"]);
      return {
        verb: "fase gewijzigd",
        detail: [fromTo("stage"), others && `ook gewijzigd: ${others}`].filter(Boolean).join(". ") || null,
      };
    }
    case "status_changed": {
      const others = otherFields(["status"]);
      return {
        verb: "status gewijzigd",
        detail: [fromTo("status"), others && `ook gewijzigd: ${others}`].filter(Boolean).join(". ") || null,
      };
    }
    default: {
      const fields = otherFields([]);
      return { verb: "bijgewerkt", detail: fields ? `Gewijzigd: ${fields}` : null };
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIVITY_COLUMNS =
  "id, entity_type, entity_id, action, summary, changes, actor_id, created_at, actor:profiles(full_name, email)";

type ActivityRow = {
  id: number;
  entity_type: string;
  entity_id: string;
  action: ActivityAction;
  summary: string;
  changes: Json;
  created_at: string;
  actor: { full_name: string | null; email: string | null } | null;
};

async function toActivityItems(rows: ActivityRow[]): Promise<ActivityItem[]> {
  const records = rows.length > 0
    ? await resolveRecords(rows.map((r) => ({ type: r.entity_type, id: r.entity_id })))
    : new Map<string, RecordLink>();

  return rows.map((r) => {
    const { verb, detail } = describeActivity(r.entity_type, r.action, r.changes);
    return {
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      typeLabel: typeLabels[r.entity_type] ?? r.entity_type,
      action: r.action,
      verb,
      detail,
      summary: r.summary,
      record: records.get(recordKey(r.entity_type, r.entity_id)) ?? null,
      actorName: r.actor?.full_name || r.actor?.email || null,
      createdAt: r.created_at,
    };
  });
}

/** Latest activity across the whole portal. */
export async function listRecentActivity(limit: number): Promise<ActivityItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_log")
    .select(ACTIVITY_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Activiteit laden mislukt: ${error.message}`);
  return toActivityItems(data);
}

/**
 * Timeline for one record. Includes the pipeline of a vacancy or candidate
 * and the tasks linked to the record, so the story is complete.
 */
export async function listEntityActivity(
  entityType: EntityType,
  entityId: string,
  limit = 40,
): Promise<ActivityItem[]> {
  await requireStaff();
  if (!UUID.test(entityId)) return [];
  const supabase = await createClient();

  const [applicationIds, taskIds] = await Promise.all([
    entityType === "vacancy" || entityType === "candidate"
      ? supabase
          .from("applications")
          .select("id")
          .eq(entityType === "vacancy" ? "vacancy_id" : "candidate_id", entityId)
          .limit(100)
          .then(({ data }) => (data ?? []).map((a) => a.id))
      : Promise.resolve([] as string[]),
    supabase
      .from("tasks")
      .select("id")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .limit(100)
      .then(({ data }) => (data ?? []).map((t) => t.id)),
  ]);

  const filters = [`and(entity_type.eq.${entityType},entity_id.eq.${entityId})`];
  if (applicationIds.length > 0) {
    filters.push(`and(entity_type.eq.application,entity_id.in.(${applicationIds.join(",")}))`);
  }
  if (taskIds.length > 0) {
    filters.push(`and(entity_type.eq.task,entity_id.in.(${taskIds.join(",")}))`);
  }

  const { data, error } = await supabase
    .from("activity_log")
    .select(ACTIVITY_COLUMNS)
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Activiteit laden mislukt: ${error.message}`);
  return toActivityItems(data);
}
