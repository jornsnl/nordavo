import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { listOverdueTasks } from "@/lib/academy/learn/admin";
import { ACADEMY_ROLES } from "@/lib/academy/people";
import { formatDate, formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Academy tasks" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="Overdue tasks"
        description="Course tasks past their deadline (start date plus the task's offset, in each person's time zone). The job academy-task-reminders sends a reminder: at most three, a week apart."
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Overdue />
      </Suspense>
    </>
  );
}

const roleLabel = (role: string | null) => (role ? (ACADEMY_ROLES.find((r) => r.value === role)?.label ?? role) : null);

async function Overdue() {
  const rows = await listOverdueTasks();
  if (rows.length === 0) {
    return <EmptyState icon={CheckSquare} title="No overdue tasks" description="Everyone is on schedule." />;
  }
  return (
    <Table>
      <THead>
        <tr>
          <TH>Task</TH>
          <TH>Who</TH>
          <TH>Deadline</TH>
          <TH>Reminded</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={`${r.task_id}:${r.profile_id ?? r.placement_id}`}>
            <TD>
              <span className="block font-medium">{r.title}</span>
              <span className="block text-xs text-muted">
                <Link href={`/dashboard/academy/lessons/${r.lesson_id}`} className="hover:underline">
                  {r.lesson_title}
                </Link>
                {!r.required && " · optional"}
              </span>
            </TD>
            <TD>
              {r.profile_id ? (
                <>
                  <Link href={`/dashboard/academy/people/${r.profile_id}`} className="font-semibold text-brand-800 hover:underline">
                    {r.person_name ?? r.person_email ?? "Unknown"}
                  </Link>
                  {roleLabel(r.academy_role) && <span className="block text-xs text-muted">{roleLabel(r.academy_role)}</span>}
                </>
              ) : (
                <>
                  <Badge tone="warning">Shared</Badge>
                  <span className="mt-1 block text-xs text-muted">{r.placement_label ?? "Placement"}</span>
                </>
              )}
            </TD>
            <TD className="whitespace-nowrap">
              <span className="block text-sm">{formatDate(r.due_at)}</span>
              <span className="block text-xs font-medium text-danger">
                {r.days_overdue <= 0 ? "Today" : `${r.days_overdue} day${r.days_overdue === 1 ? "" : "s"} late`}
              </span>
            </TD>
            <TD className="text-sm text-muted">
              {r.reminded_at ? `${r.reminder_count}× · last ${formatDateTime(r.reminded_at)}` : "Not yet"}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
