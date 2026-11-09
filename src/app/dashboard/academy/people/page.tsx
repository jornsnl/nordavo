import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { PEOPLE_PAGE, listCandidateOptions, listClientOptions, listCourseOptions, listGroups, listPeople } from "@/lib/academy/admin";
import { ACADEMY_ROLES, isAcademyRole } from "@/lib/academy/people";
import { formatDate, formatRelativeDays } from "@/lib/format";
import { hasAdminClient } from "@/lib/supabase/admin";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddPeopleBulkForm, AddPersonForm } from "@/components/academy/admin/add-people";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Academy people" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="People"
        description="Only Nordavo adds people. They get a mail with a link to sign in; same login as the rest of the portal."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Suspense fallback={<ListSkeleton rows={6} />}>
          <People searchParams={searchParams} />
        </Suspense>
        <Suspense fallback={<ListSkeleton rows={4} />}>
          <AddForms />
        </Suspense>
      </div>
    </>
  );
}

const roleLabel = (role: string) => ACADEMY_ROLES.find((r) => r.value === role)?.label ?? role;

async function People({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q : "";
  const role = typeof params.role === "string" && isAcademyRole(params.role) ? params.role : "";
  const group = typeof params.group === "string" ? params.group : "";
  const [people, courses, groups] = await Promise.all([
    listPeople({ search, role: role || undefined, groupId: group || undefined }),
    listCourseOptions(),
    listGroups(),
  ]);
  const courseTitle = new Map(courses.map((c) => [c.id, c.title]));

  return (
    <section className="min-w-0 space-y-4">
      <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]">
        <Input name="q" defaultValue={search} placeholder="Search name or email" aria-label="Search" />
        <Select name="role" defaultValue={role} aria-label="Role">
          <option value="">Every role</option>
          {ACADEMY_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        <Select name="group" defaultValue={group} aria-label="Group">
          <option value="">Every group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <button type="submit" className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-brand-900 hover:bg-brand-50">
          Filter
        </button>
      </form>
      {people.length === 0 ? (
        <EmptyState icon={Users} title="Nobody here yet" description="Add people one by one or in bulk on the right." />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Courses</TH>
                <TH>Start</TH>
                <TH>Last active</TH>
              </tr>
            </THead>
            <TBody>
              {people.map((p) => (
                <TR key={p.profile_id}>
                  <TD>
                    <Link href={`/dashboard/academy/people/${p.profile_id}`} className="font-semibold text-brand-800 hover:underline">
                      {p.fullName ?? p.email ?? "Unknown"}
                    </Link>
                    <span className="block text-xs text-muted">{p.email}</span>
                  </TD>
                  <TD>
                    <Badge tone={p.academy_role.startsWith("client") ? "brand" : p.academy_role === "developer" ? "success" : "neutral"}>
                      {roleLabel(p.academy_role)}
                    </Badge>
                  </TD>
                  <TD className="text-sm">{p.courseIds.map((id) => courseTitle.get(id)).filter(Boolean).join(", ") || <span className="text-muted">None</span>}</TD>
                  <TD className="whitespace-nowrap">{formatDate(p.start_date, "Not set")}</TD>
                  <TD className="whitespace-nowrap text-muted">{p.last_active_at ? formatRelativeDays(p.last_active_at) : "Never"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {people.length >= PEOPLE_PAGE && <p className="text-xs text-muted">The {PEOPLE_PAGE} most recently added; search to find others.</p>}
        </>
      )}
    </section>
  );
}

async function AddForms() {
  const [courses, clients, candidates] = await Promise.all([listCourseOptions(), listClientOptions(), listCandidateOptions(null)]);
  const options = { courses, clients, candidates, canCreateAccounts: hasAdminClient() };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Add a person" />
        <CardBody>
          <AddPersonForm options={options} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Add in bulk" description="Paste a list or choose a CSV; everyone gets the same role, course and open modules." />
        <CardBody>
          <AddPeopleBulkForm options={options} />
        </CardBody>
      </Card>
    </div>
  );
}
