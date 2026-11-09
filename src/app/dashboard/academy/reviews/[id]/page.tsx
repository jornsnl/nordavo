import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { z } from "zod";
import { RUBRIC } from "@/lib/academy/learn/assignment";
import { type ReviewAttempt, getReview } from "@/lib/academy/learn/admin";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { SubmissionStatusBadge } from "@/components/academy/learn/review-badges";
import { AiProposalButton, ReviewForm } from "@/components/academy/learn/review-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Academy review" };

export default function Page({ params }: PageProps<"/dashboard/academy/reviews/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <Review params={params} />
    </Suspense>
  );
}

function Attempt({ attempt }: { attempt: ReviewAttempt }) {
  return (
    <div className="space-y-3 text-sm">
      {attempt.body && <p className="whitespace-pre-line text-ink">{attempt.body}</p>}
      {attempt.file_name && (
        <p className="flex items-center gap-1.5">
          <FileText className="size-4 text-brand-600" aria-hidden="true" />
          {attempt.fileUrl ? (
            <a href={attempt.fileUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline">
              {attempt.file_name}
            </a>
          ) : (
            attempt.file_name
          )}
        </p>
      )}
      {attempt.link_url && (
        <p className="flex items-center gap-1.5">
          <ExternalLink className="size-4 text-brand-600" aria-hidden="true" />
          <a href={attempt.link_url} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-medium text-brand-700 hover:underline">
            {attempt.link_url}
          </a>
        </p>
      )}
      {!attempt.body && !attempt.file_name && !attempt.link_url && <p className="text-muted">Empty.</p>}
    </div>
  );
}

async function Review({ params }: Pick<PageProps<"/dashboard/academy/reviews/[id]">, "params">) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const review = await getReview(id);
  if (!review) notFound();
  const { submission, ai } = review;
  const earlier = review.attempts.filter((a) => a.id !== submission.id);

  return (
    <>
      <Link href="/dashboard/academy/reviews" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Reviews
      </Link>
      <PageHeader
        eyebrow={`Academy · ${review.lessonTitle}`}
        title={review.blockTitle}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/academy/people/${submission.profile_id}`} className="font-medium text-brand-800 hover:underline">
              {review.personName ?? review.personEmail ?? "Unknown"}
            </Link>
            <SubmissionStatusBadge status={submission.status} />
            <span className="text-xs">
              Attempt {submission.attempt} · handed in {formatDateTime(submission.submitted_at)}
            </span>
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-6">
          {review.prompt && (
            <Card>
              <CardHeader title="The assignment" />
              <CardBody>
                <p className="text-sm whitespace-pre-line text-ink">{review.prompt}</p>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Handed in" />
            <CardBody>
              <Attempt attempt={submission} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Your review" description="The learner sees the feedback, the status and the final score; never the AI proposal or the rubric." />
            <CardBody>
              <ReviewForm
                submissionId={submission.id}
                initial={{ rubric: review.rubric, finalScore: submission.final_score, feedback: submission.feedback ?? "" }}
                aiScores={ai.status === "ready" ? ai.scores : {}}
                canReview={review.isLatest}
              />
            </CardBody>
          </Card>
          {earlier.length > 0 && (
            <Card>
              <CardHeader title="History" description="Every attempt is kept." />
              <CardBody>
                <ol className="space-y-5">
                  {earlier.map((a) => (
                    <li key={a.id} className="space-y-2 border-t border-border pt-4 first:border-0 first:pt-0">
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Link href={`/dashboard/academy/reviews/${a.id}`} className="font-semibold text-brand-800 hover:underline">
                          Attempt {a.attempt}
                        </Link>
                        <SubmissionStatusBadge status={a.status} />
                        {formatDateTime(a.submitted_at)}
                        {a.final_score !== null && <span>· score {a.final_score}/100</span>}
                      </p>
                      <Attempt attempt={a} />
                      {a.feedback && (
                        <p className="rounded-xl bg-surface px-3 py-2 text-sm whitespace-pre-line">
                          <span className="block text-xs font-semibold text-muted">
                            Feedback{a.feedbackByName ? ` from ${a.feedbackByName}` : ""}
                            {a.feedback_at ? ` · ${formatDateTime(a.feedback_at)}` : ""}
                          </span>
                          {a.feedback}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="AI proposal" description="Only a proposal on the fixed rubric. Nordavo always decides." />
            <CardBody className="space-y-4">
              {ai.status === "ready" ? (
                <>
                  <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
                    {RUBRIC.map((r) => (
                      <div key={r.key} className="contents">
                        <dt className="text-muted">{r.label}</dt>
                        <dd className="font-semibold tabular-nums">{ai.scores[r.key] ?? "—"} / 5</dd>
                      </div>
                    ))}
                    <dt className="font-medium">Total</dt>
                    <dd>
                      <Badge tone="brand">{ai.total ?? "—"}/100</Badge>
                    </dd>
                  </dl>
                  {ai.summary && <p className="text-sm whitespace-pre-line text-ink">{ai.summary}</p>}
                  {ai.createdAt && <p className="text-xs text-muted">Made {formatDateTime(ai.createdAt)}</p>}
                </>
              ) : ai.status === "pending" ? (
                <p className="text-sm text-muted">Claude is working on it (directly, or in its next run of claude-requests). Refresh the page later.</p>
              ) : ai.status === "failed" ? (
                <p className="text-sm text-danger">{ai.summary ?? "The AI proposal failed."}</p>
              ) : (
                <p className="text-sm text-muted">No proposal yet.</p>
              )}
              {review.aiAvailable && <AiProposalButton submissionId={submission.id} again={ai.status === "ready" || ai.status === "failed"} />}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
