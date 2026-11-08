"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireModule } from "@/lib/auth";
import { escapeHtml, sendMail } from "@/lib/notify/mail";
import { buildInviteUrl, inviteMail, isBookingUrl } from "@/lib/recruitment/interviews";
import { createClient } from "@/lib/supabase/server";

export type PlanInterviewState = ActionState & { inviteUrl?: string };

const planSchema = z.object({
  application_id: z.guid({ error: "Choose the vacancy" }),
  interviewer_id: z.guid({ error: "Choose the interviewer" }),
  kind: z.enum(["interview", "english_interview", "client_interview"], { error: "Choose the type" }),
});

/**
 * Plan interview (2.14): store an invitation and mail the candidate the
 * interviewer's Cal.com link, prefilled with name, e-mail and the interview
 * id. The candidate picks a time; the Cal.com webhook does the rest.
 */
export async function planInterview(_prev: PlanInterviewState, formData: FormData): Promise<PlanInterviewState> {
  const user = await requireModule("recruitment");
  const parsed = planSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const { application_id, interviewer_id, kind } = parsed.data;

  const supabase = await createClient();
  const [{ data: application }, { data: interviewer }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, candidate:candidates(id, full_name, email), vacancy:vacancies(id, title)")
      .eq("id", application_id)
      .maybeSingle(),
    supabase.from("profiles").select("id, full_name, email, booking_url").eq("id", interviewer_id).maybeSingle(),
  ]);
  if (!application?.candidate || !application.vacancy) return { error: "This application was not found." };
  if (!interviewer) return { error: "This interviewer was not found." };

  const interviewerName = interviewer.full_name || interviewer.email || "the interviewer";
  if (!isBookingUrl(interviewer.booking_url)) {
    return {
      error: `${interviewerName} has no Cal.com booking link yet. They can add it in Settings, under Interviews.`,
      fieldErrors: { interviewer_id: "No booking link" },
    };
  }
  const email = application.candidate.email?.trim();
  if (!email) {
    return { error: "This candidate has no e-mail address. Add it to the candidate first." };
  }

  const id = randomUUID();
  const inviteUrl = buildInviteUrl(interviewer.booking_url, {
    name: application.candidate.full_name,
    email,
    interviewId: id,
    applicationId: application.id,
  });

  const { error } = await supabase.from("interviews").insert({
    id,
    application_id: application.id,
    interviewer_id: interviewer.id,
    kind,
    status: "invited",
    invite_url: inviteUrl,
    created_by: user.id,
  });
  if (error) {
    console.error("planInterview", error);
    return { error: GENERIC_ERROR };
  }

  const mail = inviteMail(escapeHtml, {
    candidateName: application.candidate.full_name,
    vacancyTitle: application.vacancy.title,
    interviewerName,
    kind,
    url: inviteUrl,
  });
  const sent = await sendMail({ to: email, subject: mail.subject, html: mail.html, text: mail.text }).catch(() => false);
  if (sent) {
    await supabase.from("interviews").update({ invite_mailed_at: new Date().toISOString() }).eq("id", id);
  }

  revalidatePath(`/dashboard/candidates/${application.candidate.id}`);
  revalidatePath(`/dashboard/vacancies/${application.vacancy.id}/pipeline`);
  if (!sent) {
    return {
      ok: true,
      inviteUrl,
      message:
        "The invitation is saved, but no mail was sent (RESEND_API_KEY or MAIL_FROM is not set). Copy the link below and send it to the candidate yourself.",
    };
  }
  return { ok: true, inviteUrl, message: `Invitation sent to ${email}. The interview appears here once a time is booked.` };
}

const feedbackSchema = z.object({
  status: z.enum(["done", "no_show"], { error: "Choose what happened" }),
  rating: z.coerce.number({ error: "Choose a rating" }).int().min(1).max(5).optional(),
  communication: z.coerce.number({ error: "Choose a rating" }).int().min(1).max(5).optional(),
  feedback: z.string().max(5000, { error: "At most 5000 characters" }).optional(),
});

/** Feedback of the interviewer after the interview (2.14). */
export async function saveInterviewFeedback(
  interviewId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireModule("recruitment");
  if (!z.guid().safeParse(interviewId).success) return { error: GENERIC_ERROR };
  const parsed = feedbackSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the feedback.", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interviews")
    .update({
      status: parsed.data.status,
      rating: parsed.data.rating ?? null,
      communication: parsed.data.communication ?? null,
      feedback: parsed.data.feedback ?? null,
      feedback_at: new Date().toISOString(),
      feedback_by: user.id,
    })
    .eq("id", interviewId)
    .select("application:applications(candidate_id)")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("saveInterviewFeedback", error);
    return { error: GENERIC_ERROR };
  }

  if (data.application?.candidate_id) revalidatePath(`/dashboard/candidates/${data.application.candidate_id}`);
  return { ok: true, message: "Feedback saved." };
}

/**
 * Withdraw an invitation that was not booked yet. A booked interview is
 * cancelled in Cal.com, so the candidate and the calendar hear about it;
 * the webhook then marks it cancelled here.
 */
export async function withdrawInvitation(interviewId: string): Promise<ActionState> {
  await requireModule("recruitment");
  if (!z.guid().safeParse(interviewId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interviews")
    .update({ status: "cancelled", cancellation_reason: "Invitation withdrawn" })
    .eq("id", interviewId)
    .eq("status", "invited")
    .select("application:applications(candidate_id)")
    .maybeSingle();
  if (error) {
    console.error("withdrawInvitation", error);
    return { error: GENERIC_ERROR };
  }
  if (!data) return { error: "Only invitations without a booking can be withdrawn. Cancel booked interviews in Cal.com." };
  if (data.application?.candidate_id) revalidatePath(`/dashboard/candidates/${data.application.candidate_id}`);
  return { ok: true, message: "Invitation withdrawn." };
}
