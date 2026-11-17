import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, Settings, Users } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { AgendaItemCard } from "@/components/work/agenda-item";
import { AgendaQuickAdd } from "@/components/work/agenda-quick-add";
import { CloseMeetingButton } from "@/components/work/meeting-forms";
import { requireWorkUser } from "@/lib/work/data";
import { getMeeting, type AgendaItem } from "@/lib/work/meeting-data";
import { formatDateIn } from "@/lib/work/time";

export const metadata: Metadata = { title: "Meeting" };

export default function MeetingPage({ params }: PageProps<"/work/meetings/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <Meeting params={params} />
    </Suspense>
  );
}

async function Meeting({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireWorkUser();
  const meeting = await getMeeting(id);
  const agenda = meeting.current.items;
  const open = agenda.filter((i) => i.status === "open");
  const handled = agenda.filter((i) => i.status !== "open");
  const card = (item: AgendaItem, readOnly = false) => (
    <AgendaItemCard key={item.id} item={item} people={meeting.people} currentUserId={user.id} timeZone={user.timeZone} readOnly={readOnly} />
  );

  return (
    <>
      <Link
        href="/work/meetings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 pointer-coarse:min-h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Meetings
      </Link>
      <PageHeader
        eyebrow={meeting.workspace.name}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {meeting.name}
            {meeting.archived && <Badge>Archived</Badge>}
          </span>
        }
        description={
          <span className="inline-flex items-center gap-1.5">
            {meeting.visibility === "invited" ? (
              <>
                <Lock className="size-3.5" aria-hidden="true" />
                {meeting.people.map((p) => p.name).join(", ")}
              </>
            ) : (
              <>
                <Users className="size-3.5" aria-hidden="true" />
                Everyone in {meeting.workspace.name}
              </>
            )}
            <span className="text-muted/70"> · agenda since {formatDateIn(meeting.current.openedAt, user.timeZone)}</span>
          </span>
        }
        actions={
          meeting.canManage && (
            <>
              <ButtonLink href={`/work/meetings/${id}/settings`} variant="secondary">
                <Settings aria-hidden="true" />
                Settings
              </ButtonLink>
              {!meeting.archived && <CloseMeetingButton meetingId={id} openPoints={open.length} />}
            </>
          )
        }
      />

      <div className="space-y-6">
        {!meeting.archived && <AgendaQuickAdd meetingId={id} serverIds={agenda.map((i) => i.id)} autoFocus />}

        <section aria-labelledby="agenda-open" className="space-y-3">
          <h2 id="agenda-open" className="font-display text-lg font-semibold text-brand-900">
            Agenda <span className="text-sm font-normal text-muted">{open.length === 0 ? "Nothing open" : `${open.length} to discuss`}</span>
          </h2>
          {open.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted">
              No open points. Add one above, or from Claude.
            </p>
          ) : (
            <ul className="space-y-3">{open.map((i) => card(i))}</ul>
          )}
        </section>

        {handled.length > 0 && (
          <section aria-labelledby="agenda-handled" className="space-y-3">
            <h2 id="agenda-handled" className="font-display text-lg font-semibold text-brand-900">
              Handled in this meeting
            </h2>
            <ul className="space-y-3">{handled.map((i) => card(i))}</ul>
          </section>
        )}

        {meeting.history.length > 0 && (
          <section aria-labelledby="agenda-history" className="space-y-2">
            <h2 id="agenda-history" className="font-display text-lg font-semibold text-brand-900">
              Earlier meetings
            </h2>
            {meeting.history.map((round) => (
              <details key={round.id} className="rounded-2xl border border-border bg-card p-4">
                <summary className="cursor-pointer text-sm font-semibold pointer-coarse:min-h-10">
                  {formatDateIn(round.closedAt, user.timeZone)}
                  <span className="font-normal text-muted">
                    {" "}
                    · {round.items.length} {round.items.length === 1 ? "point" : "points"}
                    {round.closedBy && ` · closed by ${round.closedBy.name}`}
                  </span>
                </summary>
                {round.items.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">There were no points.</p>
                ) : (
                  <ul className="mt-3 space-y-3">{round.items.map((i) => card(i, true))}</ul>
                )}
              </details>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
