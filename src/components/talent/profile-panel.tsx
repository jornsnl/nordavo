import type { ReactNode } from "react";
import { Check, Download, FileText, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import type { MatchWithCandidate } from "@/lib/data/matches";
import { formatDateTime } from "@/lib/format";
import {
  approveProfileAction,
  confirmConsentAction,
  generateProfileAction,
  markProfileSentAction,
} from "@/app/dashboard/vacatures/talent-actions";
import { ActionButton } from "./action-button";
import { ConsentForm } from "./consent-form";

function Step({ done, title, children }: { done: boolean; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-emerald-500 text-white" : "border-2 border-border bg-white"
        }`}
      >
        {done && <Check className="size-3" />}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className={`text-sm font-medium ${done ? "text-ink" : "text-muted"}`}>
          {title}
          <span className="sr-only">{done ? ", gedaan" : ", nog niet gedaan"}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

/** T4 and T5: anonymous profile preview, approval, consent and sending for one match. */
export function ProfilePanel({ vacancyId, match }: { vacancyId: string; match: MatchWithCandidate }) {
  const profile = match.profile;
  const content = profile?.content;
  const airtableConsent = match.candidate?.consent ?? null;
  const consentOk = Boolean(profile?.consentConfirmed) || airtableConsent === true;

  if (!profile) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-3">
        <p className="text-sm text-muted">
          Nog geen anoniem profiel. Claude schrijft het in Nordavo opmaak zonder naam, contactgegevens of werkgevers; een check in
          de code keurt het af als er toch iets herleidbaars in staat.
        </p>
        <ActionButton
          action={generateProfileAction.bind(null, vacancyId, match.id)}
          variant="primary"
          pendingLabel="Profiel wordt gemaakt"
          className="mt-3"
        >
          <FileText aria-hidden="true" />
          Anoniem profiel maken
        </ActionButton>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Anoniem profiel {content?.code}</p>
          <p className="font-display text-base font-semibold text-brand-900">{content?.headline ?? "Profiel"}</p>
          <p className="text-xs text-muted">
            Gemaakt {formatDateTime(profile.createdAt)}
            {match.profileCount > 1 ? `, versie ${match.profileCount}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {profile.fileUrl && (
            <ButtonLink href={`/dashboard/vacatures/${vacancyId}/profielen/${profile.id}`} variant="secondary" size="sm" prefetch={false}>
              <Download aria-hidden="true" />
              PDF
            </ButtonLink>
          )}
          {!profile.sentAt && (
            <ActionButton action={generateProfileAction.bind(null, vacancyId, match.id)} pendingLabel="Bezig" variant="ghost">
              <RefreshCw aria-hidden="true" />
              Opnieuw maken
            </ActionButton>
          )}
        </div>
      </div>

      {content && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-4">
            {[
              ["Niveau", content.seniority],
              ["Ervaring", content.years_experience === null ? "Onbekend" : `${content.years_experience} jaar`],
              ["Engels", content.english_level],
              ["Beschikbaar", content.availability],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <ul className="flex flex-wrap gap-1.5" aria-label="Kernskills">
            {content.core_skills.map((s, i) => (
              <li key={`${s}-${i}`}>
                <Badge tone="brand">{s}</Badge>
              </li>
            ))}
          </ul>
          {content.project_types.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 marker:text-accent-500">
              {content.project_types.map((p, i) => (
                <li key={`${p}-${i}`}>{p}</li>
              ))}
            </ul>
          )}
          {content.sectors.length > 0 && <p className="text-muted">Sectoren: {content.sectors.join(", ")}</p>}
          <div className="border-l-2 border-accent-500 pl-3">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Beoordeling door Nordavo</p>
            <p className="mt-1 leading-relaxed whitespace-pre-line text-ink">{content.assessment}</p>
          </div>
        </div>
      )}

      <ol className="space-y-3">
        <Step done={Boolean(profile.approvedAt)} title={profile.approvedAt ? `Goedgekeurd op ${formatDateTime(profile.approvedAt)}` : "Goedkeuren"}>
          {!profile.approvedAt && (
            <>
              <p className="text-xs text-muted">Floris of de recruiter leest het profiel na. Pas daarna mag het naar de klant.</p>
              <ActionButton action={approveProfileAction.bind(null, profile.id)} pendingLabel="Bezig">
                <ShieldCheck aria-hidden="true" />
                Profiel goedkeuren
              </ActionButton>
            </>
          )}
        </Step>
        <Step
          done={consentOk}
          title={
            consentOk
              ? content?.consent_source === "staff"
                ? "Toestemming bevestigd door het team"
                : "Toestemming gegeven (Airtable)"
              : "Toestemming van de kandidaat"
          }
        >
          {!consentOk && airtableConsent === false && (
            <p className="text-sm text-danger">In Airtable staat dat de kandidaat geen toestemming gaf. Dit profiel kan niet naar de klant.</p>
          )}
          {!consentOk && airtableConsent === null && (
            <>
              <p className="text-xs text-muted">
                Airtable heeft (nog) geen toestemmingsveld ingevuld voor deze kandidaat. Bevestig alleen als de kandidaat echt akkoord gaf.
              </p>
              <ConsentForm action={confirmConsentAction.bind(null, profile.id)} id={profile.id} />
            </>
          )}
        </Step>
        <Step done={Boolean(profile.sentAt)} title={profile.sentAt ? `Verstuurd op ${formatDateTime(profile.sentAt)}` : "Naar de klant"}>
          {!profile.sentAt && profile.approvedAt && consentOk && (
            <>
              <p className="text-xs text-muted">
                Stuur de PDF zelf naar de klant en markeer hem daarna als verstuurd. Is er een deal in OnePageCRM, dan komt er een notitie
                en een volgende actie bij.
              </p>
              <ActionButton action={markProfileSentAction.bind(null, profile.id)} variant="primary" pendingLabel="Bezig">
                <Send aria-hidden="true" />
                Markeer als verstuurd
              </ActionButton>
            </>
          )}
        </Step>
      </ol>
    </div>
  );
}
