import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { listClientReports } from "@/lib/wsp/data";
import { formatWspDate } from "@/lib/wsp/text";

/**
 * Working Style Profiles shared with the client (client portal). Only
 * profiles with an active share of the person themselves; nothing when
 * there are none or the feature is off.
 */
export async function WspPortalSection({ full = false }: { full?: boolean }) {
  const reports = await listClientReports();
  if (reports.length === 0) {
    return full ? <p className="text-sm text-muted">No working style profiles have been shared with you.</p> : null;
  }
  return (
    <Card>
      <CardHeader title="Working style profiles" description="Shared with you by the candidates and developers themselves." />
      <CardBody className="p-0">
        <ul className="divide-y divide-border">
          {reports.map((r) => (
            <li key={r.assessment_id}>
              <Link href={`/portal/working-style/${r.assessment_id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-brand-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-brand-900">{r.full_name}</span>
                  <span className="block truncate text-xs text-muted">
                    {r.role_label ? `${r.role_label} · ` : ""}shared {formatWspDate(r.consented_at)}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
