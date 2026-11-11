import { BAND_LABELS, type Band } from "@/lib/wsp/content";
import type { ReportData } from "@/lib/wsp/report";
import { orderedDimensions } from "@/lib/wsp/view";

/**
 * The own result in short, on the last screen before the question about
 * sharing (feedback Julius: first a short result, the question under it).
 * The full report follows below.
 */
export function WspResultSummary({ report }: { report: ReportData }) {
  const dimensions = orderedDimensions(report.results);
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-5 shadow-xs sm:px-6" aria-labelledby="wsp-summary">
      <h2 id="wsp-summary" className="font-display text-lg font-semibold text-brand-900">
        Thank you. This is your working style in short
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {dimensions.map((d) => (
          <li key={d.text.dimension} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 text-sm">
            <span className="font-medium text-ink">{d.text.name}</span>
            <span className="text-muted tabular-nums">
              {d.score} / 100 · {BAND_LABELS[d.band as Band] ?? d.band}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Your full report is below, with what it means for you.</p>
    </section>
  );
}
