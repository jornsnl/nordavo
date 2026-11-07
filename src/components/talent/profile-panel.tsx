import type { ReactNode } from "react";
import Link from "next/link";
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
} from "@/app/dashboard/vacancies/talent-actions";
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
          <span className="sr-only">{done ? ", done" : ", not done yet"}</span>
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
  const candidateConsent = match.candidate?.consent ?? null;
  const consentOk = Boolean(profile?.consentConfirmed) || candidateConsent === true;
  const candidateHref = match.candidate ? `/dashboard/candidates/${match.candidate.id}/edit` : null;

  if (!profile) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-3">
        <p className="text-sm text-muted">
          No anonymous profile yet. Claude writes it in the Nordavo format without name, contact details or employers; a check in
          the code rejects it if anything identifying is still in it.
        </p>
        <ActionButton
          action={generateProfileAction.bind(null, vacancyId, match.id)}
          variant="primary"
          pendingLabel="Making the profile"
          className="mt-3"
        >
          <FileText aria-hidden="true" />
          Make anonymous profile
        </ActionButton>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Anonymous profile {content?.code}</p>
          <p className="font-display text-base font-semibold text-brand-900">{content?.headline ?? "Profile"}</p>
          <p className="text-xs text-muted">
            Made {formatDateTime(profile.createdAt)}
            {match.profileCount > 1 ? `, version ${match.profileCount}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {profile.fileUrl && (
            <ButtonLink href={`/dashboard/vacancies/${vacancyId}/profiles/${profile.id}`} variant="secondary" size="sm" prefetch={false}>
              <Download aria-hidden="true" />
              PDF
            </ButtonLink>
          )}
          {!profile.sentAt && (
            <ActionButton action={generateProfileAction.bind(null, vacancyId, match.id)} pendingLabel="Working" variant="ghost">
              <RefreshCw aria-hidden="true" />
              Make again
            </ActionButton>
          )}
        </div>
      </div>

      {content && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Level", content.seniority],
              ["Experience", content.years_experience === null ? "Unknown" : `${content.years_experience} years`],
              ["English", content.english_level],
              ["Available", content.availability],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <ul className="flex flex-wrap gap-1.5" aria-label="Core skills">
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
          {content.sectors.length > 0 && <p className="text-muted">Sectors: {content.sectors.join(", ")}</p>}
          <div className="border-l-2 border-accent-500 pl-3">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Assessment by Nordavo</p>
            <p className="mt-1 leading-relaxed whitespace-pre-line text-ink">{content.assessment}</p>
          </div>
        </div>
      )}

      <ol className="space-y-3">
        <Step done={Boolean(profile.approvedAt)} title={profile.approvedAt ? `Approved on ${formatDateTime(profile.approvedAt)}` : "Approve"}>
          {!profile.approvedAt && (
            <>
              <p className="text-xs text-muted">Floris or the recruiter reviews the profile. Only then may it go to the client.</p>
              <ActionButton action={approveProfileAction.bind(null, profile.id)} pendingLabel="Working">
                <ShieldCheck aria-hidden="true" />
                Approve profile
              </ActionButton>
            </>
          )}
        </Step>
        <Step
          done={consentOk}
          title={
            consentOk
              ? content?.consent_source === "staff"
                ? "Consent confirmed by the team"
                : "Consent given (candidate profile)"
              : "Candidate consent"
          }
        >
          {!consentOk && candidateConsent === false && (
            <p className="text-sm text-danger">
              The candidate&apos;s profile says they did not give consent. This profile cannot go to the client.
              {candidateHref && (
                <>
                  {" "}
                  <Link href={candidateHref} className="font-medium underline">
                    Edit the candidate
                  </Link>
                </>
              )}
            </p>
          )}
          {!consentOk && candidateConsent === null && (
            <>
              <p className="text-xs text-muted">
                Consent is not filled in on the candidate yet. Only confirm if the candidate really agreed; you can also set it on the
                candidate&apos;s page.
              </p>
              <ConsentForm action={confirmConsentAction.bind(null, profile.id)} id={profile.id} />
            </>
          )}
        </Step>
        <Step done={Boolean(profile.sentAt)} title={profile.sentAt ? `Sent on ${formatDateTime(profile.sentAt)}` : "To the client"}>
          {!profile.sentAt && profile.approvedAt && consentOk && (
            <>
              <p className="text-xs text-muted">
                Send the PDF to the client yourself, then mark it as sent. If there is a deal in OnePageCRM, a note and a next action
                are added.
              </p>
              <ActionButton action={markProfileSentAction.bind(null, profile.id)} variant="primary" pendingLabel="Working">
                <Send aria-hidden="true" />
                Mark as sent
              </ActionButton>
            </>
          )}
        </Step>
      </ol>
    </div>
  );
}
