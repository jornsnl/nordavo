import type { LeadTime } from "@/lib/talent/lead-time";

const styles: Record<LeadTime["level"], { dot: string; text: string }> = {
  none: { dot: "bg-slate-300", text: "text-muted" },
  closed: { dot: "bg-slate-300", text: "text-muted" },
  ok: { dot: "bg-emerald-500", text: "text-emerald-700" },
  done: { dot: "bg-emerald-500", text: "text-emerald-700" },
  warning: { dot: "bg-amber-500", text: "text-amber-800" },
  danger: { dot: "bg-danger", text: "text-danger" },
};

/** T6: days since intake against "3 kandidaten binnen 3 weken". */
export function LeadTimeSignal({ leadTime }: { leadTime: LeadTime }) {
  const { dot, text } = styles[leadTime.level];
  return (
    <span className={`inline-flex items-center gap-2 font-medium whitespace-nowrap ${text}`}>
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${dot}`} />
      {leadTime.label}
    </span>
  );
}
