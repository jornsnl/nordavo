"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FileText, LoaderCircle, MapPin, Search } from "lucide-react";
import { ActionFeedback } from "@/components/talent/action-button";
import { ScoreBar } from "@/components/talent/score-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import type { TalentPoolHit } from "@/lib/screening/talent-search";
import type { TalentActionState } from "@/lib/talent/types";
import { createPoolProfileAction, talentPoolSearchAction, type TalentPoolState } from "@/app/dashboard/vacancies/screening-actions";

type VacancyOption = { id: string; title: string; clientName: string };

/** Talent pool AI (2.15): a profile in free text or a vacancy in, the top 5 out. */
export function TalentPoolSearch({ vacancies, claude }: { vacancies: VacancyOption[]; claude: boolean }) {
  const [state, action, pending] = useActionState(talentPoolSearchAction, {} as TalentPoolState);
  const answer = state.answer;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Who fits this profile?"
          description="Describe the profile in your own words, or pick a vacancy. The pool is narrowed by stack and seniority first; Claude ranks the shortlist."
        />
        <CardBody>
          <form action={action} className="space-y-4">
            <Field label="Profile" htmlFor="pool-query" hint="For example: senior data engineer, Python and dbt, Snowflake is a plus, client facing.">
              <Textarea id="pool-query" name="query" rows={3} defaultValue={state.query ?? ""} maxLength={4000} />
            </Field>
            <Field label="Or a vacancy" htmlFor="pool-vacancy" hint="Uses the stack and must haves of the vacancy. Candidates already in its pipeline are left out.">
              <Select id="pool-vacancy" name="vacancy_id" defaultValue={state.vacancyId ?? ""}>
                <option value="">No vacancy, use the text</option>
                {vacancies.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title} ({v.clientName})
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
              {pending ? "Searching the pool" : "Find the top 5"}
            </Button>
            {!claude && <p className="text-sm text-amber-900">Claude is not connected (ANTHROPIC_API_KEY): the top 5 is ranked by keyword overlap only.</p>}
            <ActionFeedback state={state} />
          </form>
        </CardBody>
      </Card>

      {answer && answer.hits.length > 0 && (
        <section aria-labelledby="pool-results" className="space-y-3">
          <div>
            <h2 id="pool-results" className="font-display text-base font-semibold text-brand-900">
              Top {answer.hits.length} for {answer.requirements.title}
            </h2>
            <p className="text-sm text-muted">
              {answer.poolSize} candidates matched the stack in the pool, {answer.shortlisted} shortlisted, ranked by {answer.rankedBy === "claude" ? "Claude" : "keyword overlap"}.
              {answer.requirements.stack.length > 0 && ` Looked for: ${answer.requirements.stack.join(", ")}.`}
            </p>
          </div>
          <ol className="space-y-3">
            {answer.hits.map((hit, i) => (
              <HitCard key={hit.candidateId} rank={i + 1} hit={hit} vacancies={vacancies} defaultVacancyId={state.vacancyId} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function HitCard({ rank, hit, vacancies, defaultVacancyId }: { rank: number; hit: TalentPoolHit; vacancies: VacancyOption[]; defaultVacancyId?: string }) {
  const [profileState, profileAction, pending] = useActionState(
    createPoolProfileAction.bind(null, hit.candidateId, { score: hit.score, reason: hit.reason }),
    {} as TalentActionState,
  );
  return (
    <li>
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-semibold text-muted">{rank}.</span>
                <Link href={`/dashboard/candidates/${hit.candidateId}`} className="font-medium text-brand-900 hover:underline">
                  {hit.name}
                </Link>
                {hit.seniority && <Badge tone="brand">{hit.seniority}</Badge>}
                {hit.yearsExperience !== null && <span className="text-sm text-muted">{hit.yearsExperience} years</span>}
              </div>
              {hit.currentTitle && <p className="text-sm text-muted">{hit.currentTitle}</p>}
              {hit.location && (
                <p className="flex items-center gap-1 text-sm text-muted">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {hit.location}
                </p>
              )}
            </div>
            {hit.score !== null && <ScoreBar score={hit.score} />}
          </div>
          <p className="text-sm text-ink">{hit.reason}</p>
          {(hit.risks.length > 0 || hit.missing.length > 0) && (
            <p className="text-sm text-amber-900">{[...hit.missing.map((m) => `Missing: ${m}`), ...hit.risks].join(". ")}</p>
          )}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted uppercase">Skills</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {hit.skills.length > 0 ? hit.skills.slice(0, 12).map((s) => <Badge key={s}>{s}</Badge>) : <span className="text-muted">None filled in</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted uppercase">Project experience</dt>
              <dd className="mt-1 text-ink">
                {hit.projectTypes.length > 0 || hit.sectors.length > 0 ? [...hit.projectTypes, ...hit.sectors].join(", ") : <span className="text-muted">None filled in</span>}
              </dd>
            </div>
            {(hit.availability || hit.englishLevel) && (
              <div className="sm:col-span-2 text-muted">
                {[hit.availability ? `Availability: ${hit.availability}` : null, hit.englishLevel ? `English: ${hit.englishLevel}` : null].filter(Boolean).join(". ")}
              </div>
            )}
          </dl>
          <form action={profileAction} className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-end">
            <Field label="Anonymous profile for" htmlFor={`profile-vacancy-${hit.candidateId}`} className="sm:w-80">
              <Select id={`profile-vacancy-${hit.candidateId}`} name="vacancy_id" defaultValue={defaultVacancyId ?? ""} required>
                <option value="" disabled>
                  Choose a vacancy
                </option>
                {vacancies.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title} ({v.clientName})
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <FileText aria-hidden="true" />}
              {pending ? "Writing the profile" : "Create anonymous profile"}
            </Button>
          </form>
          <ActionFeedback state={profileState} />
          {profileState.link && (
            <a href={profileState.link.href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-700 hover:underline">
              {profileState.link.label}
            </a>
          )}
        </CardBody>
      </Card>
    </li>
  );
}
