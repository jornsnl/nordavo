import type { Metadata } from "next";
import { Suspense } from "react";
import { Lightbulb } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { CaptureForm } from "@/components/content/ideas/capture-form";
import { listMyContentWorkspaces } from "@/lib/content/data";

export const metadata: Metadata = { title: "Capture an idea" };

/** One field and one tap: the fastest way to keep an idea, made for phones. */
export default function CapturePage() {
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Ideas" title="Capture an idea" description="It lands in your Ideas inbox. It never shows up as a post until you turn it into one." />
      <Suspense fallback={<ListSkeleton rows={2} />}>
        <Capture />
      </Suspense>
    </div>
  );
}

async function Capture() {
  const workspaces = (await listMyContentWorkspaces()).filter(
    (w) => !w.archived && w.modules.ideas && (w.role === "author" || w.role === "admin"),
  );
  if (workspaces.length === 0) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="No workspace for ideas"
        description="Ideas are captured in a workspace where you are the author, with the Ideas module switched on."
      />
    );
  }
  return (
    <Card>
      <CardBody>
        <CaptureForm workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))} />
      </CardBody>
    </Card>
  );
}
