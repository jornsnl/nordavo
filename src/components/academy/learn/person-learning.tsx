import Link from "next/link";
import { getPersonLearning } from "@/lib/academy/learn/admin";
import { parseQuestionnaire, parseQuestionnaireResult } from "@/lib/academy/learn/questionnaire";
import { taskDueState } from "@/lib/academy/learn/tasks";
import type { Json } from "@/lib/database.types";
import { formatDate, formatDateTime } from "@/lib/format";
import { SubmissionStatusBadge } from "@/components/academy/learn/review-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

/**
 * Knowledge check scores, assignments, tasks and questionnaires of one
 * person, for /dashboard/academy/people/[id] (Academy managers only; the
 * questionnaire answers are never shown to clients or readers).
 */
export async function PersonLearningCards({ profileId }: { profileId: string }) {
  const { checks, assignments, tasks, questionnaires } = await getPersonLearning(profileId);
  const openTasks = tasks.filter((t) => !t.done_at);
  const overdue = openTasks.filter((t) => taskDueState(t.due_at, t.done_at) === "overdue").length;

  return (
    <>
      <Card>
        <CardHeader title="Knowledge checks" description="Scored automatically; every attempt is kept. Also in the ATS (academy_candidate_check_scores)." />
        <CardBody>
          {checks.length === 0 ? (
            <p className="text-sm text-muted">No knowledge check done yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {checks.map((c) => (
                <li key={c.blockId} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <span>
                    <span className="block text-sm font-medium">{c.title}</span>
                    <span className="block text-xs text-muted">{c.lessonTitle}</span>
                  </span>
                  <span className="text-sm">
                    <Badge tone={c.bestPercent >= 67 ? "success" : "warning"}>best {c.bestPercent}%</Badge>
                    <span className="ml-2 text-xs text-muted">
                      last {c.lastPercent}% · {c.attempts} attempt{c.attempts === 1 ? "" : "s"} · {formatDate(c.lastAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Assignments" description="The latest attempt per assignment. Open one to review it." />
        <CardBody>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted">Nothing handed in yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {assignments.map((a) => (
                <li key={a.submission.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <span>
                    <Link href={`/dashboard/academy/reviews/${a.submission.id}`} className="block text-sm font-medium text-brand-800 hover:underline">
                      {a.blockTitle}
                    </Link>
                    <span className="block text-xs text-muted">
                      {a.lessonTitle} · attempt {a.submission.attempt} · {formatDateTime(a.submission.submitted_at)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <SubmissionStatusBadge status={a.submission.status} />
                    {a.aiStatus === "ready" && a.aiTotal !== null && <Badge tone="brand">AI {a.aiTotal}</Badge>}
                    {a.submission.final_score !== null && <Badge tone="success">{a.submission.final_score}/100</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Course tasks"
          description={openTasks.length === 0 ? "No open tasks." : `${openTasks.length} open${overdue > 0 ? `, ${overdue} overdue` : ""}.`}
        />
        <CardBody>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted">No tasks apply to this person yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map((task) => {
                const state = taskDueState(task.due_at, task.done_at);
                return (
                  <li key={`${task.task_id}:${task.placement_id ?? ""}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
                    <span>
                      <span className={`block text-sm ${task.done_at ? "text-muted line-through" : "font-medium"}`}>{task.title}</span>
                      <span className="block text-xs text-muted">
                        {task.lesson_title}
                        {task.shared && " · shared in the placement"}
                      </span>
                    </span>
                    <span className="text-xs">
                      {state === "done" ? (
                        <Badge tone="success">Done {formatDate(task.done_at)}</Badge>
                      ) : state === "overdue" ? (
                        <Badge tone="danger">Overdue · {formatDate(task.due_at)}</Badge>
                      ) : task.due_at ? (
                        <span className="text-muted">Due {formatDate(task.due_at)}</span>
                      ) : (
                        <span className="text-muted">No deadline</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {questionnaires.length > 0 && (
        <Card>
          <CardHeader title="Questionnaire" description="Answers are only visible to Nordavo with the academy module; never to clients or readers. The ATS gets the result summary." />
          <CardBody className="space-y-5">
            {questionnaires.map((q) => {
              const def = parseQuestionnaire(q.content as Json);
              const result = parseQuestionnaireResult(q.response?.result ?? null);
              const answers = (q.response?.answers ?? {}) as Record<string, unknown>;
              const withdrawn = Boolean(q.consent?.withdrawn_at);
              return (
                <div key={q.blockId} className="space-y-2">
                  <p className="text-sm font-semibold text-brand-900">{q.title}</p>
                  <p className="text-xs text-muted">
                    {q.consent ? `Consent ${formatDateTime(q.consent.consented_at)}` : "No consent"}
                    {withdrawn && ` · withdrawn ${formatDateTime(q.consent!.withdrawn_at)}`}
                    {q.response?.submitted_at ? ` · submitted ${formatDateTime(q.response.submitted_at)}` : q.response ? " · draft" : ""}
                  </p>
                  {result.length > 0 && (
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
                      {result.map((d) => (
                        <div key={d.key} className="contents">
                          <dt className="text-muted">{d.label}</dt>
                          <dd className="font-semibold tabular-nums">{d.score ?? "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {q.response && !withdrawn && (
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-brand-700">Answers</summary>
                      <ol className="mt-2 space-y-2 text-sm">
                        {def.questions.map((question) => {
                          const value = answers[question.id];
                          const shown =
                            value === undefined
                              ? "—"
                              : question.kind === "choice" && typeof value === "number"
                                ? (question.options[value] ?? String(value))
                                : String(value);
                          return (
                            <li key={question.id}>
                              <span className="block text-muted">{question.text}</span>
                              <span className="block whitespace-pre-line">{shown}</span>
                            </li>
                          );
                        })}
                      </ol>
                    </details>
                  )}
                </div>
              );
            })}
          </CardBody>
        </Card>
      )}
    </>
  );
}
