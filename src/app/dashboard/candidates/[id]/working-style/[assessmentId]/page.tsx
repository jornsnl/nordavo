import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { WspReportView } from "@/components/wsp/report-view";
import {
  WspAskPermissionButton,
  WspDeleteAssessmentButton,
  WspLinkForm,
  WspResendButton,
  WspSendButton,
} from "@/components/wsp/staff-controls";
import { requireStaff } from "@/lib/auth";
import { ANSWER_OPTIONS, CAUTION_BANNER } from "@/lib/wsp/content";
import { getStaffAssessment } from "@/lib/wsp/data";
import { flagReason } from "@/lib/wsp/scoring";
import { SHARE_STATUS_LABELS, formatWspDate } from "@/lib/wsp/text";
import { REASON_LABELS, STATUS_LABELS } from "@/lib/wsp/view";

export const metadata: Metadata = { title: "Working style profile" };

/**
 * Staff view of one questionnaire: the report with the client intro, the
 * quality flags ("Interpret with caution" with the reason and a button to
 * send the test again), the permission per linked client (staff can only
 * ask), the raw answers, the time per page and the audit log.
 */
export default function Page({ params }: PageProps<"/dashboard/candidates/[id]/working-style/[assessmentId]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: Promise<{ id: string; assessmentId: string }> }) {
  const { id, assessmentId } = await params;
  await requireStaff();
  if (!/^[0-9a-f-]{36}$/.test(assessmentId)) notFound();
  const data = await getStaffAssessment(assessmentId);
  if (!data || data.candidate.id !== id) notFound();
  const { assessment, candidate, report, flags, answers, audit, clients, expired } = data;
  const open = assessment.status === "invited" || assessment.status === "started";
  const label = (value: number | null) => ANSWER_OPTIONS.find((o) => o.value === value)?.label ?? "No answer";
  const pageTimes = new Map<number, number>();
  for (const a of answers) if (a.pageMs !== null) pageTimes.set(a.page, Math.max(pageTimes.get(a.page) ?? 0, a.pageMs));

  return (
    <>
      <Link href={`/dashboard/candidates/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {candidate.full_name}
      </Link>
      <PageHeader
        eyebrow="Working style profile"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {candidate.full_name}
            <Badge tone={assessment.status === "completed" ? "success" : expired ? "warning" : "brand"}>
              {expired ? STATUS_LABELS.expired : STATUS_LABELS[assessment.status]}
            </Badge>
          </span>
        }
        description={`${REASON_LABELS[assessment.invite_reason]}, invited ${formatWspDate(assessment.invited_at)}${assessment.invited_by ? "" : " by the system"}${assessment.completed_at ? `, completed ${formatWspDate(assessment.completed_at)}` : ""}. Instrument ${assessment.instrument_version}.`}
        actions={
          <>
            {(open || expired) && <WspResendButton candidateId={id} assessmentId={assessment.id} label={expired ? "Send again" : "Resend the link"} />}
            <WspDeleteAssessmentButton candidateId={id} assessmentId={assessment.id} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {report ? (
            <WspReportView
              report={report}
              audience="staff"
              pdfHref={`/dashboard/candidates/${id}/working-style/${assessment.id}/pdf`}
              beforeBlocks={
                flags.length > 0 ? (
                  <section role="alert" className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4">
                    <h2 className="flex items-center gap-2 font-display text-base font-semibold text-amber-900">
                      <AlertTriangle className="size-5" aria-hidden="true" />
                      {CAUTION_BANNER}
                    </h2>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                      {flags.map((f) => (
                        <li key={f.flag_type}>{flagReason({ type: f.flag_type, details: f.details })}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-amber-900">Only the Nordavo team sees this; it is not in the report of the person or the client, nor in the PDF.</p>
                    <WspSendButton candidateId={id} vacancies={[]} clients={clients} label="Send the test again" />
                  </section>
                ) : null
              }
            />
          ) : (
            <Card>
              <CardBody>
                <p className="text-sm text-muted">
                  {expired
                    ? "The link expired before the questionnaire was finished. Send it again: the answers given so far are kept."
                    : `Not completed yet. ${answers.filter((a) => a.answer !== null).length} of ${answers.length} statements answered. The link works until ${formatWspDate(assessment.expires_at)}.`}
                </p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Raw answers" description="Staff only. Never shown to clients, also not in the PDF." />
            <CardBody className="overflow-x-auto p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>#</TH>
                    <TH>Statement</TH>
                    <TH>Dim</TH>
                    <TH>Answer</TH>
                  </TR>
                </THead>
                <TBody>
                  {answers.map((a) => (
                    <TR key={a.code}>
                      <TD className="tabular-nums">{a.position}</TD>
                      <TD>
                        {a.statement}
                        <span className="ml-1 text-xs text-muted">
                          {a.code}
                          {a.key === "reversed" ? ", reversed" : ""}
                        </span>
                      </TD>
                      <TD>{a.dimension}</TD>
                      <TD>{a.answer ? `${a.answer} ${label(a.answer)}` : <span className="text-muted">No answer</span>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Sharing per client" description="Only the person can share or withdraw, from their own account. You can ask, at most once per client per 7 days." />
            <CardBody className="space-y-4">
              {report && report.clients.length > 0 ? (
                <ul className="space-y-3">
                  {report.clients.map((c) => (
                    <li key={c.clientId} className="space-y-1 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">{c.name}</span>
                        <Badge tone={c.status === "shared" ? "success" : c.status === "withdrawn" ? "warning" : "neutral"}>{SHARE_STATUS_LABELS[c.status]}</Badge>
                      </div>
                      <p className="text-xs text-muted">
                        {c.consentedAt && `Shared since ${formatWspDate(c.consentedAt)}. `}
                        {c.status === "withdrawn" && c.revokedAt && `Withdrawn on ${formatWspDate(c.revokedAt)}. `}
                        {c.requestedAt && `Last asked ${formatWspDate(c.requestedAt)}.`}
                      </p>
                      {c.status !== "shared" && <WspAskPermissionButton candidateId={id} assessmentId={assessment.id} clientId={c.clientId} />}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{report ? "No client linked yet." : "Sharing is possible once the questionnaire is completed."}</p>
              )}
              <WspLinkForm candidateId={id} assessmentId={assessment.id} clients={clients} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Time per page" />
            <CardBody>
              <ul className="space-y-1 text-sm">
                {[...pageTimes.entries()].sort((a, b) => a[0] - b[0]).map(([page, ms]) => (
                  <li key={page} className="flex justify-between">
                    <span className="text-muted">Page {page}</span>
                    <span className="tabular-nums">{Math.round(ms / 1000)} s</span>
                  </li>
                ))}
                {pageTimes.size === 0 && <li className="text-muted">Nothing yet.</li>}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Audit log" description="Invitations, links, views and downloads by clients, every share action and download." />
            <CardBody>
              <ul className="space-y-2 text-sm">
                {audit.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium text-ink">{a.action.replace(/_/g, " ")}</span>
                    <span className="text-muted">
                      {" "}
                      by {a.actorName ?? (a.actor_role === "person_link" ? "the person (personal link)" : a.actor_role)} ({a.actor_role}), {formatWspDate(a.created_at)}
                    </span>
                  </li>
                ))}
                {audit.length === 0 && <li className="text-muted">Nothing yet.</li>}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
