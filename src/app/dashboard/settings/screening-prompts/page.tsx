import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { CompareForm, NewPromptForm } from "@/components/screening/prompt-forms";
import { ActionButton } from "@/components/talent/action-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SCREENING_DEFAULT_INSTRUCTIONS } from "@/lib/ai/prompts/screening";
import { getCurrentUser } from "@/lib/auth";
import { listOpenVacancyOptions } from "@/lib/data/applications";
import { getScoringSpend, listComparisons, listScreeningPrompts } from "@/lib/data/screening";
import { formatDate } from "@/lib/format";
import { cvVerdicts, optionFor } from "@/lib/labels";
import { compareScores } from "@/lib/screening/scoring";
import { activatePromptAction } from "@/app/dashboard/vacancies/screening-actions";

export const metadata: Metadata = {
  title: "Screening prompts",
};

export const maxDuration = 300;

export default function Page() {
  return (
    <>
      <Link
        href="/dashboard/settings"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Settings
      </Link>
      <PageHeader
        eyebrow="Screening"
        title="CV scoring prompts"
        description="The instructions Claude uses to score CVs against a job. Save a new version, compare it on a sample of already scored CVs, and activate it when it does better. Every score records its version."
      />
      <Suspense fallback={<ListSkeleton rows={5} />}>
        <Prompts />
      </Suspense>
    </>
  );
}

async function Prompts() {
  const user = await getCurrentUser();
  const isAdmin = user.role === "admin";
  const [prompts, vacancies, comparisons, spend] = await Promise.all([
    listScreeningPrompts(),
    listOpenVacancyOptions(),
    listComparisons(60),
    isAdmin ? getScoringSpend() : Promise.resolve(null),
  ]);
  const active = prompts.find((p) => p.is_active) ?? null;
  const vacancyOptions = vacancies.map((v) => ({ id: v.id, title: v.title }));
  const summary = compareScores(
    comparisons.map((c) => ({ before: c.before?.score ?? null, after: c.after.score, beforeVerdict: c.before?.verdict ?? null, afterVerdict: c.after.verdict })),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Versions"
          description={active ? `Version ${active.version} is active.` : "No version is active: the built-in instructions (version 0) are used."}
        />
        <ul className="divide-y divide-border">
          <li className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">Version 0, built-in</span>
              {!active && <Badge tone="success">Active</Badge>}
              {isAdmin && active && (
                <ActionButton action={activatePromptAction.bind(null, null)} pendingLabel="Switching">
                  Use the built-in again
                </ActionButton>
              )}
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-brand-700">Instructions</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-surface p-3 text-xs whitespace-pre-wrap">{SCREENING_DEFAULT_INSTRUCTIONS}</pre>
            </details>
            <CompareForm promptId={null} vacancies={vacancyOptions} />
          </li>
          {prompts.map((p) => (
            <li key={p.id} className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">Version {p.version}</span>
                {p.is_active && <Badge tone="success">Active</Badge>}
                <span className="text-sm text-muted">
                  {formatDate(p.created_at)}
                  {p.author ? `, ${p.author.full_name || p.author.email}` : ""}
                </span>
                {isAdmin && !p.is_active && (
                  <ActionButton action={activatePromptAction.bind(null, p.id)} pendingLabel="Activating">
                    Activate
                  </ActionButton>
                )}
              </div>
              {p.notes && <p className="text-sm text-ink">{p.notes}</p>}
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-brand-700">Instructions</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-surface p-3 text-xs whitespace-pre-wrap">{p.instructions}</pre>
              </details>
              <CompareForm promptId={p.id} vacancies={vacancyOptions} />
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Comparisons"
          description={
            summary.compared > 0
              ? `Last ${comparisons.length} re-scores: on average ${summary.meanDelta > 0 ? "+" : ""}${summary.meanDelta} points (${summary.meanAbsDelta} apart), ${summary.verdictChanges} verdicts changed. Check the changed ones by hand: that is where the prompts differ.`
              : "Re-score a sample with a version to compare it with the current scores."
          }
        />
        {comparisons.length > 0 && (
          <Table>
            <THead>
              <tr>
                <TH>Candidate</TH>
                <TH>Current</TH>
                <TH>Re-score</TH>
                <TH>Difference</TH>
              </tr>
            </THead>
            <TBody>
              {comparisons.map((c, i) => {
                const delta = c.before ? c.after.score - c.before.score : null;
                const changed = c.before && c.before.verdict !== c.after.verdict;
                return (
                  <TR key={`${c.applicationId}-${i}`}>
                    <TD>{c.name}</TD>
                    <TD>
                      {c.before ? (
                        <>
                          {c.before.score} <Badge tone={optionFor(cvVerdicts, c.before.verdict).tone}>{optionFor(cvVerdicts, c.before.verdict).label}</Badge>
                          <span className="ml-1 text-xs text-muted">v{c.before.version}</span>
                        </>
                      ) : (
                        <span className="text-muted">None</span>
                      )}
                    </TD>
                    <TD>
                      {c.after.score} <Badge tone={optionFor(cvVerdicts, c.after.verdict).tone}>{optionFor(cvVerdicts, c.after.verdict).label}</Badge>
                      <span className="ml-1 text-xs text-muted">
                        v{c.after.version}, {c.after.model}
                      </span>
                    </TD>
                    <TD className={changed ? "font-semibold text-danger" : "text-muted"}>
                      {delta === null ? "" : `${delta > 0 ? "+" : ""}${delta}`}
                      {changed ? ", verdict changed" : ""}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader title="New version" description="Starts from the active instructions. Saving does not activate it." />
          <CardBody>
            <NewPromptForm defaultInstructions={active?.instructions ?? SCREENING_DEFAULT_INSTRUCTIONS} />
          </CardBody>
        </Card>
      )}

      {spend && (
        <Card>
          <CardHeader title="Spend, last 30 days" description={`${spend.count} scores.`} />
          <CardBody>
            {spend.byModel.length === 0 ? (
              <p className="text-sm text-muted">Nothing scored yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {spend.byModel.map((m) => (
                  <li key={m.model}>
                    {m.model}: {m.count} scores, about ${m.cost.toFixed(2)}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
