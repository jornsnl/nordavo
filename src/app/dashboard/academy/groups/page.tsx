import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { UsersRound } from "lucide-react";
import { listCourseOptions, listGroups } from "@/lib/academy/admin";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { DeleteGroupButton, GroupForm } from "@/components/academy/admin/group-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Academy groups" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="Candidate groups"
        description="Groups per vacancy, month or campaign. Give a group access to a course from the course editor; add people to a group on their page."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <Groups />
          </Suspense>
        </div>
        <Card>
          <CardHeader title="New group" />
          <CardBody>
            <GroupForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

async function Groups() {
  const [groups, courses] = await Promise.all([listGroups(), listCourseOptions()]);
  if (groups.length === 0) {
    return <EmptyState icon={UsersRound} title="No groups yet" description="Make the first group on the right." />;
  }
  const courseTitle = new Map(courses.map((c) => [c.id, c.title]));
  return (
    <ul className="space-y-3">
      {groups.map((g) => (
        <li key={g.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-xs">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/dashboard/academy/people?group=${g.id}`} className="font-semibold text-brand-900 hover:underline">
                {g.name}
              </Link>
              <Badge tone="neutral">{g.kind}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {g.memberIds.length} {g.memberIds.length === 1 ? "person" : "people"}
              {g.courseIds.length > 0 && ` · ${g.courseIds.map((id) => courseTitle.get(id)).filter(Boolean).join(", ")}`}
            </p>
            {g.description && <p className="mt-1 text-sm text-muted">{g.description}</p>}
          </div>
          <DeleteGroupButton id={g.id} name={g.name} />
        </li>
      ))}
    </ul>
  );
}
