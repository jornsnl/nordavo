import type { ReactNode } from "react";
import Link from "next/link";
import { Check, Clock, KanbanSquare, Lock, Plus, Sparkles, UserCheck, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { hasClaude } from "@/lib/ai/claude";
import type { MatchStatus } from "@/lib/database.types";
import { getMatchRequestedAt, listVacancyMatches, type MatchWithCandidate } from "@/lib/data/matches";
import { formatDateTime } from "@/lib/format";
import { matchStatuses, optionFor } from "@/lib/labels";
import { addMatchToPipelineAction, runMatchingAction, setMatchStatusAction } from "@/app/dashboard/vacancies/talent-actions";
import { ActionButton } from "./action-button";
import { ProfilePanel } from "./profile-panel";
import { ScoreBar } from "./score-bar";

const WITH_PROFILE: MatchStatus[] = ["goedgekeurd", "verstuurd", "gesprek", "aangenomen"];

function statusAction(matchId: string, status: MatchStatus) {
  return setMatchStatusAction.bind(null, matchId, status);
}

function MatchActions({ match }: { match: MatchWithCandidate }) {
  const buttons: { status: MatchStatus; label: string; icon: ReactNode; variant?: "primary" | "secondary" | "ghost" }[] = [];
  switch (match.status) {
    case "voorgesteld":
      buttons.push({ status: "goedgekeurd", label: "Approve match", icon: <Check aria-hidden="true" />, variant: "primary" });
      buttons.push({ status: "afgewezen", label: "Reject", icon: <X aria-hidden="true" /> });
      break;
    case "goedgekeurd":
      buttons.push({ status: "afgewezen", label: "Reject", icon: <X aria-hidden="true" /> });
      buttons.push({ status: "voorgesteld", label: "Withdraw approval", icon: null, variant: "ghost" });
      break;
    case "verstuurd":
      buttons.push({ status: "gesprek", label: "Mark interview", icon: <Users aria-hidden="true" />, variant: "primary" });
      buttons.push({ status: "afgewezen", label: "Rejected by client", icon: <X aria-hidden="true" /> });
      break;
    case "gesprek":
      buttons.push({ status: "aangenomen", label: "Hired", icon: <UserCheck aria-hidden="true" />, variant: "primary" });
      buttons.push({ status: "afgewezen", label: "Rejected", icon: <X aria-hidden="true" /> });
      break;
    case "afgewezen":
      buttons.push({ status: "voorgesteld", label: "Restore", icon: null, variant: "ghost" });
      break;
    default:
      break;
  }
  const canAddToPipeline = match.status !== "afgewezen" && !match.application && match.candidate;
  if (buttons.length === 0 && !canAddToPipeline) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {buttons.map((b) => (
        <ActionButton key={b.status} action={statusAction(match.id, b.status)} variant={b.variant ?? "secondary"} pendingLabel="Working">
          {b.icon}
          {b.label}
        </ActionButton>
      ))}
      {canAddToPipeline && (
        <ActionButton action={addMatchToPipelineAction.bind(null, match.id)} pendingLabel="Adding">
          <Plus aria-hidden="true" />
          Add to pipeline
        </ActionButton>
      )}
    </div>
  );
}

function MatchCard({ vacancyId, match }: { vacancyId: string; match: MatchWithCandidate }) {
  const status = optionFor(matchStatuses, match.status);
  const c = match.candidate;
  return (
    <li className="space-y-4 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            {c ? (
              <Link
                href={`/dashboard/candidates/${c.id}`}
                className="font-display text-base font-semibold text-brand-900 hover:text-brand-700 hover:underline"
              >
                {c.name}
              </Link>
            ) : (
              <span className="font-display text-base font-semibold text-brand-900">Unknown candidate</span>
            )}
            <Badge tone={status.tone}>{status.label}</Badge>
            {match.application && <Badge tone="accent">In pipeline</Badge>}
          </p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
            <Lock className="size-3" aria-hidden="true" />
            Team only. The client only sees the anonymous profile.
          </p>
        </div>
        <ScoreBar score={match.score} />
      </div>

      {c ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted">
            {[
              c.currentTitle,
              c.seniority,
              c.yearsExperience !== null ? `${c.yearsExperience} years of experience` : null,
              c.englishLevel ? `English: ${c.englishLevel}` : null,
              c.availability ? `Available: ${c.availability}` : null,
              c.location,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {c.skills.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
              {c.skills.slice(0, 14).map((s, i) => (
                <li key={`${s}-${i}`}>
                  <Badge>{s}</Badge>
                </li>
              ))}
              {c.skills.length > 14 && <li className="text-xs text-muted">+{c.skills.length - 14}</li>}
            </ul>
          )}
          {c.hasCvAttachment && !c.cvText && (
            <p className="text-xs text-muted">
              A CV file is uploaded but has no text version, so matching used the profile fields only.{" "}
              <Link href={`/dashboard/candidates/${c.id}/edit`} className="text-brand-700 hover:underline">
                Add the CV text
              </Link>
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">The candidate details could not be loaded.</p>
      )}

      {match.reason && <p className="text-sm leading-relaxed text-ink">{match.reason}</p>}
      {(match.risks.length > 0 || match.missing.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {match.risks.length > 0 && (
            <div>
              <h4 className="text-xs font-medium tracking-wide text-muted uppercase">Risks</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink marker:text-amber-500">
                {match.risks.map((r, i) => (
                  <li key={`${r}-${i}`}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {match.missing.length > 0 && (
            <div>
              <h4 className="text-xs font-medium tracking-wide text-muted uppercase">Missing must haves</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink marker:text-danger">
                {match.missing.map((m, i) => (
                  <li key={`${m}-${i}`}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {match.approved_at && match.status !== "voorgesteld" && match.status !== "afgewezen" && (
        <p className="text-xs text-muted">
          Match approved by {match.approverName ?? "a team member"} on {formatDateTime(match.approved_at)}.
        </p>
      )}

      <MatchActions match={match} />

      {match.application && (
        <ButtonLink
          href={`/dashboard/vacancies/${vacancyId}/pipeline?application=${match.application.id}`}
          variant="ghost"
          size="sm"
        >
          <KanbanSquare aria-hidden="true" />
          Open in pipeline
        </ButtonLink>
      )}

      {WITH_PROFILE.includes(match.status) && <ProfilePanel vacancyId={vacancyId} match={match} />}
    </li>
  );
}

/** T2 matches for a vacancy: the shortlist of portal candidates. */
export async function MatchesSection({ vacancyId, hasRequirements }: { vacancyId: string; hasRequirements: boolean }) {
  const matches = await listVacancyMatches(vacancyId);
  // With an API key the portal matches inline; without one Claude does it through the MCP.
  const inline = hasClaude();
  const requestedAt = await getMatchRequestedAt(vacancyId);
  const strong = matches.filter((m) => (m.score ?? 0) >= 70 && m.status !== "afgewezen").length;

  return (
    <Card>
      <CardHeader
        title="Matches from the talent pool"
        description={
          matches.length === 0
            ? "No matches yet. Claude scores the best candidates in the portal against the fixed requirements."
            : `${matches.length} matches, ${strong} with a score of 70 or higher.`
        }
      />
      <CardBody className="space-y-4">
        {!hasRequirements && (
          <p className="text-sm text-muted">Fill in the fixed requirements first. Without a stack or must haves there is nothing to match on.</p>
        )}
        {hasRequirements && requestedAt && (
          <p className="flex gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900" role="status">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Waiting for Claude since {formatDateTime(requestedAt)}. Its scheduled task claude-match scores the pool and saves the
            matches here.
          </p>
        )}
        {hasRequirements && (
          <ActionButton
            action={runMatchingAction.bind(null, vacancyId)}
            variant="primary"
            size="md"
            pendingLabel={inline ? "Claude is scoring the pool, this takes a moment" : "Queueing"}
          >
            <Sparkles aria-hidden="true" />
            {inline ? (matches.length > 0 ? "Match again" : "Match") : matches.length > 0 ? "Ask Claude to match again" : "Ask Claude to match"}
          </ActionButton>
        )}
        <p className="text-xs text-muted">
          The pool is every candidate in the portal with status available or in process, except candidates already in this
          vacancy&apos;s pipeline and rejected matches.
        </p>
        {matches.length > 0 && (
          <ul className="space-y-4">
            {matches.map((m) => (
              <MatchCard key={m.id} vacancyId={vacancyId} match={m} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
