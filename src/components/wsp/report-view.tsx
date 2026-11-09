import type { ReactNode } from "react";
import { Download, Info } from "lucide-react";
import {
  BAND_LABELS,
  COLUMN_FOR_EMPLOYER,
  COLUMN_FOR_YOU,
  COLUMN_HIGHER_STRENGTHS,
  COLUMN_LOWER_STRENGTHS,
  DOWNLOAD_PDF,
  REPORT_FOOTER,
  REPORT_TITLE,
  SCORE_TOOLTIP,
} from "@/lib/wsp/content";
import type { ReportData } from "@/lib/wsp/report";
import { formatWspDate, reportIntro, splitName, type ReportAudience } from "@/lib/wsp/text";
import { orderedDimensions, type ReportDimension } from "@/lib/wsp/view";

/**
 * The report (part 3): the same content for the person, staff and the
 * client; only the intro differs per role (staff reads the client intro).
 * Rule based, the fixed texts of src/lib/wsp/content.ts. Works on a phone.
 */
export function WspReportView({
  report,
  audience,
  pdfHref,
  beforeBlocks,
}: {
  report: ReportData;
  audience: ReportAudience;
  pdfHref: string;
  /** Staff: the caution banner goes above the blocks. */
  beforeBlocks?: ReactNode;
}) {
  const { first } = splitName(report.fullName);
  const intro = reportIntro(audience, first);
  const role = report.roleLabel ?? (report.personType === "developer" ? "Developer" : "Candidate");
  return (
    <article className="space-y-5" aria-label={REPORT_TITLE}>
      <header className="flex flex-col gap-4 rounded-2xl bg-brand-900 px-5 py-5 text-white sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-accent-500 uppercase">{REPORT_TITLE}</p>
          <h1 className="mt-1 font-display text-2xl font-bold break-words">{report.fullName}</h1>
          <p className="mt-1 text-sm text-brand-100">
            {role}
            <span aria-hidden="true"> · </span>
            {formatWspDate(report.completedAt)}
          </p>
        </div>
        <a
          href={pdfHref}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-sm transition hover:bg-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white pointer-coarse:min-h-11"
        >
          <Download className="size-4" aria-hidden="true" />
          {DOWNLOAD_PDF}
        </a>
      </header>

      <section className="rounded-2xl border border-border bg-surface px-5 py-4 sm:px-6">
        <h2 className="font-display text-base font-semibold text-brand-900">{intro.heading}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink">{intro.body}</p>
      </section>

      {beforeBlocks}

      {orderedDimensions(report.results).map((dimension) => (
        <DimensionBlock key={dimension.text.dimension} dimension={dimension} />
      ))}

      <footer className="border-t border-border pt-4 text-xs leading-relaxed text-muted">{REPORT_FOOTER}</footer>
    </article>
  );
}

function DimensionBlock({ dimension }: { dimension: ReportDimension }) {
  const { text, score, band } = dimension;
  const tooltipId = `wsp-tip-${text.dimension}`;
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-5 shadow-xs sm:px-6" aria-labelledby={`wsp-dim-${text.dimension}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={`wsp-dim-${text.dimension}`} className="font-display text-lg font-bold text-brand-900">
          {text.name}
        </h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-accent-100 px-2.5 py-1 text-xs font-semibold text-brand-900">{BAND_LABELS[band]}</span>
          <span className="font-display text-3xl font-bold text-brand-900 tabular-nums">{score} / 100</span>
          <span className="group relative inline-flex">
            <button
              type="button"
              aria-describedby={tooltipId}
              aria-label="What this score means"
              className="flex size-8 items-center justify-center rounded-full text-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500 pointer-coarse:size-11"
            >
              <Info className="size-4" aria-hidden="true" />
            </button>
            <span
              id={tooltipId}
              role="tooltip"
              className="pointer-events-none invisible absolute top-full right-0 z-10 mt-1 w-64 rounded-lg bg-brand-950 px-3 py-2 text-xs leading-relaxed text-white opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
            >
              {SCORE_TOOLTIP}
            </span>
          </span>
        </div>
      </div>
      <p className="mt-1 text-sm text-ink">{text.description}</p>

      <div className="mt-5">
        <div className="flex justify-between text-xs font-semibold text-muted">
          <span>{text.leftLabel}</span>
          <span>{text.rightLabel}</span>
        </div>
        <div className="relative mt-2 h-2 rounded-full bg-brand-100" aria-hidden="true">
          <div className="h-2 rounded-full bg-brand-700" style={{ width: `${score}%` }} />
          <span
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-900 bg-accent-500"
            style={{ left: `${score}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-muted tabular-nums" aria-hidden="true">
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Column title={COLUMN_LOWER_STRENGTHS} body={text.lowerStrengths} />
        <Column title={COLUMN_HIGHER_STRENGTHS} body={text.higherStrengths} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 rounded-xl bg-surface p-4 sm:grid-cols-2">
        <Column title={COLUMN_FOR_YOU} body={text.bands[band].forYou} />
        <Column title={COLUMN_FOR_EMPLOYER} body={text.bands[band].forEmployer} />
      </div>
    </section>
  );
}

function Column({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-brand-900">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink">{body}</p>
    </div>
  );
}
