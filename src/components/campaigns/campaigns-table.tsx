import { Megaphone } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { Segment, SignalType } from "@/lib/database.types";
import { listCampaignStats } from "@/lib/data/campaigns";
import { formatDate } from "@/lib/format";
import type { CampaignVerdict } from "@/lib/gtm/lists";
import { activityChannels, optionFor, segments, signalTypes, type Tone } from "@/lib/labels";

const verdictTone: Record<CampaignVerdict["verdict"], Tone> = {
  te_vroeg: "neutral",
  herschrijven: "danger",
  doorgaan: "brand",
  opschalen: "success",
};

function percent(rate: number | null) {
  if (rate === null) return "Geen";
  return `${(rate * 100).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
}

export async function CampaignsTable() {
  const campaigns = await listCampaignStats();
  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Nog geen campagnes"
        description="Campagnes ontstaan vanzelf als je een maillijst naar Instantly stuurt via Lijsten, één per signaal."
      />
    );
  }
  return (
    <>
      <MobileList label="Campagnes" className="md:hidden">
        {campaigns.map((c) => {
          const channel = optionFor(activityChannels, c.channel);
          const signal = c.signalType ? optionFor(signalTypes, c.signalType as SignalType) : null;
          const segment = c.segment ? optionFor(segments, c.segment as Segment) : null;
          return (
            <MobileListItem
              key={c.id}
              title={c.name}
              subtitle={[channel.label, signal?.label, segment?.label ?? "alle segmenten"].filter(Boolean).join(", ")}
              meta={[c.variant ? `variant ${c.variant}` : null, c.startedAt ? `sinds ${formatDate(c.startedAt)}` : null]
                .filter(Boolean)
                .join(", ")}
            >
              <Badge tone={verdictTone[c.verdict.verdict]}>{c.verdict.label}</Badge>
              <dl className="mt-2 grid grid-cols-[1fr_1fr_1fr_1.3fr_1.3fr] gap-1 rounded-xl bg-surface/70 px-2 py-2 text-center">
                {[
                  ["Leads", c.leads],
                  ["Replies", c.replies],
                  ["Positief", c.positive],
                  ["Afspraken", c.meetings],
                  ["Reply rate", percent(c.verdict.rate)],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="truncate text-[11px] text-muted">{label}</dt>
                    <dd className="text-sm font-semibold text-ink tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </MobileListItem>
          );
        })}
      </MobileList>
      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Campagne</TH>
            <TH>Kanaal</TH>
            <TH>Signaal</TH>
            <TH>Segment</TH>
            <TH className="text-right">Leads</TH>
            <TH className="text-right">Replies</TH>
            <TH className="text-right">Positief</TH>
            <TH className="text-right">Afspraken</TH>
            <TH className="text-right">Reply rate</TH>
            <TH>Evaluatie</TH>
          </tr>
        </THead>
        <TBody>
          {campaigns.map((c) => {
            const channel = optionFor(activityChannels, c.channel);
            const signal = c.signalType ? optionFor(signalTypes, c.signalType as SignalType) : null;
            const segment = c.segment ? optionFor(segments, c.segment as Segment) : null;
            return (
              <TR key={c.id}>
                <TD>
                  <div className="font-medium text-brand-900">{c.name}</div>
                  <div className="text-xs text-muted">
                    {[c.variant, c.startedAt ? `sinds ${formatDate(c.startedAt)}` : null].filter(Boolean).join(", ")}
                  </div>
                </TD>
                <TD>
                  <Badge tone={channel.tone}>{channel.label}</Badge>
                </TD>
                <TD>{signal ? <Badge tone={signal.tone}>{signal.label}</Badge> : <span className="text-muted">Geen</span>}</TD>
                <TD className="text-muted">{segment?.label ?? "Alle"}</TD>
                <TD className="text-right tabular-nums">{c.leads}</TD>
                <TD className="text-right tabular-nums">{c.replies}</TD>
                <TD className="text-right tabular-nums">{c.positive}</TD>
                <TD className="text-right tabular-nums">{c.meetings}</TD>
                <TD className="text-right tabular-nums">{percent(c.verdict.rate)}</TD>
                <TD>
                  <Badge tone={verdictTone[c.verdict.verdict]}>{c.verdict.label}</Badge>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </>
  );
}
