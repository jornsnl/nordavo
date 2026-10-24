import { Activity } from "lucide-react";
import { listRecentActivity } from "@/lib/data/activity";
import { formatDateTime } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { ActivityRecord } from "./activity-timeline";
import { timeAgo } from "./format";

/**
 * Latest entries from the activity log across the whole portal,
 * for the dashboard overview.
 * Contract: async Server Component, render inside <Suspense>.
 */
export async function RecentActivity({ limit = 8 }: { limit?: number }) {
  const items = await listRecentActivity(limit);
  const now = new Date();

  return (
    <Card>
      <CardHeader title="Recente activiteit" description="Wat er het laatst is veranderd in het portaal." />
      {items.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-10 text-center">
          <Activity className="mb-2 size-6 text-brand-600" aria-hidden="true" />
          <p className="text-sm text-muted">Nog geen activiteit. Zodra je iets aanmaakt of wijzigt, zie je het hier.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const actor = item.actorName ?? "Systeem";
            return (
              <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                <Avatar name={actor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm break-words text-ink">
                    <span className="font-medium">{actor}</span>{" "}
                    <span className="text-muted">{item.typeLabel.toLowerCase()}</span>{" "}
                    <ActivityRecord item={item} /> {item.verb}
                  </p>
                  {item.detail && <p className="mt-0.5 text-xs break-words text-muted">{item.detail}</p>}
                </div>
                <time
                  dateTime={item.createdAt}
                  title={formatDateTime(item.createdAt)}
                  className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-muted"
                >
                  {timeAgo(item.createdAt, now)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
