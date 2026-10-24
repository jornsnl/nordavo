import type { ReactNode } from "react";
import { Check, CircleAlert, Lock, Sparkles, UserCheck, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { hasClaude } from "@/lib/ai/claude";
import type { MatchStatus } from "@/lib/database.types";
import { listVacancyMatches, type MatchWithCandidate } from "@/lib/data/matches";
import { formatDateTime } from "@/lib/format";
import { hasAirtable } from "@/lib/integrations/airtable";
import { matchStatuses, optionFor } from "@/lib/labels";
import { runMatchingAction, setMatchStatusAction } from "@/app/dashboard/vacatures/talent-actions";
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
      buttons.push({ status: "goedgekeurd", label: "Match goedkeuren", icon: <Check aria-hidden="true" />, variant: "primary" });
      buttons.push({ status: "afgewezen", label: "Afwijzen", icon: <X aria-hidden="true" /> });
      break;
    case "goedgekeurd":
      buttons.push({ status: "afgewezen", label: "Afwijzen", icon: <X aria-hidden="true" /> });
      buttons.push({ status: "voorgesteld", label: "Goedkeuring intrekken", icon: null, variant: "ghost" });
      break;
    case "verstuurd":
      buttons.push({ status: "gesprek", label: "Markeer gesprek", icon: <Users aria-hidden="true" />, variant: "primary" });
      buttons.push({ status: "afgewezen", label: "Afgewezen door klant", icon: <X aria-hidden="true" /> });
      break;
    case "gesprek":
      buttons.push({ status: "aangenomen", label: "Aangenomen", icon: <UserCheck aria-hidden="true" />, variant: "primary" });
      buttons.push({ status: "afgewezen", label: "Afgewezen", icon: <X aria-hidden="true" /> });
      break;
    case "afgewezen":
      buttons.push({ status: "voorgesteld", label: "Terugzetten", icon: null, variant: "ghost" });
      break;
    default:
      break;
  }
  if (buttons.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {buttons.map((b) => (
        <ActionButton key={b.status} action={statusAction(match.id, b.status)} variant={b.variant ?? "secondary"} pendingLabel="Bezig">
          {b.icon}
          {b.label}
        </ActionButton>
      ))}
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
            <span className="font-display text-base font-semibold text-brand-900">{c ? c.name : "Kandidaat in Airtable"}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
            <Lock className="size-3" aria-hidden="true" />
            Alleen voor het team. Gegevens live uit Airtable, de klant ziet alleen het anonieme profiel.
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
              c.yearsExperience !== null ? `${c.yearsExperience} jaar ervaring` : null,
              c.englishLevel ? `Engels: ${c.englishLevel}` : null,
              c.availability ? `Beschikbaar: ${c.availability}` : null,
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
          {c.hasCvAttachment && !c.cvText && <p className="text-xs text-muted">Cv staat als bijlage in Airtable.</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">Kandidaatgegevens konden niet live uit Airtable worden gelezen.</p>
      )}

      {match.reason && <p className="text-sm leading-relaxed text-ink">{match.reason}</p>}
      {(match.risks.length > 0 || match.missing.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {match.risks.length > 0 && (
            <div>
              <h4 className="text-xs font-medium tracking-wide text-muted uppercase">Risico&apos;s</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink marker:text-amber-500">
                {match.risks.map((r, i) => (
                  <li key={`${r}-${i}`}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {match.missing.length > 0 && (
            <div>
              <h4 className="text-xs font-medium tracking-wide text-muted uppercase">Mist must haves</h4>
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
          Match goedgekeurd door {match.approverName ?? "een teamlid"} op {formatDateTime(match.approved_at)}.
        </p>
      )}

      <MatchActions match={match} />

      {WITH_PROFILE.includes(match.status) && <ProfilePanel vacancyId={vacancyId} match={match} />}
    </li>
  );
}

/** T2 matches for a vacancy, with live Airtable details for staff. */
export async function MatchesSection({ vacancyId, hasRequirements }: { vacancyId: string; hasRequirements: boolean }) {
  const { matches, airtableError } = await listVacancyMatches(vacancyId);
  const ready = hasAirtable() && hasClaude();
  const strong = matches.filter((m) => (m.score ?? 0) >= 70 && m.status !== "afgewezen").length;

  return (
    <Card>
      <CardHeader
        title="Matches uit de talentenpool"
        description={
          matches.length === 0
            ? "Nog geen matches. Claude scoort de beste kandidaten uit Airtable op de vaste eisen."
            : `${matches.length} matches, ${strong} met score 70 of hoger.`
        }
      />
      <CardBody className="space-y-4">
        {!ready && (
          <p className="flex gap-2 rounded-xl border border-amber-600/20 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Matchen kan pas als Airtable (AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_CANDIDATES_TABLE) en Claude (ANTHROPIC_API_KEY) gekoppeld zijn.
          </p>
        )}
        {ready && !hasRequirements && (
          <p className="text-sm text-muted">Vul eerst de vaste eisen in. Zonder stack of must haves valt er niets te matchen.</p>
        )}
        {ready && hasRequirements && (
          <ActionButton action={runMatchingAction.bind(null, vacancyId)} variant="primary" size="md" pendingLabel="Claude scoort de pool, dit duurt even">
            <Sparkles aria-hidden="true" />
            {matches.length > 0 ? "Opnieuw matchen" : "Matchen"}
          </ActionButton>
        )}
        {airtableError && (
          <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
            {airtableError}
          </p>
        )}
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
