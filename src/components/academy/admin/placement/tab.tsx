import Link from "next/link";
import { CalendarDays, ExternalLink, FileText, HeartPulse, Palmtree, Repeat, Settings2, TriangleAlert, Users } from "lucide-react";
import type { AcademyPlacementRole, AcademyRitualRow } from "@/lib/academy/database";
import { getPlacementAdmin, type PulseRow } from "@/lib/academy/placement/data";
import { leaveSummary, OPEN_LEAVE } from "@/lib/academy/placement/leave";
import { pulseSeries, type PulseSeries } from "@/lib/academy/placement/pulse";
import { ritualConsistency, type RitualLike } from "@/lib/academy/placement/rituals";
import { milestoneState, parseReviewAnswers } from "@/lib/academy/placement/timeline";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { ConsistencyGrid } from "@/components/academy/placement/sections";
import { PlacementOpenTasks } from "@/components/academy/placement/open-tasks";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  AddMemberForm,
  BalanceForm,
  DOCUMENT_CATEGORY_LABELS,
  DocumentActions,
  DocumentUploadForm,
  FactsForm,
  HandleSignal,
  LeaveDecision,
  MakeDeveloperButton,
  MemberRow,
  MilestoneDate,
  PlacementRitualButtons,
  PlacementRitualForm,
  ReportEditor,
  ROLE_LABELS,
  RotateCalendarButton,
} from "./forms";

// The Academy tab of /dashboard/placements/[id] (Nordavo): members of the
// triangle, the agreements, rituals, pulse (only here), timeline with forms
// and reports, leave, documents and the calendar link.

const MILESTONE_LABELS: Record<string, string> = { day_1: "Day 1", week_1: "Week 1", day_30: "30 days", day_90: "Review after 90 days" };
const LEAVE_LABELS: Record<string, string> = {
  requested: "Requested",
  client_agreed: "Discussed with client",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
const LEAVE_TONES = { requested: "brand", client_agreed: "warning", approved: "success", rejected: "danger", cancelled: "neutral" } as const;
const CADENCE = { daily: "Every working day", weekly: "Weekly", monthly: "Monthly" } as const;
const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export async function PlacementAcademyTab({ placementId }: { placementId: string }) {
  const data = await getPlacementAdmin(placementId);
  if (!data) return <p className="text-sm text-muted">This placement is not available in the Academy.</p>;
  const { placement, people, today } = data;
  const developer = people.find((p) => p.role === "developer") ?? null;
  const year = Number(today.slice(0, 4));
  const consistency = ritualConsistency(
    data.rituals.filter((r) => r.active) as RitualLike[],
    data.logs,
    { startDate: placement.start_date, today, weeks: 10 },
  );
  const calendarUrl = data.calendarToken ? `${env.siteUrl()}/api/academy/calendar/${data.calendarToken}.ics` : null;
  const openSignals = data.pulses.filter((p) => p.answer?.flagged && !p.answer.handled_at);
  const series = pulseSeries(
    data.pulses.map((p) => ({
      profile_id: p.profile_id,
      name: data.authors[p.profile_id] ?? "—",
      role: people.find((x) => x.profile_id === p.profile_id)?.role ?? "",
      period_start: p.period_start,
      score: p.answer?.score ?? null,
      flagged: p.answer?.flagged ?? false,
    })),
  );
  const candidateNotYetDeveloper =
    !developer && data.candidateMember && data.candidateMember.academy_role === "candidate" ? data.candidateMember : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
        <p className="text-muted">
          What the client contacts and the developer see on their placement page, without rates or costs. The pulse is only visible here.
        </p>
        <Link href={`/academy/placements/${placement.id}`} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
          Open the placement page
          <ExternalLink className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {openSignals.length > 0 && (
        <div role="status" className="rounded-2xl border border-danger/30 bg-danger-bg p-4">
          <p className="flex items-center gap-2 font-semibold text-danger">
            <TriangleAlert className="size-4" aria-hidden="true" />
            {openSignals.length === 1 ? "A pulse signal to follow up" : `${openSignals.length} pulse signals to follow up`}
          </p>
          <ul className="mt-2 space-y-3">
            {openSignals.map((p) => (
              <SignalItem key={p.id} pulse={p} name={data.authors[p.profile_id] ?? "—"} />
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Users className="size-4" aria-hidden="true" />The triangle</span>} description="Client contacts and the developer of this placement. Only they (and Nordavo) see the placement page." />
            <CardBody className="space-y-4">
              {people.length === 0 ? (
                <p className="text-sm text-muted">Nobody yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {people.map((p) => (
                    <MemberRow key={p.profile_id} placementId={placement.id} profileId={p.profile_id} name={p.full_name ?? p.email ?? "—"} email={p.email} role={p.role as AcademyPlacementRole} />
                  ))}
                </ul>
              )}
              {candidateNotYetDeveloper && (
                <div className="rounded-xl bg-surface p-3 text-sm">
                  <p className="mb-2 text-muted">{candidateNotYetDeveloper.full_name} is the candidate of this placement and still a candidate in the Academy.</p>
                  <MakeDeveloperButton placementId={placement.id} profileId={candidateNotYetDeveloper.profile_id} name={candidateNotYetDeveloper.full_name ?? "the candidate"} />
                </div>
              )}
              <AddMemberForm placementId={placement.id} options={data.options} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><HeartPulse className="size-4" aria-hidden="true" />Pulse</span>} description="Every two weeks: score 1 to 10, what goes well, what chafes. Only Nordavo sees this." />
            <CardBody>
              {series.length === 0 ? (
                <p className="text-sm text-muted">The first pulse goes out on day 14.</p>
              ) : (
                <div className="space-y-5">
                  {series.map((s) => (
                    <PulseTrend key={s.profileId} series={s} pulses={data.pulses.filter((p) => p.profile_id === s.profileId)} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Repeat className="size-4" aria-hidden="true" />Rituals</span>} description="Copied from the course rituals (Academy, Rituals). A change here only applies to this placement." />
            <CardBody className="space-y-5">
              <ConsistencyGrid consistency={consistency} rituals={data.rituals as RitualLike[]} locale="en" />
              <ul className="divide-y divide-border">
                {data.rituals.map((r) => (
                  <RitualAdminRow key={r.id} placementId={placement.id} ritual={r} />
                ))}
              </ul>
              <details className="rounded-xl border border-border">
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-brand-700">Add a ritual for this placement</summary>
                <div className="border-t border-border p-4">
                  <PlacementRitualForm placementId={placement.id} ritual={null} />
                </div>
              </details>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><CalendarDays className="size-4" aria-hidden="true" />Timeline</span>} description="Made from the start date. The client contacts and the developer fill in a form; you write the report." />
            <CardBody>
              <ol className="space-y-6">
                {data.milestones.map((m) => {
                  const reviews = data.reviews.filter((r) => r.milestone_id === m.id);
                  const forms = reviews.filter((r) => r.kind === "form");
                  const report = reviews.find((r) => r.kind === "report") ?? null;
                  const state = milestoneState(m, today);
                  return (
                    <li key={m.id} className="space-y-3 border-b border-border pb-6 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="font-semibold text-brand-900">{MILESTONE_LABELS[m.kind] ?? m.title}</h3>
                        <Badge tone={state === "done" ? "success" : state === "overdue" ? "danger" : state === "due" ? "warning" : "neutral"}>{state}</Badge>
                        <MilestoneDate placementId={placement.id} milestoneId={m.id} dueDate={m.due_date} />
                      </div>
                      {forms.length === 0 ? (
                        <p className="text-sm text-muted">No forms yet.</p>
                      ) : (
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {forms.map((f) => {
                            const a = parseReviewAnswers(f.answers);
                            return (
                              <li key={f.id} className="rounded-xl bg-surface p-3 text-sm">
                                <p className="font-medium text-brand-900">
                                  {data.authors[f.author_id ?? ""] ?? "—"} {a.rating && <span className="text-accent-600">{a.rating}/5</span>}{" "}
                                  {f.status === "draft" && <Badge>draft</Badge>}
                                </p>
                                {a.going_well && <p className="mt-1"><span className="text-muted">Goes well: </span>{a.going_well}</p>}
                                {a.improve && <p className="mt-1"><span className="text-muted">Could be better: </span>{a.improve}</p>}
                                {a.support && <p className="mt-1"><span className="text-muted">Needs from Nordavo: </span>{a.support}</p>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <ReportEditor placementId={placement.id} milestoneId={m.id} initial={report?.report ?? ""} published={report?.status === "submitted"} />
                    </li>
                  );
                })}
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Palmtree className="size-4" aria-hidden="true" />Leave</span>} description="The developer asks; you check with the client and decide. All three see the status." />
            <CardBody className="space-y-5">
              {developer ? (
                (() => {
                  const balance = data.balances.find((b) => b.year === year && b.profile_id === developer.profile_id) ?? null;
                  const summary = leaveSummary(balance, data.leave.filter((l) => l.profile_id === developer.profile_id), year);
                  return (
                    <>
                      {summary.hasBalance && (
                        <p className="text-sm">
                          {year}: {summary.total} days, {summary.used} taken, {summary.pending} pending, <strong>{summary.remaining} left</strong>.
                        </p>
                      )}
                      <BalanceForm placementId={placement.id} developerId={developer.profile_id} year={year} values={balance} />
                    </>
                  );
                })()
              ) : (
                <p className="text-sm text-muted">Add the developer to set the leave balance.</p>
              )}
              <ul className="divide-y divide-border">
                {data.leave.length === 0 && <li className="text-sm text-muted">No requests yet.</li>}
                {data.leave.map((l) => (
                  <li key={l.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={LEAVE_TONES[l.status]}>{LEAVE_LABELS[l.status]}</Badge>
                      <span className="text-sm font-medium text-brand-900">
                        {formatDate(l.start_date)} to {formatDate(l.end_date)} · {l.days ?? "?"} days · {l.kind}
                      </span>
                    </div>
                    {l.note && <p className="mt-1 text-sm text-muted">{l.note}</p>}
                    {(OPEN_LEAVE.includes(l.status) || l.status === "approved" || l.status === "rejected") && <LeaveDecision placementId={placement.id} request={l} />}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <PlacementOpenTasks placementId={placement.id} userId={null} locale="en" timeZone="Europe/Amsterdam" />
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Settings2 className="size-4" aria-hidden="true" />Agreements</span>} />
            <CardBody>
              <FactsForm
                placementId={placement.id}
                team={data.team}
                values={{
                  hours_per_week: placement.hours_per_week,
                  overlap_start: placement.overlap_start,
                  overlap_end: placement.overlap_end,
                  overlap_time_zone: placement.overlap_time_zone,
                  probation_end_date: placement.probation_end_date,
                  nordavo_contact_id: placement.nordavo_contact_id,
                  nordavo_response_hours: placement.nordavo_response_hours,
                }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><FileText className="size-4" aria-hidden="true" />Documents</span>} description='A new version is labelled "new" for two weeks.' />
            <CardBody className="space-y-4">
              <ul className="divide-y divide-border">
                {data.documents.length === 0 && <li className="text-sm text-muted">No documents yet.</li>}
                {data.documents.map((d) => (
                  <li key={d.id} className="space-y-1 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-brand-900">
                          {d.current_version > 0 ? (
                            <Link href={`/academy/placements/${placement.id}/documents/${d.id}`} prefetch={false} className="hover:underline">
                              {d.title}
                            </Link>
                          ) : (
                            d.title
                          )}{" "}
                          {d.isNew && <Badge tone="accent">new</Badge>}
                        </p>
                        <p className="text-xs text-muted">
                          {DOCUMENT_CATEGORY_LABELS[d.category as keyof typeof DOCUMENT_CATEGORY_LABELS] ?? d.category} · v{d.current_version}
                          {d.scope === "global" ? " · every placement" : ""}
                        </p>
                      </div>
                    </div>
                    <DocumentActions placementId={placement.id} documentId={d.id} title={d.title} category={d.category} scope={d.scope} />
                  </li>
                ))}
              </ul>
              <details className="rounded-xl border border-border">
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-brand-700">Upload a document</summary>
                <div className="border-t border-border p-4">
                  <DocumentUploadForm placementId={placement.id} />
                </div>
              </details>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Calendar link" description="Holidays NL and India (Karnataka), the timeline and approved leave, for calendar apps. Members see it on the placement page." />
            <CardBody className="space-y-3">
              {calendarUrl && <p className="break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs">{calendarUrl}</p>}
              <RotateCalendarButton placementId={placement.id} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}


function RitualAdminRow({ placementId, ritual }: { placementId: string; ritual: AcademyRitualRow }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-medium ${ritual.active ? "text-brand-900" : "text-muted line-through"}`}>{ritual.title}</p>
          <p className="text-xs text-muted">
            {CADENCE[ritual.cadence]}
            {ritual.cadence === "weekly" && ritual.weekday ? ` on ${WEEKDAY[ritual.weekday]}` : ""} · {ritual.audience}
            {ritual.template_id ? (ritual.customized ? " · adjusted for this placement" : " · follows the course") : " · own ritual"}
          </p>
        </div>
        <PlacementRitualButtons placementId={placementId} ritual={ritual} />
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-brand-700">Change</summary>
        <div className="mt-3">
          <PlacementRitualForm placementId={placementId} ritual={ritual} />
        </div>
      </details>
    </li>
  );
}

function SignalItem({ pulse, name }: { pulse: PulseRow; name: string }) {
  const a = pulse.answer!;
  return (
    <li className="text-sm">
      <p>
        <strong>{name}</strong>: {a.score}/10
        {a.flag_reason === "drop" && a.previous_score !== null ? ` (was ${a.previous_score})` : ""} · {formatDate(pulse.period_start)}
      </p>
      {a.friction && <p className="text-ink">Chafes: {a.friction}</p>}
      <HandleSignal pulseId={pulse.id} />
    </li>
  );
}

/** Score per round as a small line chart (1 to 10), with the answers below. */
function PulseTrend({ series, pulses }: { series: PulseSeries; pulses: PulseRow[] }) {
  const points = series.points;
  const width = 280;
  const height = 72;
  const pad = 8;
  const x = (i: number) => (points.length <= 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (points.length - 1));
  const y = (score: number) => pad + ((10 - score) * (height - 2 * pad)) / 9;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-brand-900">
          {series.name} <span className="text-xs font-normal text-muted">{ROLE_LABELS[series.role as AcademyPlacementRole] ?? series.role}</span>
        </p>
        <p className="text-xs text-muted">
          {series.latest !== null ? (
            <>
              latest <strong className={series.latest <= 5 ? "text-danger" : "text-ink"}>{series.latest}</strong>
              {series.change !== null && ` (${series.change > 0 ? "+" : ""}${series.change})`} · average {series.average}
            </>
          ) : (
            "no answers yet"
          )}
        </p>
      </div>
      {points.length > 0 && (
        <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-20 w-full max-w-sm" role="img" aria-label={`Pulse of ${series.name}: ${points.map((p) => p.score).join(", ")}`}>
          <line x1={pad} x2={width - pad} y1={y(5.5)} y2={y(5.5)} className="stroke-danger/30" strokeDasharray="3 3" />
          <path d={path} fill="none" className="stroke-brand-600" strokeWidth={2} strokeLinejoin="round" />
          {points.map((p, i) => (
            <circle key={p.periodStart} cx={x(i)} cy={y(p.score)} r={3.5} className={p.flagged ? "fill-danger" : "fill-brand-600"}>
              <title>{`${formatDate(p.periodStart)}: ${p.score}`}</title>
            </circle>
          ))}
        </svg>
      )}
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-brand-700">Answers</summary>
        <ul className="mt-2 space-y-2 text-sm">
          {[...pulses].reverse().map((p) => (
            <li key={p.id} className="rounded-lg bg-surface p-2">
              <p className="text-xs text-muted">
                {formatDate(p.period_start)} · {p.answer ? `${p.answer.score}/10` : p.answered_at ? "answered" : "open"}
                {p.answer?.handled_at && ` · followed up${p.answer.handled_note ? `: ${p.answer.handled_note}` : ""}`}
              </p>
              {p.answer?.going_well && <p><span className="text-muted">Goes well: </span>{p.answer.going_well}</p>}
              {p.answer?.friction && <p><span className="text-muted">Chafes: </span>{p.answer.friction}</p>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
