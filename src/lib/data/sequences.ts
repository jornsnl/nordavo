import "server-only";
import { requireModule } from "@/lib/auth";
import type {
  EnrollmentStatus,
  LeadStatus,
  SequenceChannel,
  SequenceStatus,
  SequenceTaskStatus,
} from "@/lib/sales/database";
import { createClient } from "@/lib/supabase/server";

/** Sequences (replace Campaigns): steps over mail, LinkedIn and calls. */

export type SequenceListItem = {
  id: string;
  name: string;
  description: string | null;
  status: SequenceStatus;
  updatedAt: string;
  steps: number;
  channels: SequenceChannel[];
  toApprove: number;
  concepts: number;
  active: number;
  paused: number;
};

export async function listSequences(options: { archived?: boolean } = {}): Promise<SequenceListItem[]> {
  await requireModule("sales");
  const supabase = await createClient();
  let q = supabase.from("sequences").select("id, name, description, status, updated_at").order("updated_at", { ascending: false });
  q = options.archived ? q.eq("status", "archived") : q.in("status", ["draft", "active"]);
  const { data: sequences, error } = await q;
  if (error) throw new Error(`Could not load sequences: ${error.message}`);
  const ids = sequences.map((s) => s.id);
  if (ids.length === 0) return [];
  const [steps, enrollments] = await Promise.all([
    supabase.from("sequence_steps").select("sequence_id, channel, approved_at, draft_body, draft_subject").in("sequence_id", ids),
    supabase.from("sequence_enrollments").select("sequence_id, status").in("sequence_id", ids).in("status", ["active", "paused"]),
  ]);
  if (steps.error) throw new Error(`Could not load steps: ${steps.error.message}`);
  if (enrollments.error) throw new Error(`Could not load enrollments: ${enrollments.error.message}`);
  return sequences.map((s) => {
    const own = steps.data.filter((r) => r.sequence_id === s.id);
    const ownEnrollments = enrollments.data.filter((e) => e.sequence_id === s.id);
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      status: s.status,
      updatedAt: s.updated_at,
      steps: own.length,
      channels: [...new Set(own.map((r) => r.channel))],
      toApprove: own.filter((r) => r.channel !== "call" && !r.approved_at).length,
      concepts: own.filter((r) => r.draft_body || r.draft_subject).length,
      active: ownEnrollments.filter((e) => e.status === "active").length,
      paused: ownEnrollments.filter((e) => e.status === "paused").length,
    };
  });
}

export type SequenceStep = {
  id: string;
  position: number;
  dayOffset: number;
  channel: SequenceChannel;
  subject: string | null;
  body: string | null;
  draftSubject: string | null;
  draftBody: string | null;
  draftSource: "claude" | "handmatig" | null;
  draftAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  tasks: number;
};

export type SequenceTask = {
  id: string;
  stepId: string;
  channel: SequenceChannel;
  dueDate: string;
  status: SequenceTaskStatus;
  doneAt: string | null;
};

export type SequenceEnrollment = {
  id: string;
  status: EnrollmentStatus;
  startedAt: string;
  pausedAt: string | null;
  pauseReason: string | null;
  source: "handmatig" | "claude" | "system";
  company: { id: string; name: string; leadStatus: LeadStatus } | null;
  contact: { id: string; name: string } | null;
  tasks: SequenceTask[];
};

export type SequenceDetail = {
  id: string;
  name: string;
  description: string | null;
  status: SequenceStatus;
  createdAt: string;
  updatedAt: string;
  steps: SequenceStep[];
  enrollments: SequenceEnrollment[];
  /** Mail and LinkedIn steps without approved text: the sequence cannot start. */
  unapproved: number;
};

export async function getSequence(id: string): Promise<SequenceDetail | null> {
  await requireModule("sales");
  const supabase = await createClient();
  const { data: sequence, error } = await supabase
    .from("sequences")
    .select("id, name, description, status, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the sequence: ${error.message}`);
  if (!sequence) return null;

  const [steps, enrollments, profiles] = await Promise.all([
    supabase
      .from("sequence_steps")
      .select("id, position, day_offset, channel, subject, body, draft_subject, draft_body, draft_source, draft_at, approved_at, approved_by")
      .eq("sequence_id", id)
      .order("position")
      .order("day_offset"),
    supabase
      .from("sequence_enrollments")
      .select(
        "id, status, started_at, paused_at, pause_reason, source, company:companies(id, name, lead_status), contact:contacts(id, first_name, last_name)",
      )
      .eq("sequence_id", id)
      .order("started_at", { ascending: false })
      .limit(300),
    supabase.from("profiles").select("id, full_name, email").in("role", ["admin", "member"]),
  ]);
  if (steps.error) throw new Error(`Could not load steps: ${steps.error.message}`);
  if (enrollments.error) throw new Error(`Could not load enrollments: ${enrollments.error.message}`);

  const enrollmentIds = enrollments.data.map((e) => e.id);
  const tasks: { id: string; enrollment_id: string; step_id: string; channel: SequenceChannel; due_date: string; status: SequenceTaskStatus; done_at: string | null }[] = [];
  for (let i = 0; i < enrollmentIds.length; i += 100) {
    const { data, error: taskError } = await supabase
      .from("sequence_tasks")
      .select("id, enrollment_id, step_id, channel, due_date, status, done_at")
      .in("enrollment_id", enrollmentIds.slice(i, i + 100))
      .order("due_date");
    if (taskError) throw new Error(`Could not load step tasks: ${taskError.message}`);
    tasks.push(...data);
  }
  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name || p.email || "Team member"]));

  const stepRows: SequenceStep[] = steps.data.map((s) => ({
    id: s.id,
    position: s.position,
    dayOffset: s.day_offset,
    channel: s.channel,
    subject: s.subject,
    body: s.body,
    draftSubject: s.draft_subject,
    draftBody: s.draft_body,
    draftSource: s.draft_source,
    draftAt: s.draft_at,
    approvedAt: s.approved_at,
    approvedBy: s.approved_by ? (names.get(s.approved_by) ?? "Team member") : null,
    tasks: tasks.filter((t) => t.step_id === s.id).length,
  }));

  return {
    id: sequence.id,
    name: sequence.name,
    description: sequence.description,
    status: sequence.status,
    createdAt: sequence.created_at,
    updatedAt: sequence.updated_at,
    steps: stepRows,
    unapproved: stepRows.filter((s) => s.channel !== "call" && !s.approvedAt).length,
    enrollments: enrollments.data.map((e) => ({
      id: e.id,
      status: e.status,
      startedAt: e.started_at,
      pausedAt: e.paused_at,
      pauseReason: e.pause_reason,
      source: e.source,
      company: e.company ? { id: e.company.id, name: e.company.name, leadStatus: e.company.lead_status } : null,
      contact: e.contact
        ? { id: e.contact.id, name: [e.contact.first_name, e.contact.last_name].filter(Boolean).join(" ") || "Contact" }
        : null,
      tasks: tasks
        .filter((t) => t.enrollment_id === e.id)
        .map((t) => ({ id: t.id, stepId: t.step_id, channel: t.channel, dueDate: t.due_date, status: t.status, doneAt: t.done_at })),
    })),
  };
}

export type CompanyOption = { id: string; name: string; domain: string; leadStatus: LeadStatus; city: string | null };

/** Companies for the picker: by name or domain, or the Ready ones without a query. */
export async function searchCompanyOptions(query: string, limit = 20): Promise<CompanyOption[]> {
  await requireModule("sales");
  const supabase = await createClient();
  const cleaned = query.replace(/[,()"'*:%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  let q = supabase
    .from("companies")
    .select("id, name, domain, lead_status, city")
    .not("lead_status", "in", "(no_go,do_not_contact)")
    .order("prio", { ascending: true, nullsFirst: false })
    .order("name")
    .limit(limit);
  if (cleaned.length >= 2) q = q.or(`name.ilike.%${cleaned}%,domain.ilike.%${cleaned}%`);
  else q = q.eq("lead_status", "ready");
  const { data, error } = await q;
  if (error) throw new Error(`Could not search companies: ${error.message}`);
  return data.map((c) => ({ id: c.id, name: c.name, domain: c.domain, leadStatus: c.lead_status, city: c.city }));
}
