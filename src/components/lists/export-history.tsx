import { History } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listExportHistory } from "@/lib/data/lists";
import { formatDateTime } from "@/lib/format";
import { filterSummary, listDefinitions } from "@/lib/gtm/lists";

function Destination({ value, campaignName }: { value: string | null; campaignName: string | null }) {
  if (value && /^https?:\/\//.test(value)) {
    const label = value.includes("docs.google.com") ? "Google Sheet" : value.includes("instantly.ai") ? (campaignName ?? "Instantly") : "Openen";
    return (
      <a href={value} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">
        {label}
      </a>
    );
  }
  if (value?.startsWith("csv:")) return <span className="text-muted">CSV download</span>;
  return <span className="text-muted">{value ?? "Onbekend"}</span>;
}

export async function ExportHistory() {
  const items = await listExportHistory(30);
  if (items.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Nog geen exports"
        description="Elke bellijst, mailcampagne en CSV voor Max komt hier te staan, met het filter dat je gebruikte."
      />
    );
  }
  return (
    <>
      <MobileList label="Exporthistorie" className="md:hidden">
        {items.map((item) => (
          <MobileListItem
            key={item.id}
            title={
              <span className="flex items-center gap-2">
                <Badge tone={item.type === "bellijst" ? "brand" : item.type === "mailcampagne" ? "accent" : "neutral"}>
                  {listDefinitions[item.type].label}
                </Badge>
                <span className="tabular-nums">
                  {item.recordCount} {item.recordCount === 1 ? "contact" : "contacten"}
                </span>
              </span>
            }
            subtitle={filterSummary(item.filterUsed)}
            meta={`${formatDateTime(item.createdAt)}, ${item.createdBy ?? "automatisch"}`}
          >
            <span className="text-sm">
              <Destination value={item.destination} campaignName={item.campaignName} />
            </span>
          </MobileListItem>
        ))}
      </MobileList>
      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Lijst</TH>
            <TH className="text-right">Aantal</TH>
            <TH>Filter</TH>
            <TH>Bestemming</TH>
            <TH>Door</TH>
            <TH>Wanneer</TH>
          </tr>
        </THead>
        <TBody>
          {items.map((item) => (
            <TR key={item.id}>
              <TD>
                <Badge tone={item.type === "bellijst" ? "brand" : item.type === "mailcampagne" ? "accent" : "neutral"}>
                  {listDefinitions[item.type].label}
                </Badge>
              </TD>
              <TD className="text-right tabular-nums">{item.recordCount}</TD>
              <TD className="text-muted">{filterSummary(item.filterUsed)}</TD>
              <TD>
                <Destination value={item.destination} campaignName={item.campaignName} />
              </TD>
              <TD className="text-muted">{item.createdBy ?? "Automatisch"}</TD>
              <TD className="whitespace-nowrap text-muted">{formatDateTime(item.createdAt)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
