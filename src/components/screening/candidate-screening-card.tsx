import Link from "next/link";
import { BreakdownList } from "@/components/screening/breakdown-list";
import { ActionButton } from "@/components/talent/action-button";
import { ScoreBar } from "@/components/talent/score-bar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { hasClaude } from "@/lib/ai/claude";
import { getCandidateCvState, listCandidateScores } from "@/lib/data/screening";
import { formatDate } from "@/lib/format";
import { cvVerdicts, optionFor } from "@/lib/labels";
import { readCvAction, scoreApplicationAction } from "@/app/dashboard/vacancies/screening-actions";

/**
 * Candidate page card: the CV text state with "Read CV" (fills cv_text from
 * the uploaded file), and the CV score per vacancy with the breakdown.
 */
export async function CandidateScreeningCard({ candidateId }: { candidateId: string }) {
  const [cv, scores] = await Promise.all([getCandidateCvState(candidateId), listCandidateScores(candidateId)]);
  if (!cv) return null;
  const claude = hasClaude();
  const status = cv.status === "pending" ? "Text pending" : cv.status === "failed" ? "Could not be read" : cv.hasText ? "CV text available" : "No CV text";
  return (
    <Card>
      <CardHeader
        title="CV screening"
        description={
          cv.hasFile
            ? `${status}${cv.readAt ? `, read on ${formatDate(cv.readAt)}` : ""}.`
            : "No CV uploaded yet. Upload one on Edit, or in bulk on a vacancy."
        }
        actions={
          cv.hasFile ? (
            <ActionButton action={readCvAction.bind(null, candidateId)} pendingLabel="Reading" className="max-w-xs text-right">
              Read CV
            </ActionButton>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {cv.status === "pending" && !claude && (
          <p className="text-sm text-muted">Claude reads this PDF through the MCP in its next run of claude-screening, then scores it.</p>
        )}
        {scores.length === 0 ? (
          <p className="text-sm text-muted">Not in a vacancy yet, so there is no CV score.</p>
        ) : (
          <ul className="divide-y divide-border">
            {scores.map((s) => {
              const verdict = s.verdict ? optionFor(cvVerdicts, s.verdict) : null;
              return (
                <li key={s.applicationId} className="space-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/vacancies/${s.vacancyId}/ranking`} className="font-medium text-brand-900 hover:underline">
                        {s.vacancyTitle}
                      </Link>
                      {verdict && <Badge tone={verdict.tone}>{verdict.label}</Badge>}
                    </div>
                    <div className="flex items-center gap-3">
                      {s.score !== null && <ScoreBar score={s.score} />}
                      <ActionButton action={scoreApplicationAction.bind(null, s.applicationId)} pendingLabel={claude ? "Scoring" : "Queueing"}>
                        {s.score === null ? "Score CV" : "Score again"}
                      </ActionButton>
                    </div>
                  </div>
                  {s.summary && <p className="text-sm text-ink">{s.summary}</p>}
                  {s.breakdown.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium text-brand-700">Per requirement</summary>
                      <div className="mt-2">
                        <BreakdownList items={s.breakdown} />
                        <p className="mt-2 text-xs text-muted">
                          {s.model}, prompt version {s.promptVersion ?? 0}
                          {s.scoredAt ? `, ${formatDate(s.scoredAt)}` : ""}
                        </p>
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
