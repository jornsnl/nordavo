"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireModule } from "@/lib/auth";
import { amsterdamLocalToIso } from "@/lib/sales/caller-stats";
import type { MeetingStatus } from "@/lib/sales/database";
import { createClient } from "@/lib/supabase/server";

// The meetings register (feedback Julius, section 2.11; replaces the meetings
// sheet). The team adds meetings by hand and marks them held or no show;
// approving, rejecting and the fee are for admins (also enforced by the
// meetings_guard trigger). An approved meeting earns the caller the fee.

function revalidate() {
  revalidatePath("/dashboard/meetings");
  revalidatePath("/dashboard/settings/callers");
}

export type CompanyHit = { id: string; name: string; city: string | null; contacts: { id: string; name: string; title: string | null }[] };

/** Companies by name or domain for the "Add meeting" form, with their contacts. */
export async function searchMeetingCompanies(query: string): Promise<CompanyHit[]> {
  await requireModule("sales");
  const q = query.trim().replace(/[%_,()]/g, " ").trim().slice(0, 80);
  if (q.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select("id, name, city, contacts:contacts!contacts_company_id_fkey(id, first_name, last_name, title)")
    .or(`name.ilike.%${q}%,domain.ilike.%${q}%`)
    .order("name")
    .limit(10);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    contacts: (c.contacts ?? []).map((p) => ({
      id: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown",
      title: p.title,
    })),
  }));
}

const addSchema = z.object({
  company_id: z.guid({ error: "Pick a company" }),
  contact_id: z.guid().optional(),
  caller_id: z.guid().optional(),
  date: z.string({ error: "Pick a date" }).regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date" }),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, { error: "Use a time like 14:30" })
    .optional(),
  reason: z.string().max(2000, { error: "At most 2000 characters" }).optional(),
});

/** Adds a meeting by hand (sales_save_meeting: logs it and moves the pipeline). */
export async function addMeeting(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("sales");
  const parsed = addSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("sales_save_meeting", {
    p_company: v.company_id,
    p_contact: v.contact_id ?? null,
    p_caller: v.caller_id ?? null,
    p_scheduled_at: amsterdamLocalToIso(v.date, v.time ?? "09:00"),
    p_reason: v.reason ?? null,
    p_source: "handmatig",
  });
  if (error) {
    console.error("addMeeting", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  revalidate();
  return { ok: true, message: "The meeting is in the register." };
}

const statuses: MeetingStatus[] = ["planned", "held", "approved", "rejected", "no_show", "cancelled"];

const statusMessages: Record<MeetingStatus, string> = {
  awaiting_booking: "Back to awaiting booking.",
  planned: "Back to planned.",
  held: "Marked as held.",
  approved: "Approved. The caller earns the fee.",
  rejected: "Rejected. No fee for this meeting.",
  no_show: "Marked as no show.",
  cancelled: "Cancelled.",
};

export async function setMeetingStatus(meetingId: string, status: MeetingStatus): Promise<ActionState> {
  const user = await requireModule("sales");
  if (!z.guid().safeParse(meetingId).success || !statuses.includes(status)) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: current } = await supabase.from("meetings").select("status").eq("id", meetingId).maybeSingle();
  if (!current) return { error: "Meeting not found." };
  const decided = (s: string) => s === "approved" || s === "rejected";
  if (user.role !== "admin" && (decided(status) || decided(current.status))) {
    return { error: "Only an admin approves or rejects meetings." };
  }
  const { error } = await supabase.from("meetings").update({ status }).eq("id", meetingId);
  if (error) {
    console.error("setMeetingStatus", error.code, error.message);
    return { error: error.code === "42501" ? "Only an admin approves or rejects meetings." : GENERIC_ERROR };
  }
  revalidate();
  return { ok: true, message: statusMessages[status] };
}

const rescheduleSchema = z.object({
  date: z.string({ error: "Pick a date" }).regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date" }),
  time: z.string({ error: "Use a time like 14:30" }).regex(/^\d{2}:\d{2}$/, { error: "Use a time like 14:30" }),
  outcome: z.enum(["reached", "no_answer", "voicemail"], { error: "Pick what happened" }),
  note: z.string().max(2000, { error: "At most 2000 characters" }).optional(),
});

const calledOutcomes = {
  reached: { outcome: "bereikt", label: "Reached them" },
  no_answer: { outcome: "geen_gehoor", label: "No answer" },
  voicemail: { outcome: "geen_gehoor", label: "Left a voicemail" },
} as const;

/**
 * A no show, or a meeting that has to move: log the call to the contact (what happened, a note)
 * and give the SAME meeting its new date and time (status back to planned). The history stays:
 * the earlier no show, this call and the new time are all in Activities of the meeting.
 * Moving in Cal.com itself works too (the webhook moves the meeting).
 */
export async function rescheduleMeeting(meetingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireModule("sales");
  if (!z.guid().safeParse(meetingId).success) return { error: GENERIC_ERROR };
  const parsed = rescheduleSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, status, company_id, contact_id, caller_id, scheduled_at")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return { error: "Meeting not found." };
  if (!["planned", "no_show"].includes(meeting.status)) return { error: "Only a planned meeting or a no show can be moved." };
  const when = amsterdamLocalToIso(v.date, v.time);
  const called = calledOutcomes[v.outcome];
  const stamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" }).format(new Date(when));
  const notes = [`${called.label}. New time: ${stamp}.`, v.note?.trim()].filter(Boolean).join("\n");
  const { error: logError } = await supabase.from("activities").insert({
    company_id: meeting.company_id,
    contact_id: meeting.contact_id,
    caller_id: meeting.caller_id,
    meeting_id: meeting.id,
    channel: "bellen",
    type: "contact",
    direction: "outbound",
    outcome: called.outcome,
    notes,
    source: "handmatig",
    created_by: user.id,
  });
  if (logError) {
    console.error("rescheduleMeeting log", logError.code, logError.message);
    return { error: GENERIC_ERROR };
  }
  const { error } = await supabase
    .from("meetings")
    .update({ scheduled_at: when, status: "planned" })
    .eq("id", meeting.id);
  if (error) {
    console.error("rescheduleMeeting", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  revalidate();
  return { ok: true, message: `Moved to ${stamp}.` };
}

const feeSchema = z
  .string()
  .transform((v) => (v.trim() === "" ? Number.NaN : Number(v.replace(",", ".").replace(/[€\s]/g, ""))))
  .pipe(z.number().min(0).max(10000));

/** The fee of one meeting (admins). */
export async function updateMeetingFee(meetingId: string, fee: string): Promise<ActionState> {
  const user = await requireModule("sales");
  if (user.role !== "admin") return { error: "Only an admin changes the fee." };
  const parsed = feeSchema.safeParse(fee);
  if (!z.guid().safeParse(meetingId).success || !parsed.success) return { error: "Enter an amount from 0 to 10,000." };
  const supabase = await createClient();
  const { error } = await supabase.from("meetings").update({ fee: parsed.data }).eq("id", meetingId);
  if (error) {
    console.error("updateMeetingFee", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  revalidate();
  return { ok: true, message: "Fee saved." };
}
