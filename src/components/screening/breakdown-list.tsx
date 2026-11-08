import { Check, Minus, Shuffle } from "lucide-react";
import type { BreakdownItem } from "@/lib/screening/scoring";

const KIND = { must_have: "Must have", alternative: "Alternative possible", nice_to_have: "Nice to have" } as const;

/** Per requirement: met, met by an alternative, or missing, with the evidence. Missing must haves stand out. */
export function BreakdownList({ items }: { items: BreakdownItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted">No breakdown stored.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((b, i) => {
        const mustMiss = b.kind === "must_have" && b.status === "missing";
        const Icon = b.status === "met" ? Check : b.status === "alternative" ? Shuffle : Minus;
        return (
          <li
            key={`${b.label}-${i}`}
            className={`flex gap-2 rounded-lg px-2 py-1 ${mustMiss ? "bg-danger-bg text-danger" : ""}`}
          >
            <Icon
              className={`mt-0.5 size-4 shrink-0 ${b.status === "met" ? "text-emerald-600" : b.status === "alternative" ? "text-amber-600" : mustMiss ? "text-danger" : "text-muted"}`}
              aria-label={b.status === "met" ? "Met" : b.status === "alternative" ? "Met by an alternative" : "Missing"}
            />
            <span className="min-w-0">
              <span className="font-medium">{b.label}</span>
              <span className="ml-1 text-xs text-muted">({KIND[b.kind]})</span>
              {b.evidence && <span className={`block ${mustMiss ? "" : "text-muted"}`}>{b.evidence}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
