import "server-only";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { choiceLabel } from "@/lib/sales/choices";
import { loadChoiceLists, loadOccupancy } from "@/lib/sales/flow-data";
import { bucketOption, isFree, occupancyText } from "@/lib/sales/triage";
import { createClient } from "@/lib/supabase/server";
import { LeadFlowControls } from "./lead-flow-controls";

/**
 * Where a lead is on the lead page (feedback Julius, round 4): its bucket or
 * flow, the campaigns, call lists and sequences it is or was in (channel,
 * since, until, replied), whether it is free, the reason for its prio and
 * the follow toggle. "Send to" moves it to another destination.
 */
export async function LeadFlowCard({ companyId }: { companyId: string }) {
  const db = await createClient();
  const [{ data: company, error }, occupancy, lists] = await Promise.all([
    db
      .from("companies")
      .select("id, prio, prio_reason, followed_at, bucket, bucket_until, bucket_reason, bucket_changed_at, source_list")
      .eq("id", companyId)
      .maybeSingle(),
    loadOccupancy(db, [companyId]),
    loadChoiceLists(db),
  ]);
  if (error || !company) return null;
  const occ = occupancy.get(companyId) ?? [];
  const bucket = bucketOption(company.bucket);
  const prio = lists.prio.find((p) => p.value === String(company.prio));
  const free = isFree(company.bucket, occ);

  return (
    <Card>
      <CardHeader
        title="Where this lead is"
        description={`Came in with ${company.source_list ?? "no list"}. In ${bucket.label} since ${formatDate(company.bucket_changed_at)}.`}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={bucket.tone}>{bucket.label}</Badge>
          <Badge tone={free ? "success" : "warning"}>{free ? "Free" : "Occupied"}</Badge>
          {company.bucket_until && <span className="text-sm text-muted">until {formatDate(company.bucket_until)}</span>}
          {company.bucket_reason && <span className="text-sm text-muted">{company.bucket_reason}</span>}
        </div>

        {occ.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {occ.map((o, i) => (
              <li key={`${o.kind}-${o.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                <span className={o.active ? "font-medium text-ink" : "text-muted"}>{occupancyText(o)}</span>
                <span className="text-xs text-muted">
                  since {formatDate(o.since)}
                  {o.repliedAt ? ` · replied ${formatDate(o.repliedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div>
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
            Prio {prio ? `${choiceLabel(lists.prio, prio.value)}` : "not set"}
          </h3>
          {prio?.description && <p className="mt-0.5 text-xs text-muted">{prio.description}</p>}
        </div>

        <LeadFlowControls
          companyId={company.id}
          prioReason={company.prio_reason}
          followed={Boolean(company.followed_at)}
        />
      </CardBody>
    </Card>
  );
}
