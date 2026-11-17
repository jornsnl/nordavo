import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { MeetingForm } from "@/components/work/meeting-forms";
import { updateMeetingAction } from "@/app/work/meeting-actions";
import { listMembers, requireWorkUser } from "@/lib/work/data";
import { getMeeting } from "@/lib/work/meeting-data";

export const metadata: Metadata = { title: "Meeting settings" };

export default function MeetingSettingsPage({ params }: PageProps<"/work/meetings/[id]/settings">) {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireWorkUser();
  const meeting = await getMeeting(id);
  if (!meeting.canManage) notFound();
  const members = (await listMembers(meeting.workspace.id)).filter((m) => !m.deactivatedAt);

  return (
    <>
      <Link
        href={`/work/meetings/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 pointer-coarse:min-h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {meeting.name}
      </Link>
      <PageHeader eyebrow={meeting.workspace.name} title="Meeting settings" />
      <Card className="max-w-xl">
        <CardBody className="py-5">
          <MeetingForm
            action={updateMeetingAction.bind(null, id)}
            workspaces={[{ id: meeting.workspace.id, name: meeting.workspace.name, people: members.map((m) => ({ id: m.id, name: m.name })) }]}
            defaults={{
              workspaceId: meeting.workspace.id,
              name: meeting.name,
              visibility: meeting.visibility,
              picked: meeting.picked,
              archived: meeting.archived,
            }}
            currentUserId={meeting.createdBy ?? user.id}
            showArchive
            submitLabel="Save"
          />
        </CardBody>
      </Card>
    </>
  );
}
