import { Briefcase, Download, MapPin, PlayCircle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PortalCandidate } from "@/lib/data/portal";
import { isReviewable } from "@/lib/data/portal";
import { formatDate, formatDateTime } from "@/lib/format";
import { portalStageLabels } from "./labels";
import { ReviewForm } from "./review-form";
import { ScoreMeter } from "./score-meter";

export function CandidateCard({ item }: { item: PortalCandidate }) {
  const { candidate } = item;
  const stage = portalStageLabels[item.stage];
  const canChange = isReviewable(item.stage);
  const headingId = `candidate-${item.applicationId}`;

  return (
    <Card className="overflow-hidden">
      <article id={`kandidaat-${item.applicationId}`} aria-labelledby={headingId} className="scroll-mt-32">
        <header className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4">
          <Avatar name={candidate.fullName} />
          <div className="min-w-0 flex-1">
            <h3 id={headingId} className="font-display text-lg font-semibold text-brand-900">
              {candidate.fullName}
            </h3>
            <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {candidate.currentTitle && (
                <span className="inline-flex items-center gap-1.5">
                  <Briefcase className="size-3.5" aria-hidden="true" />
                  {candidate.currentTitle}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden="true" />
                {candidate.location}
              </span>
              {candidate.yearsExperience !== null && (
                <span>
                  {candidate.yearsExperience} jaar ervaring
                </span>
              )}
            </p>
          </div>
          {stage && <Badge tone={stage.tone}>{stage.label}</Badge>}
        </header>

        <div className="grid grid-cols-1 gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-4">
            {candidate.summary ? (
              <p className="text-sm leading-relaxed whitespace-pre-line text-ink">{candidate.summary}</p>
            ) : (
              <p className="text-sm text-muted">Nog geen samenvatting toegevoegd.</p>
            )}

            {candidate.skills.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Vaardigheden">
                {candidate.skills.map((skill) => (
                  <li key={skill}>
                    <Badge tone="brand">{skill}</Badge>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2">
              {candidate.videoUrl && (
                <a
                  href={candidate.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  <PlayCircle aria-hidden="true" />
                  Video intro bekijken
                  <span className="sr-only"> (opent in nieuw tabblad)</span>
                </a>
              )}
              {candidate.hasCv && (
                <a
                  href={`/portaal/cv/${item.applicationId}`}
                  target="_blank"
                  rel="noopener"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  <Download aria-hidden="true" />
                  CV downloaden
                  <span className="sr-only"> van {candidate.fullName} (opent in nieuw tabblad)</span>
                </a>
              )}
            </div>
            {item.presentedAt && (
              <p className="text-xs text-muted">Voorgesteld op {formatDate(item.presentedAt)}</p>
            )}
          </div>

          <div className="space-y-3 rounded-xl bg-surface p-4">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">Assessment</p>
            <ScoreMeter id={`tech-${item.applicationId}`} label="Technische test" value={item.technicalScore} />
            <ScoreMeter id={`eng-${item.applicationId}`} label="Engels" value={item.englishScore} />
          </div>
        </div>

        <div className="border-t border-border bg-white px-5 py-4">
          <ReviewForm
            applicationId={item.applicationId}
            candidateName={candidate.fullName}
            decision={item.decision}
            feedback={item.feedback}
            decidedAtLabel={item.decidedAt ? formatDateTime(item.decidedAt) : null}
            canChange={canChange}
          />
        </div>
      </article>
    </Card>
  );
}
