const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** "3 Nov 2026", or the fallback when empty. */
export function formatDate(value: string | null | undefined, fallback = "No date") {
  if (!value) return fallback;
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  return dateTimeFormatter.format(new Date(value));
}

export function formatCurrency(value: number | null | undefined, fallback = "Unknown") {
  if (value === null || value === undefined) return fallback;
  return currencyFormatter.format(value);
}

/** Whole days between two dates (b minus a). */
export function daysBetween(a: string | Date, b: string | Date = new Date()) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / 86_400_000);
}

/** "today", "yesterday", "3 days ago", "in 2 days". */
export function formatRelativeDays(value: string | null | undefined) {
  if (!value) return "";
  const days = daysBetween(value);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (days > 1) return `${days} days ago`;
  return `in ${-days} days`;
}

export function initials(name: string) {
  return (
    name
      .split(/[\s.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "N"
  );
}

/** Today as YYYY-MM-DD in Amsterdam, for date inputs and comparisons. */
export function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
}
