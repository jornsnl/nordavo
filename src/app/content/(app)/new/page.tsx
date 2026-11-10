import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { ActionForm } from "@/components/content/settings/forms";
import { requireContentUser } from "@/lib/content/data";
import { listContentCandidates } from "@/lib/content/settings";
import { createContentWorkspaceAction } from "@/app/content/actions/settings";

export const metadata: Metadata = { title: "New workspace" };

export default function NewWorkspacePage() {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <NewWorkspace />
    </Suspense>
  );
}

async function NewWorkspace() {
  const user = await requireContentUser();
  if (!user.isAdmin) redirect("/content");
  const people = await listContentCandidates();
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="New content workspace"
        description="Every employee gets their own workspace, with its own ideas, posts, series, media, rhythm goal and settings. The owner becomes its author."
      />
      <Card className="max-w-2xl">
        <CardBody>
          <ActionForm action={createContentWorkspaceAction} submit="Create workspace">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="nw_name" required>
                <Input id="nw_name" name="name" required maxLength={80} placeholder="Floris" />
              </Field>
              <Field label="Web address" htmlFor="nw_slug" required hint="/content/w/<address>">
                <Input id="nw_slug" name="slug" required maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="floris" />
              </Field>
              <Field label="Owner (author)" htmlFor="nw_owner" className="sm:col-span-2">
                <Select id="nw_owner" name="owner" defaultValue="">
                  <option value="">Nobody yet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.email ? `(${p.email})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
