import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KanbanSquare, ListOrdered, Settings2 } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { BreakdownList } from "@/components/screening/breakdown-list";
import { ScreeningHeader, ScreeningSkeleton } from "@/components/screening/screening-page";
import { RequirementsForm, ScoreControls } from "@/components/screening/scoring-forms";
import { ActionButton } from "@/components/talent/action-button";
import { ScoreBar } from "@/components/talent/score-bar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { hasClaude } from "@/lib/ai/claude";
import { getScoringRequirements, getScreeningVacancy, listRanking } from "@/lib/data/screening";
import type { CvVerdict } from "@/lib/database.types";
import { applicationStages, cvVerdicts, optionFor } from "@/lib/labels";
import { scoreApplicationAction } from "../../screening-actions";

export const metadata: Metadata = {
  title: "CV ranking",
};

export const maxDuration = 300;

type Filter = CvVerdict | "unscored" | "all";

function parseFilter(value: string | string[] | undefined): Filter {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "fit" || v === "maybe" || v === "no_fit" || v === "unscored" ? v : "all";
}

export default function Page({ params, searchParams }: PageProps<"/dashboard/vacancies/[id]/ranking">) {
  return (
    <Suspense fallback={<ScreeningSkeleton />}>
      <RankingPage params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function RankingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const vacancy = await getScreeningVacancy(id);
  if (!vacancy) notFound();
  const [query, rows, reqs] = await Promise.all([searchParams, listRanking(vacancy.id), getScoringRequirements(vacancy)]);
  const filter = parseFilter(query.verdict);
  const active = rows.filter((r) => r.stage !== "rejected");
  const counts = {
    all: rows.length,
    fit: rows.filter((r) => r.cvVerdict === "fit").length,
    maybe: rows.filter((r) => r.cvVerdict === "maybe").length,
    no_fit: rows.filter((r) => r.cvVerdict === "no_fit").length,
    unscored: rows.filter((r) => r.cvScore === null).length,
  };
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "unscored" ? r.cvScore === null : r.cvVerdict === filter));
  const claude = hasClaude();
  const unscoredActive = active.filter((r) => r.cvScore === null).length;

  return (
    <>
      <ScreeningHeader
        vacancy={vacancy}
        eyebrow="CV ranking"
        title={vacancy.title}
        description="Every CV scored against the job: match percentage, verdict and per requirement whether it is met. Must have misses are shown in red."
        actions={
          <>
            <ButtonLink href={`/dashboard/vacancies/${vacancy.id}/pipeline`} variant="secondary">
              <KanbanSquare aria-hidden="true" />
              Pipeline
            </ButtonLink>
            <ButtonLink href="/dashboard/settings/screening-prompts" variant="secondary">
              <Settings2 aria-hidden="true" />
              Prompt versions
            </ButtonLink>
          </>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Requirements"
            description={
              reqs.structured
                ? "Scoring uses these requirements."
                : "Not set yet: scoring now uses the must haves, stack and nice to haves of the vacancy (shown below). Save to make them your own."
            }
          />
          <CardBody>
            <RequirementsForm vacancyId={vacancy.id} requirements={reqs.effective} model={vacancy.screening_model} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Score"
            description="One click scores up to 60 CVs. For all of them, run the screening-score job (Jobs page, or POST /api/jobs/screening-score). Rejected and placed candidates are skipped."
          />
          <CardBody>
            <ScoreControls vacancyId={vacancy.id} claude={claude} unscored={unscoredActive} />
          </CardBody>
        </Card>

        <nav aria-label="Filter on verdict" className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `All (${counts.all})`],
              ["fit", `Fits (${counts.fit})`],
              ["maybe", `Maybe (${counts.maybe})`],
              ["no_fit", `Does not fit (${counts.no_fit})`],
              ["unscored", `Not scored (${counts.unscored})`],
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <Link
              key={value}
              href={value === "all" ? `/dashboard/vacancies/${vacancy.id}/ranking` : `/dashboard/vacancies/${vacancy.id}/ranking?verdict=${value}`}
              aria-current={filter === value ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition pointer-coarse:py-2 ${filter === value ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-brand-900 ring-border hover:bg-brand-50"}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {shown.length === 0 ? (
          <EmptyState icon={ListOrdered} title="Nobody here" description={rows.length === 0 ? "No candidates in this vacancy yet. Import an export or upload CVs." : "No candidates with this verdict."} />
        ) : (
          <Card>
            <ol className="divide-y divide-border">
              {shown.map((r, i) => {
                const stage = optionFor(applicationStages, r.stage);
                const verdict = r.cvVerdict ? optionFor(cvVerdicts, r.cvVerdict) : null;
                return (
                  <li key={r.applicationId} className="px-4 py-4 sm:px-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <span className="w-8 shrink-0 font-display text-sm font-semibold text-muted tabular-nums">{r.cvScore !== null ? `${i + 1}.` : ""}</span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/dashboard/candidates/${r.candidateId}`} className="font-medium text-brand-900 hover:underline">
                            {r.name}
                          </Link>
                          {verdict && <Badge tone={verdict.tone}>{verdict.label}</Badge>}
                          <Badge tone={stage.tone}>{stage.label}</Badge>
                          {r.origin === "headhunted" && <Badge tone="accent">Headhunted</Badge>}
                          {r.cvTextPending && <Badge tone="warning">CV text pending</Badge>}
                          {!r.hasCvText && !r.cvTextPending && <Badge>No CV text</Badge>}
                        </div>
                        {r.title && <p className="text-sm text-muted">{r.title}</p>}
                        {r.mustHaveMissing.length > 0 && (
                          <p className="text-sm font-medium text-danger">Missing must have: {r.mustHaveMissing.join(", ")}</p>
                        )}
                        {r.summary && <p className="text-sm text-ink">{r.summary}</p>}
                        {r.breakdown.length > 0 && (
                          <details className="text-sm">
                            <summary className="cursor-pointer font-medium text-brand-700">Per requirement</summary>
                            <div className="mt-2">
                              <BreakdownList items={r.breakdown} />
                              {r.model && (
                                <p className="mt-2 text-xs text-muted">
                                  {r.model}, prompt version {r.promptVersion ?? 0}
                                </p>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                        {r.cvScore !== null && <ScoreBar score={r.cvScore} />}
                        <ActionButton action={scoreApplicationAction.bind(null, r.applicationId)} pendingLabel={claude ? "Scoring" : "Queueing"}>
                          {r.cvScore === null ? "Score" : "Score again"}
                        </ActionButton>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        )}
      </div>
    </>
  );
}
