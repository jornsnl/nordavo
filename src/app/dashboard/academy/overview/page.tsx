import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { getLessonFunnel, listAdminPeople, listAdminRollup, listOverviewOptions } from "@/lib/academy/ats/data";
import { ACADEMY_ROLES, isAcademyRole } from "@/lib/academy/people";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { FunnelTable } from "@/components/academy/ats/funnel-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Academy overview" };

type Params = Record<string, string | string[] | undefined>;
const UUID = /^[0-9a-f-]{36}$/i;

function one(params: Params, key: string): string | undefined {
  const v = params[key];
  const value = Array.isArray(v) ? v[0] : v;
  return value && value.trim() ? value.trim() : undefined;
}

const views = [
  { value: "person", label: "Per person" },
  { value: "client", label: "Per client company" },
  { value: "group", label: "Per candidate group" },
] as const;

export default function Page({ searchParams }: PageProps<"/dashboard/academy/overview">) {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="Overview"
        description="Progress per person, client company and candidate group: lessons, watch percentage, open and overdue tasks, assignments waiting for a reply, pulse scores (Nordavo only) and who has been inactive for 14 days. Below: where people drop out, per lesson."
      />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Overview({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const view = views.find((v) => v.value === one(params, "by"))?.value ?? "person";
  const client = one(params, "client");
  const group = one(params, "group");
  const role = one(params, "role");
  const options = await listOverviewOptions();
  const course = one(params, "course") ?? options.developerCourseId ?? options.courses[0]?.id;
  const filter = {
    clientId: client && UUID.test(client) ? client : undefined,
    groupId: group && UUID.test(group) ? group : undefined,
    role: role && isAcademyRole(role) ? role : undefined,
  };
  const inactiveOnly = one(params, "inactive") === "yes";

  return (
    <div className="space-y-6">
      <nav aria-label="View" className="flex flex-wrap gap-2">
        {views.map((v) => (
          <Link
            key={v.value}
            href={`/dashboard/academy/overview?by=${v.value}`}
            aria-current={view === v.value ? "page" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${view === v.value ? "border-brand-700 bg-brand-700 text-white" : "border-border bg-white text-ink hover:bg-brand-50"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {view === "person" ? (
        <>
          <Form action="/dashboard/academy/overview" className="grid gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
            <input type="hidden" name="by" value="person" />
            <Select name="client" defaultValue={filter.clientId ?? ""} aria-label="Client company">
              <option value="">Every client company</option>
              {options.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select name="group" defaultValue={filter.groupId ?? ""} aria-label="Group">
              <option value="">Every group</option>
              {options.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Select name="role" defaultValue={filter.role ?? ""} aria-label="Role">
              <option value="">Every role</option>
              {ACADEMY_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Select name="inactive" defaultValue={inactiveOnly ? "yes" : ""} aria-label="Activity">
              <option value="">Active and inactive</option>
              <option value="yes">Inactive 14 days</option>
            </Select>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </Form>
          <Suspense fallback={<ListSkeleton rows={6} />}>
            <People filter={filter} inactiveOnly={inactiveOnly} />
          </Suspense>
        </>
      ) : (
        <Suspense fallback={<ListSkeleton rows={6} />}>
          <Rollup by={view} />
        </Suspense>
      )}

      <Card>
        <CardHeader
          title="Where people drop out"
          description="Per lesson: how many people with access reached it, finished it, and stopped there (their furthest lesson, not finished, inactive for 14 days)."
        />
        <CardBody className="space-y-4">
          <Form action="/dashboard/academy/overview" className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
            <input type="hidden" name="by" value={view} />
            <Select name="course" defaultValue={course ?? ""} aria-label="Course">
              {options.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.status === "draft" ? " (draft)" : ""}
                </option>
              ))}
            </Select>
            <Select name="group" defaultValue={filter.groupId ?? ""} aria-label="Group">
              <option value="">Every group</option>
              {options.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Select name="client" defaultValue={filter.clientId ?? ""} aria-label="Client company">
              <option value="">Every client company</option>
              {options.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </Form>
          {course ? (
            <Suspense fallback={<ListSkeleton rows={5} />}>
              <Funnel courseId={course} groupId={filter.groupId} clientId={filter.clientId} />
            </Suspense>
          ) : (
            <p className="text-sm text-muted">No course yet.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

async function People({ filter, inactiveOnly }: { filter: { clientId?: string; groupId?: string; role?: string }; inactiveOnly: boolean }) {
  const all = await listAdminPeople(filter);
  const people = inactiveOnly ? all.filter((p) => p.inactive_14d) : all;
  const roleLabel = (role: string) => ACADEMY_ROLES.find((r) => r.value === role)?.label ?? role;
  if (people.length === 0) return <p className="text-sm text-muted">Nobody matches.</p>;
  return (
    <>
      <p className="text-sm text-muted">
        {people.length} {people.length === 1 ? "person" : "people"}, {people.filter((p) => p.inactive_14d).length} inactive for 14 days
      </p>
      <Table>
        <THead>
          <tr>
            <TH>Person</TH>
            <TH>Client</TH>
            <TH className="text-right">Lessons</TH>
            <TH className="text-right">Watched</TH>
            <TH className="text-right">Tasks open / overdue</TH>
            <TH className="text-right">Waiting</TH>
            <TH className="text-right">Pulse</TH>
            <TH>Last activity</TH>
          </tr>
        </THead>
        <TBody>
          {people.map((p) => (
            <TR key={p.profile_id}>
              <TD>
                <Link href={`/dashboard/academy/people/${p.profile_id}`} className="font-medium text-brand-900 hover:underline">
                  {p.full_name ?? p.email ?? "Unknown"}
                </Link>
                <span className="block text-xs text-muted">{roleLabel(p.academy_role)}</span>
              </TD>
              <TD className="text-muted">{p.client_name ?? "–"}</TD>
              <TD className="text-right whitespace-nowrap tabular-nums">
                {p.progress_percent}%<span className="block text-xs text-muted">{p.lessons_done}/{p.lessons_total}</span>
              </TD>
              <TD className="text-right tabular-nums">{p.watch_avg_percent !== null ? `${p.watch_avg_percent}%` : "–"}</TD>
              <TD className="text-right tabular-nums">
                {p.tasks_open} / <span className={p.tasks_overdue > 0 ? "font-semibold text-danger" : undefined}>{p.tasks_overdue}</span>
              </TD>
              <TD className="text-right tabular-nums">{p.assignments_waiting > 0 ? <Badge tone="warning">{p.assignments_waiting}</Badge> : "0"}</TD>
              <TD className="text-right whitespace-nowrap tabular-nums">
                {p.pulse_last !== null ? (
                  <span className={p.pulse_flagged ? "font-semibold text-danger" : undefined}>
                    {p.pulse_last}
                    <span className="text-xs text-muted"> avg {p.pulse_avg}</span>
                  </span>
                ) : (
                  "–"
                )}
              </TD>
              <TD className="whitespace-nowrap">
                <span className={p.inactive_14d ? "font-medium text-danger" : "text-muted"}>
                  {p.last_activity_at ? formatDate(p.last_activity_at) : "never"}
                </span>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

async function Rollup({ by }: { by: "client" | "group" }) {
  const rows = await listAdminRollup(by);
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <Table>
      <THead>
        <tr>
          <TH>{by === "client" ? "Client company" : "Group"}</TH>
          <TH className="text-right">People</TH>
          <TH className="text-right">Avg progress</TH>
          <TH className="text-right">All lessons done</TH>
          <TH className="text-right">Inactive 14 days</TH>
          <TH className="text-right">Tasks open / overdue</TH>
          <TH className="text-right">Waiting</TH>
          <TH className="text-right">Pulse avg</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.key_id}>
            <TD>
              <Link
                href={by === "client" ? `/dashboard/academy/overview?by=person&client=${r.key_id}` : `/dashboard/academy/groups/${r.key_id}`}
                className="font-medium text-brand-900 hover:underline"
              >
                {r.name}
              </Link>
            </TD>
            <TD className="text-right tabular-nums">{r.people}</TD>
            <TD className="text-right tabular-nums">{r.avg_progress !== null ? `${r.avg_progress}%` : "–"}</TD>
            <TD className="text-right tabular-nums">{r.completed}</TD>
            <TD className="text-right tabular-nums">
              <span className={r.inactive > 0 ? "font-semibold text-danger" : undefined}>{r.inactive}</span>
            </TD>
            <TD className="text-right tabular-nums">
              {r.tasks_open} / <span className={r.tasks_overdue > 0 ? "font-semibold text-danger" : undefined}>{r.tasks_overdue}</span>
            </TD>
            <TD className="text-right tabular-nums">{r.assignments_waiting}</TD>
            <TD className="text-right tabular-nums">
              {r.pulse_avg ?? "–"}
              {r.pulse_flagged > 0 && <span className="ml-1 text-xs text-danger">({r.pulse_flagged} flagged)</span>}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

async function Funnel({ courseId, groupId, clientId }: { courseId: string; groupId?: string; clientId?: string }) {
  const rows = await getLessonFunnel(courseId, { groupId, clientId });
  return <FunnelTable rows={rows} />;
}
