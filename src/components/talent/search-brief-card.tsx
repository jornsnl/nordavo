import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { StoredSearchBrief } from "@/lib/talent/match";
import { generateSearchBriefAction } from "@/app/dashboard/vacatures/talent-actions";
import { ActionButton } from "./action-button";
import { CopyButton } from "./copy-button";

function Block({ title, text, mono = false }: { title: string; text: string; mono?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{title}</h3>
        <CopyButton text={text} label={title} />
      </div>
      <p className={`rounded-xl border border-border bg-surface px-3 py-2 text-sm break-words text-ink ${mono ? "font-mono text-[13px]" : ""}`}>
        {text}
      </p>
    </div>
  );
}

/** T3: search terms and booleans for when the pool has fewer than 3 strong matches. */
export function SearchBriefCard({ vacancyId, brief, canGenerate }: { vacancyId: string; brief: StoredSearchBrief | null; canGenerate: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Zoekopdracht buiten de pool"
        description={
          brief
            ? `Gemaakt op ${formatDate(brief.generated_at, "onbekende datum")}: ${brief.strong} van ${brief.scored} gescoorde kandidaten had een score van 70 of hoger.`
            : "Komt vanzelf als de pool minder dan 3 matches met score 70 of hoger geeft."
        }
        actions={
          canGenerate ? (
            <ActionButton action={generateSearchBriefAction.bind(null, vacancyId)} pendingLabel="Bezig" className="max-w-56 text-right">
              <Search aria-hidden="true" />
              {brief ? "Opnieuw maken" : "Nu maken"}
            </ActionButton>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {brief ? (
          <>
            <Block title="LinkedIn Recruiter boolean" text={brief.linkedin_boolean} mono />
            <Block title="Naukri boolean" text={brief.naukri_boolean} mono />
            <Block title="Zoektermen" text={brief.keywords.join(", ")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Functietitels</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {brief.titles.map((t, i) => (
                    <li key={`${t}-${i}`}>
                      <Badge tone="brand">{t}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Locaties</h3>
                <ol className="flex flex-wrap gap-1.5">
                  {brief.locations.map((l, i) => (
                    <li key={`${l}-${i}`}>
                      <Badge tone={i === 0 ? "accent" : "neutral"}>{l}</Badge>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            {brief.min_years !== null && <p className="text-sm text-ink">Minimaal {brief.min_years} jaar ervaring.</p>}
            {brief.notes.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink marker:text-accent-500">
                {brief.notes.map((n, i) => (
                  <li key={`${n}-${i}`}>{n}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Nog geen zoekopdracht.</p>
        )}
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">
          Nieuwe kandidaten laat je het Fillout formulier invullen. Ze komen dan in de talentenpool in Airtable. Draai daarna
          Matchen opnieuw, dan worden ze meegenomen.
        </p>
      </CardBody>
    </Card>
  );
}
