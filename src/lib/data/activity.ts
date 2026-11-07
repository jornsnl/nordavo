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
  /** Name of the record type, e.g. "Candidate". */
  typeLabel: string;
  action: ActivityAction;
  /** Short verb phrase, e.g. "status changed". */
  verb: string;
  /** Extra detail, e.g. "from Lead to Active" or "Changed: name, website". */
  detail: string | null;
  /**
   * "<record name at the time> <verb>": the summary the database trigger
   * stored, with the verb in English, also for older Dutch rows.
   */
  summary: string;
  record: RecordLink | null;
  actorName: string | null;
  createdAt: string;
};

const typeLabels: Record<string, string> = {
  ...Object.fromEntries(Object.entries(entityTypes).map(([key, value]) => [key, value.label])),
  task: "Task",
};

const fieldLabels: Record<string, string> = {
  name: "name",
  title: "title",
  full_name: "name",
  website: "website",
  industry: "industry",
  city: "city",
  notes: "notes",
  owner_id: "owner",
  client_id: "client",
  description: "description",
  stack: "stack",
  seniority: "seniority",
  monthly_budget: "monthly budget",
  desired_start_date: "desired start date",
  opened_at: "opened on",
  closed_at: "closed on",
  email: "e-mail address",
  phone: "phone",
  location: "location",
  current_title: "current title",
  years_experience: "years of experience",
  skills: "skills",
  linkedin_url: "LinkedIn",
  video_url: "video",
  cv_path: "CV",
  summary: "summary",
  status: "status",
  stage: "stage",
  technical_score: "technical score",
  english_score: "English score",
  assessment_notes: "assessment notes",
  presented_at: "presented on",
  client_decision: "client decision",
  client_feedback: "client feedback",
  client_decided_at: "decided on",
  rejection_reason: "rejection reason",
  candidate_id: "candidate",
  vacancy_id: "vacancy",
  application_id: "application",
  start_date: "start date",
  end_date: "end date",
  monthly_rate: "monthly rate",
  notice_given_at: "notice given on",
  next_checkin_at: "next check-in",
  priority: "priority",
  due_date: "deadline",
  assignee_id: "assignee",
  entity_type: "linked record",
  entity_id: "linked record",
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
  if (value === null || value === undefined || value === "") return "empty";
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

/** Turn a raw activity row into a verb and detail line. */
export function describeActivity(
  entityType: string,
  action: ActivityAction,
  changesJson: Json,
): { verb: string; detail: string | null } {
  const changes = asChanges(changesJson);
  const fromTo = (field: string) => {
    const change = changes[field];
    if (!change) return null;
    return `from ${valueLabel(entityType, field, change.from)} to ${valueLabel(entityType, field, change.to)}`;
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

  // A contact added by hand to a lead (trigger log_manual_contact).
  if (action === "updated" && changes.contact_added) {
    const name = changes.contact_added.to;
    // Rows from before the English messages migration say "Onbekend" for a contact without name or e-mail.
    const detail = typeof name === "string" && name ? name.replace(/^Onbekend(?=,|$)/, "Unknown") : null;
    return { verb: "contact added", detail };
  }

  switch (action) {
    case "created":
      return { verb: "created", detail: null };
    case "deleted":
      return { verb: "deleted", detail: null };
    case "stage_changed": {
      const others = otherFields(["stage"]);
      return {
        verb: "stage changed",
        detail: [fromTo("stage"), others && `also changed: ${others}`].filter(Boolean).join(". ") || null,
      };
    }
    case "status_changed": {
      const others = otherFields(["status"]);
      return {
        verb: "status changed",
        detail: [fromTo("status"), others && `also changed: ${others}`].filter(Boolean).join(". ") || null,
      };
    }
    default: {
      const fields = otherFields([]);
      return { verb: "updated", detail: fields ? `Changed: ${fields}` : null };
    }
  }
}

/**
 * Verbs the activity triggers append to the summary: the English ones, and
 * the Dutch ones of rows written before migration 20261107040000.
 */
const SUMMARY_VERBS = [
  "contact added",
  "stage changed",
  "status changed",
  "created",
  "deleted",
  "updated",
  "contact toegevoegd",
  "fase gewijzigd",
  "status gewijzigd",
  "aangemaakt",
  "verwijderd",
  "bijgewerkt",
];

/** The record name in a stored summary, without the verb. */
export function summaryRecordName(summary: string): string {
  const trimmed = summary.trim();
  for (const verb of SUMMARY_VERBS) {
    if (trimmed === verb) return "";
    if (trimmed.endsWith(` ${verb}`)) return trimmed.slice(0, -verb.length - 1).trim();
  }
  return trimmed;
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
      summary: [summaryRecordName(r.summary), verb].filter(Boolean).join(" "),
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
  if (error) throw new Error(`Could not load activity: ${error.message}`);
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
  if (error) throw new Error(`Could not load activity: ${error.message}`);
  return toActivityItems(data);
}
