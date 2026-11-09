import Link from "next/link";
import { getPersonProgress } from "@/lib/academy/ats/data";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { submissionStatusText } from "./labels";

/** Overview per user: progress per lesson, watch % per video, checks and assignments (docs/academy.md, Beheeroverzichten). */
export async function PersonProgressCard({ profileId }: { profileId: string }) {
  const detail = await getPersonProgress(profileId);
  if (!detail) return null;
  const waiting = detail.assignments.filter((a) => a.status === "submitted" && !a.feedback_at);
  return (
    <Card>
      <CardHeader
        title="Progress"
        description={`Last activity ${detail.member.last_activity_at ? formatDateTime(detail.member.last_activity_at) : "never"}.`}
        actions={
          detail.member.candidate_id ? (
            <Link href={`/dashboard/candidates/${detail.member.candidate_id}`} className="text-sm font-medium text-brand-700 hover:underline">
              In the ATS
            </Link>
          ) : null
        }
      />
      <CardBody className="space-y-5">
        {detail.courses.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {detail.courses.map((c) => (
              <li key={c.course_id}>
                <Badge tone={c.done ? "success" : "brand"}>
                  {c.title}
                  {c.done ? " · done" : c.scope === "default" ? " · default modules" : ""}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <section>
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Lessons</h3>
          {detail.lessons.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No lesson opened yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {detail.lessons.map((l) => (
                <li key={l.lesson_id} className="grid grid-cols-[minmax(0,1fr)_6rem_7rem] items-center gap-3">
                  <span className="truncate">{l.title}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                    <span className={`block h-full ${l.completed_at ? "bg-emerald-600" : "bg-brand-600"}`} style={{ width: `${l.percent}%` }} />
                  </span>
                  <span className="text-right text-xs text-muted">{l.completed_at ? `done ${formatDate(l.completed_at)}` : `${l.percent}%`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {detail.videos.length > 0 && (
          <section>
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Watched per video</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {detail.videos.map((v) => (
                <li key={v.video_id} className="flex justify-between gap-3">
                  <span className="truncate">{v.title}</span>
                  <span className="tabular-nums text-muted">{v.percent}%</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {detail.checks.length > 0 && (
          <section>
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Knowledge checks</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {detail.checks.map((c) => (
                <li key={c.block_id} className="flex justify-between gap-3">
                  <span className="truncate">{c.lesson_title}</span>
                  <span className="text-xs text-muted">
                    best {c.best_percent}%, last {c.last_percent}% · {c.attempts}×
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {detail.assignments.length > 0 && (
          <section>
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
              Assignments{waiting.length > 0 ? ` · ${waiting.length} waiting for a reply` : ""}
            </h3>
            <ul className="mt-2 space-y-1 text-sm">
              {detail.assignments.map((a) => (
                <li key={a.submission_id} className="flex flex-wrap justify-between gap-3">
                  <span className="truncate">
                    {a.lesson_title} <span className="text-xs text-muted">· {submissionStatusText(a.status)}</span>
                  </span>
                  <span className="text-xs text-muted">
                    AI {a.ai_total ?? "–"} · final {a.final_score ?? "–"} · {formatDate(a.submitted_at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardBody>
    </Card>
  );
}
