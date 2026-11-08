import { FileUp, ListOrdered, Sheet, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getSourceCounts } from "@/lib/data/screening";
import { candidateOrigins, candidateSources, optionFor } from "@/lib/labels";

/**
 * Vacancy page card for screening (2.6.3): applicants per source and per
 * origin, and the way into import, CV upload, techstack check and ranking.
 */
export async function ScreeningCard({ vacancyId }: { vacancyId: string }) {
  const counts = await getSourceCounts(vacancyId);
  const base = `/dashboard/vacancies/${vacancyId}`;
  return (
    <Card>
      <CardHeader
        title="Applicants and screening"
        description={
          counts.total === 0
            ? "No applicants yet. Import an export or upload CVs."
            : `${counts.total} ${counts.total === 1 ? "applicant" : "applicants"} in this vacancy.`
        }
      />
      <CardBody className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`${base}/import`} variant="secondary" size="sm">
            <Sheet aria-hidden="true" />
            Import candidates
          </ButtonLink>
          <ButtonLink href={`${base}/cvs`} variant="secondary" size="sm">
            <FileUp aria-hidden="true" />
            Upload CVs
          </ButtonLink>
          <ButtonLink href={`${base}/techstack`} variant="secondary" size="sm">
            <Filter aria-hidden="true" />
            Techstack check
          </ButtonLink>
          <ButtonLink href={`${base}/ranking`} variant="secondary" size="sm">
            <ListOrdered aria-hidden="true" />
            CV ranking
          </ButtonLink>
        </div>

        {counts.total > 0 && (
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Per source</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {counts.bySource.map((s) => {
                  const label = s.source ? optionFor(candidateSources, s.source).label : "Unknown";
                  const pct = Math.round((s.count / counts.total) * 100);
                  return (
                    <li key={s.source ?? "none"} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 truncate text-ink">{label}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
                        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-10 text-right text-muted tabular-nums">{s.count}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Applied or headhunted</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {counts.byOrigin.map((o) => {
                  const option = optionFor(candidateOrigins, o.origin);
                  return (
                    <li key={o.origin} className="flex items-center justify-between gap-3">
                      <Badge tone={option.tone}>{option.label}</Badge>
                      <span className="text-muted tabular-nums">
                        <span className="font-semibold text-ink">{o.count}</span>, {o.active} still active
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
