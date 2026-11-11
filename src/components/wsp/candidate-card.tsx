import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CAUTION_BANNER } from "@/lib/wsp/content";
import { getCandidateWsp } from "@/lib/wsp/data";
import { formatWspDate } from "@/lib/wsp/text";
import { REASON_LABELS, STATUS_LABELS } from "@/lib/wsp/view";
import { WspPersonSettings, WspResendButton, WspSendButton } from "./staff-controls";
import { WspStaffSharing } from "./staff-sharing";

/**
 * Working Style Profile on the candidate page (also on the Academy person
 * page and the placement page for developers): the person setting, "Send
 * working style profile", the questionnaires with their status, and the
 * one general permission with who received the profile and sharing it. No
 * scores here: they are only in the report (open a questionnaire). Hidden
 * when the system setting is off or for people outside recruitment and the
 * Academy team.
 */
export async function WspCandidateCard({ candidateId, title = "Working style profile" }: { candidateId: string; title?: string }) {
  const wsp = await getCandidateWsp(candidateId);
  if (!wsp || !wsp.enabled) return null;
  const open = wsp.assessments.find((a) => (a.status === "invited" || a.status === "started") && !a.expired);
  return (
    <Card>
      <CardHeader title={title} description="Big Five questionnaire. Not a selection tool: never the only basis for a decision." />
      <CardBody className="space-y-5">
        <WspPersonSettings candidateId={candidateId} mode={wsp.mode} talentPool={Boolean(wsp.talentPoolConsentAt)} />

        {wsp.mode === "never" ? (
          <p className="rounded-xl bg-surface px-3 py-2 text-sm text-muted">Set to Never: no invitations, automatic or by hand.</p>
        ) : open ? (
          <p className="rounded-xl bg-surface px-3 py-2 text-sm text-muted">An invitation is open until {formatWspDate(open.expires_at)}.</p>
        ) : (
          <WspSendButton
            candidateId={candidateId}
            vacancies={wsp.vacancies.map((v) => ({ id: v.id, title: v.title, clientName: v.clientName }))}
            clients={wsp.clients}
          />
        )}

        {wsp.assessments.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {wsp.assessments.map((a) => (
              <li key={a.id} className="space-y-1.5 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.status === "completed" ? "success" : a.expired ? "warning" : a.status === "deleted" ? "neutral" : "brand"}>
                      {a.expired && a.status !== "expired" ? STATUS_LABELS.expired : STATUS_LABELS[a.status]}
                    </Badge>
                    {a.flagCount > 0 && (
                      <Badge tone="warning">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {CAUTION_BANNER}
                      </Badge>
                    )}
                    {a.person_type === "developer" && <Badge tone="neutral">Developer</Badge>}
                  </span>
                  {a.status !== "deleted" && (
                    <Link href={`/dashboard/candidates/${candidateId}/working-style/${a.id}`} className="font-medium text-brand-700 hover:underline">
                      Open
                    </Link>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {REASON_LABELS[a.invite_reason]} · invited {formatWspDate(a.invited_at)}
                  {a.invited_by ? "" : " by the system"}
                  {a.completed_at && ` · completed ${formatWspDate(a.completed_at)}`}
                  {a.status === "deleted" && " · deleted"}
                </p>
                {a.links.length > 0 && (
                  <p className="text-xs text-muted">
                    Linked: {a.links.map((l) => [l.vacancyTitle, l.clientName].filter(Boolean).join(" at ")).join(", ")}
                  </p>
                )}
                {(a.expired || a.status === "expired") && wsp.mode !== "never" && !open && (
                  <WspResendButton candidateId={candidateId} assessmentId={a.id} />
                )}
              </li>
            ))}
          </ul>
        )}

        {wsp.assessments.some((a) => a.status === "completed") && (
          <WspStaffSharing
            candidateId={candidateId}
            consent={wsp.consent}
            assessments={wsp.assessments.filter((a) => a.status === "completed").map((a) => ({ id: a.id, completedAt: a.completed_at }))}
            clients={wsp.clients}
          />
        )}
      </CardBody>
    </Card>
  );
}
