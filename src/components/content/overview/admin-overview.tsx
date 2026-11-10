import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { WorkspaceStats, WorkspaceWithSettings } from "@/lib/content/planning";
import { monthlyGoal, type WorkspaceResults } from "@/lib/content/results";

export type AdminRow = {
  workspace: WorkspaceWithSettings;
  stats: WorkspaceStats;
  publishedThisMonth: number;
  results: WorkspaceResults;
};

const tone = (good: boolean) => (good ? "text-emerald-700" : "text-danger");

/** Every workspace side by side: rhythm, buffer and results. */
export function AdminOverview({ rows }: { rows: AdminRow[] }) {
  return (
    <Card>
      <CardHeader title="All workspaces" description="Rhythm this month, buffer ready ahead and 7 day results of the last 30 days." />
      <CardBody className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 pr-3 font-medium">Workspace</th>
              <th className="py-1.5 pr-3 text-right font-medium">Published this month</th>
              <th className="py-1.5 pr-3 text-right font-medium">This week</th>
              <th className="py-1.5 pr-3 text-right font-medium">Buffer</th>
              <th className="py-1.5 pr-3 text-right font-medium">Avg likes + comments</th>
              <th className="py-1.5 text-right font-medium">Success rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ workspace, stats, publishedThisMonth, results }) => {
              const goal = monthlyGoal(workspace.rhythmGoal);
              return (
                <tr key={workspace.id}>
                  <td className="py-2 pr-3">
                    <Link href={`/content/w/${workspace.slug}`} className="font-medium text-ink hover:underline">
                      {workspace.name}
                    </Link>
                    {stats.tomorrowUnapproved.length > 0 && <span className="ml-2 text-xs font-semibold text-danger">tomorrow not approved</span>}
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${tone(publishedThisMonth >= goal)}`}>
                    {publishedThisMonth} / {goal}
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${tone(stats.thisWeek.onTrack)}`}>
                    {stats.thisWeek.planned} / {stats.thisWeek.goal}
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${tone(stats.bufferState !== "low")}`}>
                    {stats.buffer} <span className="text-muted">({workspace.bufferMin} to {workspace.bufferMax})</span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{results.avgEngagement ?? "–"}</td>
                  <td className="py-2 text-right tabular-nums">
                    {results.successRate === null ? "–" : `${results.successRate}%`}
                    {results.measured > 0 && <span className="text-xs text-muted"> of {results.measured}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
