import { ExternalLink } from "lucide-react";
import { daysOnline, onlineSince } from "@/lib/sales/vacancies";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function sourceName(url: string | null, source: string | null): string | null {
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (/indeed\./.test(host)) return "Indeed";
      if (/linkedin\.com$/.test(host)) return "LinkedIn";
      return host;
    } catch {
      // Not a URL: fall back to the source below.
    }
  }
  return source && !["overig", "import", "apify", "prospeo"].includes(source) ? source : null;
}

/**
 * One vacancy: the title links to the vacancy itself (website, LinkedIn,
 * Indeed), the day it went online and the days open (counted daily, from the
 * posted date or else the day we first saw it), and the vacancy text to fold
 * open. Used on the lead page (Signals) and on the call screen.
 */
export function VacancyItem({
  title,
  url,
  source,
  postedAt,
  firstSeenAt,
  closedAt,
  description,
  roleGroup,
  compact = false,
}: {
  title: string | null;
  url: string | null;
  source?: string | null;
  postedAt?: string | null;
  firstSeenAt: string;
  closedAt?: string | null;
  description?: string | null;
  roleGroup?: string | null;
  compact?: boolean;
}) {
  const since = onlineSince({ posted_at: postedAt, first_seen_at: firstSeenAt });
  const days = closedAt ? null : daysOnline(since);
  const where = sourceName(url, source ?? null);
  return (
    <div className="min-w-0 space-y-1">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 font-medium text-brand-700 hover:underline ${compact ? "text-xs" : "text-sm"}`}
        >
          {title || "Vacancy"}
          <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <p className={`font-medium text-ink ${compact ? "text-xs" : "text-sm"}`}>{title || "Untitled vacancy"}</p>
      )}
      <p className="text-xs text-muted">
        {[
          where,
          roleGroup,
          since ? `${postedAt ? "Online since" : "First seen"} ${dateFmt.format(new Date(`${since}T12:00:00Z`))}` : null,
          closedAt ? `offline since ${dateFmt.format(new Date(closedAt))}` : days !== null ? (days === 1 ? "1 day open" : `${days} days open`) : null,
          !postedAt && !closedAt ? "no posted date" : null,
        ]
          .filter(Boolean)
          .join(", ")}
      </p>
      {description && (
        <details className="group text-xs">
          <summary className="cursor-pointer text-brand-700 select-none hover:underline">Vacancy text</summary>
          <p className="mt-1 max-h-72 overflow-y-auto rounded-lg bg-surface/70 px-3 py-2 whitespace-pre-line text-ink">{description}</p>
        </details>
      )}
    </div>
  );
}
