import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { listPulseSignals } from "@/lib/academy/placement/data";
import { formatDate } from "@/lib/format";
import { HandleSignal } from "./forms";

/**
 * Highlight on the Academy dashboard: pulse answers with a low (5 or lower)
 * or dropping (2 or more down) score that Nordavo has not followed up yet.
 * Renders nothing when there are none.
 */
export async function PulseSignals({ compact = false }: { compact?: boolean }) {
  const signals = await listPulseSignals();
  if (signals.length === 0) return null;
  const shown = compact ? signals.slice(0, 3) : signals;
  return (
    <section role="status" aria-label="Pulse signals" className="mb-6 rounded-2xl border border-danger/30 bg-danger-bg p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-semibold text-danger">
          <TriangleAlert className="size-4" aria-hidden="true" />
          {signals.length === 1 ? "1 pulse signal to follow up" : `${signals.length} pulse signals to follow up`}
        </h2>
        {compact && (
          <Link href="/dashboard/academy/placements" className="text-sm font-medium text-danger underline hover:no-underline">
            All placements
          </Link>
        )}
      </div>
      <ul className="mt-3 space-y-3">
        {shown.map((s) => (
          <li key={s.pulse_id} className="rounded-xl bg-white/70 p-3 text-sm">
            <p>
              <Link href={`/dashboard/placements/${s.placement_id}?tab=academy`} className="font-semibold text-brand-900 hover:underline">
                {s.developer_name ?? "Placement"} at {s.client_name ?? "client"}
              </Link>
              : {s.name ?? "someone"} gave <strong>{s.score}/10</strong>
              {s.flag_reason === "drop" && s.previous_score !== null ? ` (was ${s.previous_score})` : ""} on {formatDate(s.created_at.slice(0, 10))}
            </p>
            {s.friction && <p className="mt-1 text-ink">Chafes: {s.friction}</p>}
            {!compact && <HandleSignal pulseId={s.pulse_id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
