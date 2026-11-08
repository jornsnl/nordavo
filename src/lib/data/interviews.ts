import "server-only";
import { requireModule } from "@/lib/auth";
import { effectiveModules } from "@/lib/modules";
import { isBookingUrl } from "@/lib/recruitment/interviews";
import { createClient } from "@/lib/supabase/server";

/** Interviews of all applications of one candidate, newest first (2.14). */
export async function listCandidateInterviews(candidateId: string) {
  await requireModule("recruitment");
  if (!/^[0-9a-f-]{36}$/i.test(candidateId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interviews")
    .select(
      "id, kind, status, starts_at, ends_at, invite_url, invite_mailed_at, created_at, rating, communication, feedback, feedback_at, cancellation_reason, interviewer_id, interviewer:profiles!interviews_interviewer_id_fkey(full_name, email), application:applications!inner(id, candidate_id, stage, vacancy:vacancies(id, title))",
    )
    .eq("application.candidate_id", candidateId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load interviews: ${error.message}`);
  return data;
}

export type CandidateInterview = Awaited<ReturnType<typeof listCandidateInterviews>>[number];

export type InterviewerOption = { id: string; name: string; hasLink: boolean };

/** Team members with the recruitment module, and whether they have a booking link. */
export async function listInterviewers(): Promise<InterviewerOption[]> {
  await requireModule("recruitment");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, modules, booking_url")
    .in("role", ["admin", "member"])
    .order("full_name");
  if (error) throw new Error(`Could not load interviewers: ${error.message}`);
  return data
    .filter((p) => effectiveModules(p.role, p.modules).includes("recruitment"))
    .map((p) => ({ id: p.id, name: p.full_name || p.email || "Unnamed", hasLink: isBookingUrl(p.booking_url) }));
}

/** What is missing for invitations and bookings to work end to end. */
export function interviewSetup() {
  return {
    mail: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
    webhook: Boolean(process.env.CALCOM_WEBHOOK_SECRET),
  };
}
