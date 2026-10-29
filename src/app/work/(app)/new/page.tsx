import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { NewWorkspaceForm } from "@/components/work/new-workspace-form";
import { createWorkspaceAction } from "@/app/work/actions";
import { canCreateWorkspace } from "@/lib/work/data";

export const metadata: Metadata = { title: "New workspace" };

export default function NewWorkspacePage() {
  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="New workspace"
        description="A workspace is one organisation, like Nordavo or KG. Workspaces are fully separate from each other."
      />
      <Suspense fallback={null}>
        <Gate />
      </Suspense>
    </>
  );
}

async function Gate() {
  if (!(await canCreateWorkspace())) notFound();
  return (
    <Card className="max-w-xl">
      <CardBody className="py-5">
        <NewWorkspaceForm action={createWorkspaceAction} />
      </CardBody>
    </Card>
  );
}
