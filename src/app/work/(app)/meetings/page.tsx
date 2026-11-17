import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { CalendarClock, Lock, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listMeetings, listMeetingWorkspaces } from "@/lib/work/meeting-data";

export const metadata: Metadata = { title: "Meetings" };

/**
 * Meetings: an agenda per recurring meeting, with points anyone in it can
 * drop on it. Open one to walk through the agenda, decide, and hand points
 * to people as tasks.
 */
export default function MeetingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Meetings"
        description="Collect points for a meeting as an agenda, walk through it, and hand points on as tasks. What is not discussed moves to the next meeting."
        actions={
          <ButtonLink href="/work/meetings/new">
            <Plus aria-hidden="true" />
            New meeting
          </ButtonLink>
        }
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <MeetingList />
      </Suspense>
    </>
  );
}

async function MeetingList() {
  const [meetings, workspaces] = await Promise.all([listMeetings(), listMeetingWorkspaces()]);
  if (meetings.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No meetings yet"
        description={
          workspaces.length > 0
            ? "Start one, for example a weekly with a colleague or a team meeting, and drop your points on it."
            : "You are not in a workspace where you can start a meeting yet."
        }
      />
    );
  }
  const groups = new Map<string, typeof meetings>();
  for (const m of meetings) groups.set(m.workspace.id, [...(groups.get(m.workspace.id) ?? []), m]);

  return (
    <div className="space-y-5">
      {[...groups.values()].map((group) => (
        <Card key={group[0].workspace.id}>
          <CardHeader title={group[0].workspace.name} description={group[0].workspace.kind === "private" ? "Private workspace" : undefined} />
          <ul className="divide-y divide-border">
            {group.map((m) => (
              <li key={m.id}>
                <Link href={`/work/meetings/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-brand-50 sm:px-5 pointer-coarse:min-h-14">
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-semibold ${m.archived ? "text-muted" : ""}`}>{m.name}</span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                      {m.visibility === "invited" ? (
                        <>
                          <Lock className="size-3" aria-hidden="true" />
                          {m.people.map((p) => p.name).join(", ") || "Only you"}
                        </>
                      ) : (
                        <>
                          <Users className="size-3" aria-hidden="true" />
                          Whole workspace
                        </>
                      )}
                    </span>
                  </span>
                  {m.archived && <Badge>Archived</Badge>}
                  {m.openPoints > 0 && (
                    <Badge tone="brand">
                      {m.openPoints} {m.openPoints === 1 ? "point" : "points"}
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
