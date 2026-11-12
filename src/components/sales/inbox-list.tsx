"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { companyPrios, labelOf, leadStatuses } from "@/lib/sales/labels";
import { occupancyText, type CompanyOccupancy } from "@/lib/sales/triage";
import { TriageBar } from "./triage-bar";

export type InboxListRow = {
  id: string;
  name: string;
  city: string | null;
  prio: number | null;
  leadStatus: string;
  sourceList: string;
  worker: string | null;
  bucketUntil: string | null;
  bucketReason: string | null;
  createdAt: string;
  occupancy: CompanyOccupancy[];
};

/** Leads of one bucket, grouped per list (Incoming) or per worker, with a selection to triage. */
export function InboxList({
  rows,
  truncated,
  groupBy,
  callers,
}: {
  rows: InboxListRow[];
  truncated: boolean;
  groupBy: "list" | "worker";
  callers?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, InboxListRow[]>();
    for (const r of rows) {
      const key = groupBy === "list" ? r.sourceList : (r.worker ?? "Nobody yet");
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [rows, groupBy]);

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm lg:top-2">
        <span className="font-semibold text-brand-900 tabular-nums">{selected.size} selected</span>
        <TriageBar
          companyIds={[...selected]}
          callers={callers}
          onDone={(text) => {
            setSelected(new Set());
            setMessage({ tone: "ok", text });
            router.refresh();
          }}
          onError={(text) => setMessage({ tone: "error", text })}
        />
        {selected.size > 0 && (
          <button type="button" className="text-sm font-medium text-muted hover:text-ink" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        )}
        {message && (
          <span role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-danger" : "text-emerald-700"}>
            {message.text}
          </span>
        )}
      </div>

      {groups.map(([name, list]) => {
        const all = list.every((r) => selected.has(r.id));
        return (
          <Card key={name} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2.5">
              <label className="flex items-center gap-2 font-medium text-ink">
                <input type="checkbox" checked={all} onChange={() => toggle(list.map((r) => r.id), !all)} aria-label={`Select all of ${name}`} />
                {name}
              </label>
              <span className="text-xs text-muted tabular-nums">{list.length}</span>
            </div>
            <ul className="divide-y divide-border">
              {list.map((r) => {
                const prio = companyPrios.find((p) => p.value === String(r.prio));
                const running = r.occupancy.filter((o) => o.active);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={(e) => toggle([r.id], e.target.checked)}
                      aria-label={`Select ${r.name}`}
                    />
                    <span className="min-w-0 flex-1">
                      <Link href={`/dashboard/leads/${r.id}`} className="font-medium text-brand-800 hover:underline">
                        {r.name}
                      </Link>
                      <span className="text-muted">
                        {r.city ? ` · ${r.city}` : ""} · {labelOf(leadStatuses, r.leadStatus as never)} · added {formatDate(r.createdAt)}
                      </span>
                      {r.bucketUntil && <span className="text-muted"> · until {formatDate(r.bucketUntil)}</span>}
                      {r.bucketReason && <span className="block text-xs text-muted">{r.bucketReason}</span>}
                    </span>
                    {running.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-800" title="Occupied: not free for a second campaign">
                        <AlertTriangle className="size-3.5" aria-hidden="true" />
                        {running.map(occupancyText).join("; ")}
                      </span>
                    )}
                    {prio && <Badge tone={prio.tone}>{prio.label}</Badge>}
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
      {truncated && <p className="text-sm text-muted">Showing the first 1000 leads. Filter on a list to see the rest.</p>}
    </div>
  );
}
