import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getPerson } from "@/lib/academy/admin";
import { ACADEMY_ROLES } from "@/lib/academy/people";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { PersonAccess, PersonGroups, PersonSettingsForm } from "@/components/academy/admin/person-forms";
import { PersonLearningCards } from "@/components/academy/learn/person-learning";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Academy person" };

export default function Page({ params }: PageProps<"/dashboard/academy/people/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <Person params={params} />
    </Suspense>
  );
}

async function Person({ params }: Pick<PageProps<"/dashboard/academy/people/[id]">, "params">) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const detail = await getPerson(id);
  if (!detail) notFound();
  const { person } = detail;
  const role = ACADEMY_ROLES.find((r) => r.value === person.academy_role);
  return (
    <>
      <PageHeader
        eyebrow="Academy · People"
        title={person.fullName ?? person.email ?? "Unknown"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{role?.label ?? person.academy_role}</Badge>
            <span>{person.email}</span>
            <span className="text-xs">
              {person.timeZone} · invited {person.invited_at ? formatDateTime(person.invited_at) : "not yet"}
              {person.last_active_at ? ` · last active ${formatDateTime(person.last_active_at)}` : ""}
            </span>
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader
              title="Courses and open modules"
              description="Completed progress always stays, also when access or open modules change."
            />
            <CardBody>
              <PersonAccess detail={detail} />
            </CardBody>
          </Card>
          {/* Area learn: knowledge checks, assignments, tasks, questionnaire. */}
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <PersonLearningCards profileId={person.profile_id} />
          </Suspense>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Settings" description={role?.description} />
            <CardBody>
              <PersonSettingsForm detail={detail} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Groups" />
            <CardBody>
              <PersonGroups detail={detail} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
