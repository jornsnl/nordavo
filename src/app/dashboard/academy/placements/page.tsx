import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Handshake } from "lucide-react";
import { listAcademyPlacements } from "@/lib/academy/placement/data";
import { formatDate } from "@/lib/format";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { PulseSignals } from "@/components/academy/admin/placement/signals";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Academy placements" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="Placements"
        description="Pulse signals, open leave and the people of every running placement. Open a placement for its Academy tab."
      />
      <Suspense fallback={null}>
        <PulseSignals />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Placements />
      </Suspense>
    </>
  );
}

async function Placements() {
  const placements = await listAcademyPlacements();
  if (placements.length === 0) {
    return <EmptyState icon={Handshake} title="No running placements" description="Placements are made in Recruitment, Placements." />;
  }
  return (
    <ul className="space-y-3">
      {placements.map((p) => (
        <li key={p.id}>
          <Link
            href={`/dashboard/placements/${p.id}?tab=academy`}
            className="block rounded-2xl border border-border bg-card px-4 py-3.5 shadow-xs transition hover:border-brand-200 hover:bg-brand-50/40 sm:px-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-brand-900">
                {p.developer_name ?? "—"} <span className="font-normal text-muted">at</span> {p.client_name ?? "—"}
              </span>
              {p.status === "notice" && <Badge tone="warning">Notice given</Badge>}
              {p.signals > 0 && <Badge tone="danger">{p.signals === 1 ? "1 signal" : `${p.signals} signals`}</Badge>}
              {p.openLeave > 0 && <Badge tone="brand">{p.openLeave} leave to decide</Badge>}
              {p.members === 0 && <Badge>No members yet</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted">
              Since {formatDate(p.start_date)} · {p.members} {p.members === 1 ? "member" : "members"}
              {p.latestScores.length > 0 && ` · latest pulse ${p.latestScores.join(", ")}`}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
