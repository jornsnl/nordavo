import "server-only";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { loadOccupancy } from "@/lib/sales/flow-data";
import { bucketOption, isFree, occupancyText } from "@/lib/sales/triage";
import { createClient } from "@/lib/supabase/server";
import { LeadFlowControls } from "./lead-flow-controls";

/**
 * Where a lead is on the lead page (feedback Julius, round 4): its bucket or
 * flow, the campaigns, call lists and sequences it is or was in (channel,
 * since, until, replied), whether it is free, why this lead (the line on the call screen) and
 * the follow toggle. "Send to" moves it to another destination.
 */
export async function LeadFlowCard({ companyId }: { companyId: string }) {
  const db = await createClient();
  const [{ data: company, error }, occupancy] = await Promise.all([
    db
      .from("companies")
      .select("id, prio_reason, followed_at, bucket, bucket_until, bucket_reason, bucket_changed_at, source_list")
      .eq("id", companyId)
      .maybeSingle(),
    loadOccupancy(db, [companyId]),
  ]);
  if (error || !company) return null;
  const occ = occupancy.get(companyId) ?? [];
  const bucket = bucketOption(company.bucket);
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

        <LeadFlowControls
          companyId={company.id}
          prioReason={company.prio_reason}
          followed={Boolean(company.followed_at)}
        />
      </CardBody>
    </Card>
  );
}
