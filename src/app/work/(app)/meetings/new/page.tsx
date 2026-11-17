import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { MeetingForm } from "@/components/work/meeting-forms";
import { createMeetingAction } from "@/app/work/meeting-actions";
import { listMembers, requireWorkUser } from "@/lib/work/data";
import { listMeetingWorkspaces } from "@/lib/work/meeting-data";

export const metadata: Metadata = { title: "New meeting" };

export default function NewMeetingPage() {
  return (
    <>
      <PageHeader eyebrow="Meetings" title="New meeting" description="One agenda per recurring meeting, with its own people." />
      <Suspense fallback={null}>
        <NewMeeting />
      </Suspense>
    </>
  );
}

async function NewMeeting() {
  const user = await requireWorkUser();
  const workspaces = await listMeetingWorkspaces();
  const options = await Promise.all(
    workspaces.map(async (w) => ({
      id: w.id,
      name: w.name,
      people: (await listMembers(w.id)).filter((m) => !m.deactivatedAt).map((m) => ({ id: m.id, name: m.name })),
    })),
  );
  if (options.length === 0) {
    return <p className="text-sm text-muted">You are not in a workspace where you can start a meeting.</p>;
  }
  return (
    <Card className="max-w-xl">
      <CardBody className="py-5">
        <MeetingForm action={createMeetingAction} workspaces={options} currentUserId={user.id} submitLabel="Create meeting" />
      </CardBody>
    </Card>
  );
}
