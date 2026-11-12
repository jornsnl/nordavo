import Link from "next/link";
import { Megaphone } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import type { CampaignListItem } from "@/lib/data/campaigns";
import { formatDate } from "@/lib/format";

export const campaignStatusTone = { draft: "neutral", active: "success", paused: "warning", finished: "neutral" } as const;
export const providerLabel: Record<string, string> = { instantly: "Instantly", seleqt: "Seleqt", portal: "Portal", other: "Other" };

/** Running campaigns with how many leads are in them and how many replied. */
export function CampaignList({ campaigns }: { campaigns: CampaignListItem[] }) {
  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No campaigns yet"
        description="Campaigns in Instantly and Seleqt show up here once Claude registers them (or the Instantly sync runs), with their leads and replies. You can also add one on the right."
      />
    );
  }
  return (
    <Table>
      <THead>
        <tr>
          <TH>Campaign</TH>
          <TH>Where</TH>
          <TH>Status</TH>
          <TH className="text-right">Leads</TH>
          <TH className="text-right">Running</TH>
          <TH className="text-right">Replied</TH>
          <TH>Since</TH>
        </tr>
      </THead>
      <TBody>
        {campaigns.map((c) => (
          <TR key={c.id}>
            <TD>
              <Link href={`/dashboard/sequences/campaigns/${c.id}`} className="font-medium text-brand-900 hover:text-brand-600 hover:underline">
                {c.name}
              </Link>
            </TD>
            <TD>
              {providerLabel[c.provider] ?? c.provider} · {c.channel === "linkedin" ? "LinkedIn" : c.channel === "mail" ? "Mail" : "Call"}
            </TD>
            <TD>
              <Badge tone={campaignStatusTone[c.status]}>{c.status}</Badge>
            </TD>
            <TD className="text-right tabular-nums">{c.counts.total}</TD>
            <TD className="text-right tabular-nums">{c.counts.queued + c.counts.active}</TD>
            <TD className="text-right tabular-nums">{c.counts.replied}</TD>
            <TD className="text-muted">{c.startedAt ? formatDate(c.startedAt) : ""}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
