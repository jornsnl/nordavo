import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { AnswerList, TalentPoolSearch } from "@/components/screening/talent-pool-search";
import { ListSkeleton } from "@/components/ui/skeleton";
import { hasClaude } from "@/lib/ai/claude";
import { recentAiRequests } from "@/lib/ai/queue";
import { listOpenVacancyOptions } from "@/lib/data/applications";
import { formatDateTime } from "@/lib/format";
import { answerFromRequest } from "@/lib/screening/talent-search";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Talent pool",
};

// Claude ranks the shortlist and may write an anonymous profile.
export const maxDuration = 300;

export default function Page() {
  return (
    <>
      <Link
        href="/dashboard/candidates"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All candidates
      </Link>
      <PageHeader
        eyebrow="Recruitment"
        title="Talent pool"
        description="Ask who the best candidates are for a profile, with the reason, skills, project experience and location, and make an anonymous profile in one click."
        actions={
          <ButtonLink href="/dashboard/candidates/academy" variant="secondary">
            <GraduationCap aria-hidden="true" />
            Academy results
          </ButtonLink>
        }
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Search />
      </Suspense>
    </>
  );
}

async function Search() {
  const vacancies = (await listOpenVacancyOptions()).map((v) => ({ id: v.id, title: v.title, clientName: v.clientName }));
  return (
    <div className="space-y-8">
      <TalentPoolSearch vacancies={vacancies} claude={hasClaude()} />
      {!hasClaude() && <ClaudeAnswers vacancies={vacancies} />}
    </div>
  );
}

/** Questions Claude ranked through the MCP (claude-requests), newest first. */
async function ClaudeAnswers({ vacancies }: { vacancies: { id: string; title: string; clientName: string }[] }) {
  const db = await createClient();
  const requests = await recentAiRequests(db, "talent_pool_rank", 5);
  if (requests.length === 0) return null;
  const answers = await Promise.all(requests.map(async (r) => ({ request: r, answer: await answerFromRequest(db, r) })));
  return (
    <section aria-labelledby="claude-answers" className="space-y-6">
      <h2 id="claude-answers" className="font-display text-lg font-semibold text-brand-900">
        Claude&apos;s answers
      </h2>
      {answers.map(({ request, answer }) => {
        const question = typeof request.context.query === "string" ? request.context.query : answer?.requirements.title ?? "Talent pool question";
        if (request.status !== "done" || !answer) {
          return (
            <p key={request.id} className="rounded-2xl border border-dashed border-brand-200 bg-card px-5 py-4 text-sm text-muted">
              &ldquo;{question}&rdquo;, asked {formatDateTime(request.createdAt)}:{" "}
              {request.status === "failed" ? `Claude could not answer (${request.error ?? "unknown error"}).` : "waiting for Claude."}
            </p>
          );
        }
        return (
          <AnswerList
            key={request.id}
            answer={answer}
            vacancies={vacancies}
            defaultVacancyId={typeof request.context.vacancy_id === "string" ? request.context.vacancy_id : undefined}
            heading={`“${question}”, answered ${formatDateTime(request.completedAt ?? request.createdAt)}`}
          />
        );
      })}
    </section>
  );
}
