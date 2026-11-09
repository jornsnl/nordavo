import "server-only";
import type { ActivityChannel, ActivityOutcome, ActivitySource, Json } from "@/lib/database.types";
import { hasModule, requireModule, getCurrentUser } from "@/lib/auth";
import type { LeadStatus, PipelineStage } from "@/lib/sales/database";
import { createClient } from "@/lib/supabase/server";

/**
 * Replies to review (section 2.7): replies Claude fetched from Instantly and
 * Seleqt and was not sure about. Each has Claude's suggestion; Julius accepts
 * it with one click (sales_decide_reply), accepts with another outcome, or
 * rejects it.
 */

/** What Claude proposes for a reply; every field is optional. */
export type ReplySuggestion = {
  classification?: string;
  outcome?: ActivityOutcome;
  lead_status?: LeadStatus;
  pipeline_stage?: PipelineStage;
  lost_reason?: string;
  contact_status?: string;
  reason?: string;
};

const REPLY_OUTCOMES = new Set(["reply_positief", "reply_neutraal", "reply_negatief", "afgemeld", "bounce"]);

/** Read Claude's suggestion jsonb defensively; unknown keys are dropped. */
export function parseSuggestion(value: Json | null | undefined): ReplySuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const text = (key: string, max = 500) => (typeof v[key] === "string" && v[key] ? String(v[key]).slice(0, max) : undefined);
  const out: ReplySuggestion = {};
  const classification = text("classification", 100) ?? text("proposal", 100);
  if (classification) out.classification = classification;
  const outcome = text("outcome", 40);
  if (outcome && REPLY_OUTCOMES.has(outcome)) out.outcome = outcome as ActivityOutcome;
  const lead = text("lead_status", 40);
  if (lead) out.lead_status = lead as LeadStatus;
  const stage = text("pipeline_stage", 40);
  if (stage) out.pipeline_stage = stage as PipelineStage;
  const lost = text("lost_reason", 2000);
  if (lost) out.lost_reason = lost;
  const contact = text("contact_status", 40);
  if (contact) out.contact_status = contact;
  const reason = text("reason", 2000) ?? text("why", 2000);
  if (reason) out.reason = reason;
  return out;
}

/** The p_apply of sales_decide_reply for a suggestion. */
export function applyFromSuggestion(s: ReplySuggestion): Record<string, string> {
  const apply: Record<string, string> = {};
  if (s.outcome) apply.outcome = s.outcome;
  if (s.lead_status) apply.lead_status = s.lead_status;
  if (s.pipeline_stage) {
    apply.pipeline_stage = s.pipeline_stage;
    if (s.lost_reason) apply.lost_reason = s.lost_reason;
  }
  if (s.contact_status) apply.contact_status = s.contact_status;
  return apply;
}

export type ReplyToReview = {
  id: string;
  date: string;
  channel: ActivityChannel;
  source: ActivitySource;
  outcome: ActivityOutcome | null;
  notes: string | null;
  company: { id: string; name: string; leadStatus: LeadStatus; pipelineStage: PipelineStage | null } | null;
  contact: { id: string; name: string; title: string | null; email: string | null } | null;
  suggestion: ReplySuggestion;
};

/** Pending replies, oldest first (they wait longest). */
export async function listRepliesToReview(limit = 200): Promise<ReplyToReview[]> {
  await requireModule("sales");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, date, channel, source, outcome, notes, suggestion, company:companies(id, name, lead_status, pipeline_stage), contact:contacts(id, first_name, last_name, title, email)",
    )
    .eq("review_status", "pending")
    .order("date", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Could not load replies: ${error.message}`);
  return data.map((r) => ({
    id: r.id,
    date: r.date,
    channel: r.channel,
    source: r.source,
    outcome: r.outcome,
    notes: r.notes,
    company: r.company
      ? { id: r.company.id, name: r.company.name, leadStatus: r.company.lead_status, pipelineStage: r.company.pipeline_stage }
      : null,
    contact: r.contact
      ? {
          id: r.contact.id,
          name: [r.contact.first_name, r.contact.last_name].filter(Boolean).join(" ") || "Unknown",
          title: r.contact.title,
          email: r.contact.email,
        }
      : null,
    suggestion: parseSuggestion(r.suggestion),
  }));
}

/** Number of replies waiting for review, for a tab or a badge. 0 without the sales module. */
export async function pendingReplyCount(): Promise<number> {
  const user = await getCurrentUser();
  if (!hasModule(user, "sales")) return 0;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("review_status", "pending");
  if (error) throw new Error(`Could not count replies: ${error.message}`);
  return count ?? 0;
}
