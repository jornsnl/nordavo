import { Link2, ListChecks, Mail, Phone } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ListExportType } from "@/lib/database.types";
import type { ListPreview, PreviewRow } from "@/lib/gtm/lists";
import { optionFor, segments, signalTypes } from "@/lib/labels";

const reachLabel: Record<ListExportType, string> = {
  bellijst: "Telefoon",
  mailcampagne: "E-mail",
  max_verrijking: "LinkedIn",
};

export function PreviewTable({ type, preview }: { type: ListExportType; preview: ListPreview }) {
  if (preview.rows.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Niemand op deze lijst"
        description="Met dit filter is er niemand die we nu mogen benaderen. Pas het filter aan of wacht op nieuwe signalen en verrijking."
      />
    );
  }
  return (
    <>
      <MobileList label="Voorbeeld" className="md:hidden">
        {preview.rows.map((row) => (
          <MobileListItem
            key={row.contactId}
            title={row.name || "Naam onbekend"}
            subtitle={[row.title, row.companyName].filter(Boolean).join(" bij ")}
            meta={[row.tier ? `Tier ${row.tier}` : null, row.score !== null ? `score ${row.score}` : null, row.signalTitle]
              .filter(Boolean)
              .join(", ")}
            trailing={<ReachAction type={type} row={row} />}
          />
        ))}
      </MobileList>
      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Contact</TH>
            <TH>Bedrijf</TH>
            <TH>Segment</TH>
            <TH className="text-right">Score</TH>
            <TH>Signaal</TH>
            <TH>{reachLabel[type]}</TH>
          </tr>
        </THead>
        <TBody>
          {preview.rows.map((row) => (
            <TR key={row.contactId}>
              <TD>
                <div className="font-medium text-brand-900">{row.name || "Naam onbekend"}</div>
                <div className="text-xs text-muted">
                  {[row.title, row.tier ? `tier ${row.tier}` : null].filter(Boolean).join(", ") || "Functie onbekend"}
                </div>
              </TD>
              <TD>
                <div>{row.companyName}</div>
                <div className="text-xs text-muted">{row.domain}</div>
              </TD>
              <TD>
                {row.segment ? (
                  <Badge tone={optionFor(segments, row.segment).tone}>{optionFor(segments, row.segment).label}</Badge>
                ) : (
                  <span className="text-muted">Onbekend</span>
                )}
              </TD>
              <TD className="text-right tabular-nums">{row.score ?? "?"}</TD>
              <TD>
                {row.signalType ? (
                  <div>
                    <Badge tone={optionFor(signalTypes, row.signalType).tone}>{optionFor(signalTypes, row.signalType).label}</Badge>
                    {row.signalTitle && <div className="mt-1 max-w-56 truncate text-xs text-muted">{row.signalTitle}</div>}
                  </div>
                ) : (
                  <span className="text-muted">Geen</span>
                )}
              </TD>
              <TD className="max-w-60 truncate text-muted">{row.reach}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

/** Phones: call, mail or open LinkedIn straight from the preview. */
function ReachAction({ type, row }: { type: ListExportType; row: PreviewRow }) {
  if (!row.reach) return null;
  const className =
    "flex size-11 items-center justify-center rounded-full border border-border bg-white text-brand-700 transition active:scale-95 active:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500";
  const name = row.name || "contact";
  if (type === "bellijst") {
    return (
      <a href={`tel:${row.reach.replace(/[^\d+]/g, "")}`} className={className} aria-label={`${name} bellen, ${row.reach}`}>
        <Phone className="size-5" aria-hidden="true" />
      </a>
    );
  }
  if (type === "mailcampagne") {
    return (
      <a href={`mailto:${row.reach}`} className={className} aria-label={`${name} mailen, ${row.reach}`}>
        <Mail className="size-5" aria-hidden="true" />
      </a>
    );
  }
  return (
    <a href={row.reach} target="_blank" rel="noopener noreferrer" className={className} aria-label={`LinkedIn van ${name} (opent in een nieuw tabblad)`}>
      <Link2 className="size-5" aria-hidden="true" />
    </a>
  );
}
