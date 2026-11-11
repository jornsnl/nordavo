import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { NewWorkspaceForm } from "@/components/work/new-workspace-form";
import { createPrivateWorkspaceAction, createWorkspaceAction } from "@/app/work/actions";
import { canCreatePrivateWorkspace, canCreateWorkspace } from "@/lib/work/data";

export const metadata: Metadata = { title: "New workspace" };

/**
 * A shared workspace is one organisation (portal admins). A private one
 * (?kind=private) is yours alone: every team member can make several, and
 * nobody else sees them, other admins included.
 */
export default function NewWorkspacePage({ searchParams }: PageProps<"/work/new">) {
  return (
    <Suspense fallback={null}>
      <Gate searchParams={searchParams} />
    </Suspense>
  );
}

async function Gate({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { kind } = await searchParams;
  const [shared, own] = await Promise.all([canCreateWorkspace(), canCreatePrivateWorkspace()]);
  const isPrivate = kind === "private" || !shared;
  if (isPrivate ? !own : !shared) notFound();
  return (
    <>
      <PageHeader
        eyebrow="Work"
        title={isPrivate ? "New private workspace" : "New workspace"}
        description={
          isPrivate
            ? "Only you can see a private workspace, other admins included. Use it for your own projects, at work or at home."
            : "A workspace is one organisation, like Nordavo or KG. Workspaces are fully separate from each other."
        }
      />
      <Card className="max-w-xl">
        <CardBody className="py-5">
          <NewWorkspaceForm action={isPrivate ? createPrivateWorkspaceAction : createWorkspaceAction} kind={isPrivate ? "private" : "shared"} />
        </CardBody>
      </Card>
    </>
  );
}
