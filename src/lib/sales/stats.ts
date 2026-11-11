import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityChannel, ActivityOutcome, Database } from "@/lib/database.types";
import type {
  ActivityDirection,
  ActivityType,
  LeadStatus,
  MeetingStatus,
  PipelineStage,
  ReviewStatus,
} from "@/lib/sales/database";
import { isOpenStage, leadStatuses, pipelineStages } from "@/lib/sales/labels";

/**
 * Sales figures from the new data model: Activities (calls, reach, mails,
 * replies), the pipeline on companies and the Meetings register. Shared by
 * the report (S10 and /dashboard/report), the overview and the MCP tool
 * sales_stats. The summaries are pure and unit tested; loadSalesFigures does
 * the queries.
 */

type Db = SupabaseClient<Database>;

/** Call outcomes that mean someone picked up (section 2.9), plus the old ones from before the call screen. */
export const REACHED_OUTCOMES: ActivityOutcome[] = [
  "reached_interested",
  "meeting_planned",
  "reached_not_interested",
  "referred",
  "wrong_person",
  // Before the call screen (outcomes from the Web Partners sheet).
  "bereikt",
  "terugbellen",
  "afspraak",
  "niet_geinteresseerd",
];
export const REPLY_OUTCOMES: ActivityOutcome[] = ["reply_positief", "reply_neutraal", "reply_negatief"];
const OUTREACH_CHANNELS: ActivityChannel[] = ["bellen", "mail", "linkedin"];

export type ActivityFigureRow = {
  type: ActivityType;
  channel: ActivityChannel;
  outcome: ActivityOutcome | null;
  direction: ActivityDirection | null;
  contact_id: string | null;
  caller_id: string | null;
  created_by: string | null;
  review_status: ReviewStatus | null;
};

export type ActivityFigures = {
  /** Distinct contacts approached by phone, mail or LinkedIn. */
  approached: number;
  calls: number;
  reached: number;
  /** Distinct contacts reached by phone or that replied. */
  reachedContacts: number;
  /** Meetings planned straight from a call. */
  meetingsFromCalls: number;
  mails: number;
  linkedin: number;
  replies: number;
  positiveReplies: number;
  pendingReplies: number;
};

/** A real call: the phone channel, a contact moment, not the old "put on a call list" marker. */
export function isCall(row: Pick<ActivityFigureRow, "type" | "channel" | "outcome">): boolean {
  return row.channel === "bellen" && row.type === "contact" && row.outcome !== "verstuurd" && row.outcome !== "notitie";
}

export function isReached(row: Pick<ActivityFigureRow, "type" | "channel" | "outcome">): boolean {
  return isCall(row) && row.outcome !== null && REACHED_OUTCOMES.includes(row.outcome);
}

export function isReply(row: Pick<ActivityFigureRow, "type" | "outcome">): boolean {
  return row.type === "reply" || (row.outcome !== null && REPLY_OUTCOMES.includes(row.outcome));
}

function isOutbound(row: ActivityFigureRow, channel: ActivityChannel): boolean {
  if (row.channel !== channel || row.type !== "contact") return false;
  if (row.outcome === "bounce" || row.outcome === "afgemeld" || row.outcome === "notitie") return false;
  return row.direction !== "inbound";
}

export function summarizeSalesActivity(rows: ActivityFigureRow[]): ActivityFigures {
  const approached = new Set<string>();
  const reachedContacts = new Set<string>();
  const out: ActivityFigures = {
    approached: 0,
    calls: 0,
    reached: 0,
    reachedContacts: 0,
    meetingsFromCalls: 0,
    mails: 0,
    linkedin: 0,
    replies: 0,
    positiveReplies: 0,
    pendingReplies: 0,
  };
  for (const row of rows) {
    if (row.contact_id && OUTREACH_CHANNELS.some((c) => isOutbound(row, c)) && row.outcome !== "verstuurd") {
      approached.add(row.contact_id);
    }
    if (isCall(row)) {
      out.calls += 1;
      if (isReached(row)) {
        out.reached += 1;
        if (row.contact_id) reachedContacts.add(row.contact_id);
      }
      if (row.outcome === "meeting_planned" || row.outcome === "afspraak") out.meetingsFromCalls += 1;
    }
    // Mails sent: Instantly logs "verstuurd", a mail logged by hand is an outbound contact.
    if (isOutbound(row, "mail")) {
      out.mails += 1;
      if (row.contact_id) approached.add(row.contact_id);
    }
    if (isOutbound(row, "linkedin")) {
      out.linkedin += 1;
      if (row.contact_id) approached.add(row.contact_id);
    }
    if (isReply(row)) {
      out.replies += 1;
      if (row.contact_id) reachedContacts.add(row.contact_id);
      if (row.review_status === "pending") out.pendingReplies += 1;
      else if (row.outcome === "reply_positief") out.positiveReplies += 1;
    }
  }
  out.approached = approached.size;
  out.reachedContacts = reachedContacts.size;
  return out;
}

export type MeetingFigureRow = {
  status: MeetingStatus;
  created_at: string;
  scheduled_at: string | null;
  decided_at: string | null;
  fee: number;
  caller_id: string | null;
  booked_by: string | null;
};

export type MeetingFigures = {
  /** Booked in the period. */
  planned: number;
  /** Took place in the period (held, approved or rejected afterwards). */
  held: number;
  approved: number;
  rejected: number;
  noShow: number;
  cancelled: number;
  /** Fees of the meetings approved in the period. */
  fees: number;
  /** Planned and still ahead. */
  upcoming: number;
};

function inRange(value: string | null, from: string, to: string): boolean {
  if (!value) return false;
  const t = new Date(value).getTime();
  return t >= new Date(from).getTime() && t < new Date(to).getTime();
}

export function summarizeMeetings(rows: MeetingFigureRow[], { from, to }: { from: string; to: string }, now = new Date()): MeetingFigures {
  const out: MeetingFigures = { planned: 0, held: 0, approved: 0, rejected: 0, noShow: 0, cancelled: 0, fees: 0, upcoming: 0 };
  for (const m of rows) {
    const when = m.scheduled_at ?? m.created_at;
    if (inRange(m.created_at, from, to)) out.planned += 1;
    if (["held", "approved", "rejected"].includes(m.status) && inRange(when, from, to)) out.held += 1;
    if (m.status === "approved" && inRange(m.decided_at ?? when, from, to)) {
      out.approved += 1;
      out.fees += Number(m.fee) || 0;
    }
    if (m.status === "rejected" && inRange(m.decided_at ?? when, from, to)) out.rejected += 1;
    if (m.status === "no_show" && inRange(when, from, to)) out.noShow += 1;
    if (m.status === "cancelled" && inRange(when, from, to)) out.cancelled += 1;
    if (m.status === "planned" && m.scheduled_at && new Date(m.scheduled_at).getTime() >= now.getTime()) out.upcoming += 1;
  }
  out.fees = Math.round(out.fees * 100) / 100;
  return out;
}

export type PipelineFigureRow = {
  pipeline_stage: PipelineStage | null;
  pipeline_entered_at: string | null;
  pipeline_stage_changed_at: string | null;
};

export type StageCount = { stage: PipelineStage; label: string; count: number };

export type PipelineFigures = {
  /** Companies per stage right now, in the order of the board. */
  perStage: StageCount[];
  /** Interested up to and including Candidate interviews. */
  open: number;
  enteredInPeriod: number;
  wonInPeriod: number;
  lostInPeriod: number;
};

export function summarizePipeline(rows: PipelineFigureRow[], { from, to }: { from: string; to: string }): PipelineFigures {
  const counts = new Map<PipelineStage, number>();
  const out: PipelineFigures = { perStage: [], open: 0, enteredInPeriod: 0, wonInPeriod: 0, lostInPeriod: 0 };
  for (const r of rows) {
    if (!r.pipeline_stage) continue;
    counts.set(r.pipeline_stage, (counts.get(r.pipeline_stage) ?? 0) + 1);
    if (isOpenStage(r.pipeline_stage)) out.open += 1;
    if (inRange(r.pipeline_entered_at, from, to)) out.enteredInPeriod += 1;
    if (r.pipeline_stage === "won" && inRange(r.pipeline_stage_changed_at, from, to)) out.wonInPeriod += 1;
    if (r.pipeline_stage === "lost" && inRange(r.pipeline_stage_changed_at, from, to)) out.lostInPeriod += 1;
  }
  out.perStage = pipelineStages.map((s) => ({ stage: s.value, label: s.label, count: counts.get(s.value) ?? 0 }));
  return out;
}

export type CallerFigures = {
  key: string;
  name: string;
  kind: "caller" | "team";
  calls: number;
  reached: number;
  meetingsPlanned: number;
  meetingsApproved: number;
  fees: number;
};

/**
 * Calls, reach and meetings per person: external callers by their caller
 * row, team members by their account.
 */
export function figuresPerCaller(
  activities: ActivityFigureRow[],
  meetings: MeetingFigureRow[],
  names: { callers: Map<string, string>; people: Map<string, string> },
  { from, to }: { from: string; to: string },
): CallerFigures[] {
  const map = new Map<string, CallerFigures>();
  const entry = (callerId: string | null, userId: string | null): CallerFigures | null => {
    const key = callerId ? `caller:${callerId}` : userId ? `user:${userId}` : null;
    if (!key) return null;
    let e = map.get(key);
    if (!e) {
      e = {
        key,
        name: callerId ? (names.callers.get(callerId) ?? "Caller") : (names.people.get(userId!) ?? "Team member"),
        kind: callerId ? "caller" : "team",
        calls: 0,
        reached: 0,
        meetingsPlanned: 0,
        meetingsApproved: 0,
        fees: 0,
      };
      map.set(key, e);
    }
    return e;
  };
  for (const a of activities) {
    if (!isCall(a)) continue;
    const e = entry(a.caller_id, a.created_by);
    if (!e) continue;
    e.calls += 1;
    if (isReached(a)) e.reached += 1;
  }
  for (const m of meetings) {
    const e = entry(m.caller_id, m.caller_id ? null : m.booked_by);
    if (!e) continue;
    if (inRange(m.created_at, from, to)) e.meetingsPlanned += 1;
    if (m.status === "approved" && inRange(m.decided_at ?? m.scheduled_at ?? m.created_at, from, to)) {
      e.meetingsApproved += 1;
      e.fees += Number(m.fee) || 0;
    }
  }
  return [...map.values()]
    .filter((e) => e.calls + e.meetingsPlanned + e.meetingsApproved > 0)
    .sort((a, b) => b.calls - a.calls || b.meetingsPlanned - a.meetingsPlanned || a.name.localeCompare(b.name));
}

export type LeadStatusCount = { status: LeadStatus; label: string; count: number };

export function countLeadStatuses(rows: { lead_status: LeadStatus }[]): LeadStatusCount[] {
  const counts = new Map<LeadStatus, number>();
  for (const r of rows) counts.set(r.lead_status, (counts.get(r.lead_status) ?? 0) + 1);
  return leadStatuses.map((s) => ({ status: s.value, label: s.label, count: counts.get(s.value) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const PAGE = 1000;

async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max = 50_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export type SalesFigures = {
  period: { from: string; to: string };
  activity: ActivityFigures;
  meetings: MeetingFigures;
  pipeline: PipelineFigures;
  perCaller: CallerFigures[];
  /** Replies waiting for review, whenever they came in. */
  repliesToReview: number;
};

/** Everything of one period in a handful of queries. Works with the session client (RLS) and the secret key. */
export async function loadSalesFigures(
  db: Db,
  period: { from: string; to: string },
  options: { perCaller?: boolean; now?: Date } = {},
): Promise<SalesFigures> {
  const { from, to } = period;
  const [activities, meetings, companies, pending, callers, people] = await Promise.all([
    fetchAll((a, b) =>
      db
        .from("activities")
        .select("type, channel, outcome, direction, contact_id, caller_id, created_by, review_status")
        .in("type", ["contact", "reply", "meeting"])
        .gte("date", from)
        .lt("date", to)
        .order("id")
        .range(a, b),
    ),
    fetchAll((a, b) =>
      db
        .from("meetings")
        .select("status, created_at, scheduled_at, decided_at, fee, caller_id, booked_by")
        .or(
          `and(created_at.gte."${from}",created_at.lt."${to}"),and(scheduled_at.gte."${from}",scheduled_at.lt."${to}"),and(decided_at.gte."${from}",decided_at.lt."${to}"),and(status.eq.planned,scheduled_at.gte."${to}")`,
        )
        .order("id")
        .range(a, b),
    ),
    fetchAll((a, b) =>
      db
        .from("companies")
        .select("pipeline_stage, pipeline_entered_at, pipeline_stage_changed_at")
        .not("pipeline_stage", "is", null)
        .order("id")
        .range(a, b),
    ),
    db
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("review_status", "pending")
      .then(({ count, error }) => {
        if (error) throw new Error(error.message);
        return count ?? 0;
      }),
    options.perCaller ? db.from("callers").select("id, name") : Promise.resolve({ data: [], error: null }),
    options.perCaller
      ? db.from("profiles").select("id, full_name, email").in("role", ["admin", "member"])
      : Promise.resolve({ data: [], error: null }),
  ]);

  const activityRows = activities as ActivityFigureRow[];
  const meetingRows = meetings as MeetingFigureRow[];
  return {
    period,
    activity: summarizeSalesActivity(activityRows),
    meetings: summarizeMeetings(meetingRows, period, options.now),
    pipeline: summarizePipeline(companies as PipelineFigureRow[], period),
    perCaller: options.perCaller
      ? figuresPerCaller(
          activityRows,
          meetingRows,
          {
            callers: new Map((callers.data ?? []).map((c) => [c.id, c.name])),
            people: new Map(
              ((people.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [
                p.id,
                p.full_name || p.email || "Team member",
              ]),
            ),
          },
          period,
        )
      : [],
    repliesToReview: pending,
  };
}
