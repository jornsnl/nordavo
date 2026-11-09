import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { getCandidateAcademy } from "@/lib/academy/ats/data";
import { formatDays, formatPercent } from "@/lib/academy/ats/pool";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { CandidateOpenModules, EnrolCandidateForm, RetryAcademyButton, TopCandidateToggle } from "./candidate-forms";
import { atsEventLabel, atsEventTone, moduleStateText, submissionStatusText } from "./labels";

/**
 * Academy to ATS on the candidate page (docs/academy.md, ATS-koppeling):
 * live from the Academy tables. Background for Nordavo only; nothing here
 * rejects anyone. ATS to Academy: enrol, open modules, top candidate.
 */
export async function AcademyCandidateCard({ candidateId, hasEmail }: { candidateId: string; hasEmail: boolean }) {
  const { detail, canManage, groups, developerCourseId, modules } = await getCandidateAcademy(candidateId);
  const summary = detail?.summary ?? null;
  const person = detail?.person ?? null;
  const events = detail?.events ?? [];
  const waiting = events.some((e) => e.status === "pending" || e.status === "failed");
  const courseModules = person?.modules.filter((m) => m.course_id === (person.developer_course_id ?? developerCourseId)) ?? [];

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <GraduationCap className="size-4 text-brand-700" aria-hidden="true" />
            Academy
            {summary?.enrolled ? (
              <Badge tone={summary.completed_at ? "success" : "brand"}>{summary.completed_at ? "Course completed" : `${summary.progress_percent}%`}</Badge>
            ) : (
              <Badge>Not in the Academy</Badge>
            )}
            {summary?.top_candidate && <Badge tone="warning">Top candidate</Badge>}
            {summary?.inactive_14d && <Badge tone="danger">Inactive 14 days</Badge>}
            {summary?.certificate_issued_at && <Badge tone="success">Certificate</Badge>}
          </span>
        }
        description="Results in the developer course, live. Background for Nordavo only: nothing is rejected automatically."
        actions={
          person && canManage ? (
            <ButtonLink href={`/dashboard/academy/people/${person.member.profile_id}`} variant="secondary" size="sm">
              Open in the Academy
            </ButtonLink>
          ) : null
        }
      />
      <CardBody className="space-y-6">
        {!summary?.enrolled || !person ? (
          <div className="grid gap-6 sm:grid-cols-2">
            {canManage ? (
              <EnrolCandidateForm candidateId={candidateId} modules={modules} groups={groups} hasEmail={hasEmail} />
            ) : (
              <p className="text-sm text-muted">Academy managers (module Academy) add candidates to the developer course.</p>
            )}
            <TopCandidateToggle candidateId={candidateId} on={summary?.top_candidate ?? false} />
          </div>
        ) : (
          <>
            <DetailList
              items={[
                { label: "Progress", value: `${summary.progress_percent}% · ${summary.lessons_done} of ${summary.lessons_total} lessons` },
                { label: "Modules done", value: `${summary.modules_done} of ${summary.modules_total}` },
                { label: "Started", value: summary.started_at ? formatDate(summary.started_at) : "Not yet" },
                {
                  label: summary.completed_at ? "Lead time" : "In the course for",
                  value: summary.lead_time_days !== null ? formatDays(summary.lead_time_days) : null,
                },
                {
                  label: "Last activity",
                  value: summary.last_activity_at ? (
                    <span className={summary.inactive_14d ? "font-medium text-danger" : undefined}>{formatDateTime(summary.last_activity_at)}</span>
                  ) : (
                    "Never"
                  ),
                },
                { label: "Knowledge checks", value: summary.checks_done > 0 ? `${formatPercent(summary.check_avg_percent)} average · ${summary.checks_done} done` : "None yet" },
                {
                  label: "Assignments",
                  value:
                    summary.assignments_submitted > 0
                      ? `${summary.assignments_submitted} handed in${summary.assignments_waiting > 0 ? `, ${summary.assignments_waiting} waiting for a reply` : ""}`
                      : "None yet",
                },
                {
                  label: "Scores (AI proposal / final)",
                  value:
                    summary.ai_avg_score !== null || summary.final_avg_score !== null
                      ? `${summary.ai_avg_score ?? "–"} / ${summary.final_avg_score ?? "–"}`
                      : null,
                },
                { label: "Watched (average)", value: summary.watch_avg_percent !== null ? formatPercent(summary.watch_avg_percent) : null },
                { label: "Certificate", value: summary.certificate_issued_at ? `Yes, ${formatDate(summary.certificate_issued_at)}` : "No" },
              ]}
            />

            {courseModules.length > 0 && (
              <section>
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Modules</h3>
                <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                  {courseModules.map((m) => (
                    <li key={m.module_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{m.title}</span>
                      <span className="text-xs text-muted">
                        {m.completed_at ? `Done ${formatDate(m.completed_at)}` : moduleStateText(m.state)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Lessons done</h3>
              {person.lessons.filter((l) => l.completed_at).length === 0 ? (
                <p className="mt-1 text-sm text-muted">No lesson done yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {person.lessons
                    .filter((l) => l.completed_at)
                    .map((l) => (
                      <li key={l.lesson_id} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{l.title}</span>
                        <span className="shrink-0 text-xs text-muted">{formatDate(l.completed_at)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </section>

            {person.checks.length > 0 && (
              <section>
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Knowledge checks</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {person.checks.map((c) => (
                    <li key={c.block_id} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {c.lesson_title} <span className="text-muted">· {c.title}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">
                        best {c.best_percent}% · {c.attempts} {c.attempts === 1 ? "attempt" : "attempts"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {person.assignments.length > 0 && (
              <section>
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Assignments</h3>
                <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                  {person.assignments.map((a) => (
                    <li key={a.submission_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{a.lesson_title}</span>
                        <span className="text-xs text-muted">
                          {submissionStatusText(a.status)} · attempt {a.attempt} · {formatDate(a.submitted_at)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-xs">
                        <span title="AI proposal">AI {a.ai_total ?? "–"}</span>
                        <span title="Final score" className="font-semibold">
                          Final {a.final_score ?? "–"}
                        </span>
                        {a.link_url && (
                          <a href={a.link_url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                            Link
                          </a>
                        )}
                        {canManage && (
                          <Link href={`/dashboard/academy/people/${person.member.profile_id}`} className="text-brand-700 hover:underline">
                            Review
                          </Link>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {person.videos.length > 0 && (
              <section>
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Watched per video</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {person.videos.map((v) => (
                    <li key={v.video_id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate">{v.title}</span>
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                        <span className="block h-full bg-brand-600" style={{ width: `${v.percent}%` }} />
                      </span>
                      <span className="w-10 text-right text-xs tabular-nums text-muted">{v.percent}%</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              {canManage && developerCourseId && courseModules.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Open modules for this person</h3>
                  <CandidateOpenModules profileId={person.member.profile_id} courseId={developerCourseId} modules={courseModules} />
                </section>
              )}
              <section>
                <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Top candidate</h3>
                <TopCandidateToggle candidateId={candidateId} on={summary.top_candidate} />
              </section>
            </div>
          </>
        )}

        {events.length > 0 && (
          <section>
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Automation</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={atsEventTone(e.status)}>{e.status}</Badge>
                  <span>{atsEventLabel(e.kind)}</span>
                  <span className="text-xs text-muted">{formatDateTime(e.created_at)}</span>
                  {e.error && <span className="text-xs text-danger">{e.error}</span>}
                </li>
              ))}
            </ul>
            {waiting && canManage && (
              <div className="mt-2">
                <RetryAcademyButton candidateId={candidateId} />
              </div>
            )}
          </section>
        )}
      </CardBody>
    </Card>
  );
}
