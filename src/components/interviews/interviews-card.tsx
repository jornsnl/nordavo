import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { listCandidateApplications } from "@/lib/data/applications";
import { interviewSetup, listCandidateInterviews, listInterviewers } from "@/lib/data/interviews";
import { formatDateTime } from "@/lib/format";
import { interviewKindLabel, interviewStatusOption } from "@/lib/recruitment/interviews";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { saveInterviewFeedback, withdrawInvitation } from "./actions";
import { InterviewFeedbackForm } from "./feedback-form";
import { PlanInterviewButton } from "./plan-interview-button";

/**
 * Interviews of a candidate (2.14): plan one, see what is booked, and the
 * interviewer's feedback afterwards. Render inside <Suspense>.
 */
export async function InterviewsCard({ candidateId }: { candidateId: string }) {
  const [interviews, applications, interviewers] = await Promise.all([
    listCandidateInterviews(candidateId),
    listCandidateApplications(candidateId),
    listInterviewers(),
  ]);
  const setup = interviewSetup();
  const options = applications.flatMap((a) =>
    a.vacancy ? [{ id: a.id, label: `${a.vacancy.title}${a.vacancy.client?.name ? `, ${a.vacancy.client.name}` : ""}` }] : [],
  );
  const now = Date.now();

  return (
    <Card>
      <CardHeader
        title="Interviews"
        description="Invite the candidate to pick a time in the interviewer's calendar."
        actions={<PlanInterviewButton applications={options} interviewers={interviewers} />}
      />
      {(!setup.mail || !setup.webhook || !interviewers.some((i) => i.hasLink)) && (
        <div className="space-y-1 border-b border-border bg-amber-50 px-5 py-3 text-xs text-amber-900">
          {!interviewers.some((i) => i.hasLink) && (
            <p>
              No interviewer has a Cal.com booking link yet: add it in{" "}
              <Link href="/dashboard/settings" className="font-medium underline">
                Settings, Interviews
              </Link>
              .
            </p>
          )}
          {!setup.mail && (
            <p>Invitations are not mailed until RESEND_API_KEY and MAIL_FROM are set; you get the link to send yourself.</p>
          )}
          {!setup.webhook && (
            <p>
              Bookings do not come back into the portal until the Cal.com webhook is set up (CALCOM_WEBHOOK_SECRET,
              see docs/recruitment-planning.md).
            </p>
          )}
        </div>
      )}
      {interviews.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">No interviews planned yet.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {interviews.map((interview) => {
            const status = interviewStatusOption(interview.status);
            const interviewer = interview.interviewer?.full_name || interview.interviewer?.email || "Unknown interviewer";
            const past = interview.starts_at ? new Date(interview.starts_at).getTime() < now : false;
            const canGiveFeedback =
              interview.status === "done" ||
              interview.status === "no_show" ||
              ((interview.status === "scheduled" || interview.status === "rescheduled") && past);
            return (
              <li key={interview.id} className="space-y-3 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {interviewKindLabel(interview.kind)} with {interviewer}
                    </p>
                    <p className="text-sm text-muted">
                      {interview.application?.vacancy?.title ?? "Unknown vacancy"}
                      {" · "}
                      {interview.starts_at ? (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3.5" aria-hidden="true" />
                          {formatDateTime(interview.starts_at)}
                        </span>
                      ) : interview.status === "invited" ? (
                        interview.invite_mailed_at ? (
                          `invited ${formatDateTime(interview.invite_mailed_at)}, no time booked yet`
                        ) : (
                          "invitation not mailed, send the link yourself"
                        )
                      ) : (
                        "no time"
                      )}
                    </p>
                    {interview.cancellation_reason && (
                      <p className="text-xs text-muted">Reason: {interview.cancellation_reason}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {interview.status === "invited" && (
                      <ConfirmButton
                        size="sm"
                        variant="ghost"
                        title="Withdraw invitation?"
                        description="The booking link stops counting for this interview. Tell the candidate if they already got the mail."
                        confirmLabel="Withdraw"
                        action={withdrawInvitation.bind(null, interview.id)}
                      >
                        Withdraw
                      </ConfirmButton>
                    )}
                  </div>
                </div>
                {interview.status === "invited" && interview.invite_url && (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline pointer-coarse:min-h-10">
                      Booking link for this candidate
                    </summary>
                    <p className="mt-1 text-xs break-all text-muted">{interview.invite_url}</p>
                  </details>
                )}
                {interview.feedback_at && (
                  <p className="text-sm text-ink">
                    Rating {interview.rating ?? "n/a"}/5, communication {interview.communication ?? "n/a"}/5
                    {interview.feedback ? (
                      <span className="mt-1 block whitespace-pre-line text-muted">{interview.feedback}</span>
                    ) : null}
                  </p>
                )}
                {canGiveFeedback && (
                  <details open={!interview.feedback_at}>
                    <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline pointer-coarse:min-h-10">
                      {interview.feedback_at ? "Edit feedback" : "Fill in feedback"}
                    </summary>
                    <div className="mt-3">
                      <InterviewFeedbackForm
                        action={saveInterviewFeedback.bind(null, interview.id)}
                        interviewId={interview.id}
                        status={interview.status}
                        rating={interview.rating}
                        communication={interview.communication}
                        feedback={interview.feedback}
                      />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
