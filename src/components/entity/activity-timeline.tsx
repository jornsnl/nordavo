import Link from "next/link";
import type { ActivityItem } from "@/lib/data/activity";
import { formatDateTime } from "@/lib/format";
import { timeAgo } from "./format";

const dotTone: Record<ActivityItem["action"], string> = {
  created: "bg-emerald-500",
  updated: "bg-brand-200",
  deleted: "bg-danger",
  stage_changed: "bg-accent-500",
  status_changed: "bg-brand-500",
};

/** Name of the record, linked when it still exists. */
export function ActivityRecord({ item }: { item: ActivityItem }) {
  // The stored summary starts with the name at the time, useful once a record is gone.
  const fallback = item.summary.replace(new RegExp(`\\s*${item.verb}$`), "").trim();
  const label = item.record?.label ?? (fallback || "onbekend record");
  if (!item.record?.href) return <span className="font-medium text-ink">{label}</span>;
  return (
    <Link
      href={item.record.href}
      className="font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      {label}
    </Link>
  );
}

/**
 * Timeline for one record. Entries about the record itself read as
 * "Status gewijzigd"; entries about related pipeline cards or tasks name them.
 */
export function ActivityTimeline({
  items,
  entityType,
  entityId,
  now,
}: {
  items: ActivityItem[];
  entityType: string;
  entityId: string;
  now: Date;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted">Nog geen activiteit vastgelegd.</p>;
  }

  return (
    <ol className="relative space-y-4 before:absolute before:top-1.5 before:bottom-1.5 before:left-[5px] before:w-px before:bg-border">
      {items.map((item) => {
        const self = item.entityType === entityType && item.entityId === entityId;
        const verb = item.verb.charAt(0).toUpperCase() + item.verb.slice(1);
        return (
          <li key={item.id} className="relative pl-6">
            <span
              aria-hidden="true"
              className={`absolute top-1.5 left-0 size-[11px] rounded-full ring-2 ring-card ${dotTone[item.action]}`}
            />
            <p className="text-sm text-ink">
              {self ? (
                verb
              ) : (
                <>
                  {item.typeLabel} <ActivityRecord item={item} /> {item.verb}
                </>
              )}
            </p>
            {item.detail && <p className="mt-0.5 text-xs break-words text-muted">{item.detail}</p>}
            <p className="mt-0.5 text-xs text-muted">
              {item.actorName ?? "Systeem"},{" "}
              <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
                {timeAgo(item.createdAt, now)}
              </time>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
