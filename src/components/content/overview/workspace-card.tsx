import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { BufferMeter, RhythmStat, formatDay } from "@/components/content/planning/meters";
import type { WorkspaceStats } from "@/lib/content/planning";
import type { WorkspaceWithSettings } from "@/lib/content/planning";
import { roleLabel } from "@/lib/content/rules";

/** One workspace on the overview: buffer, this week, next post. */
export function WorkspaceCard({ workspace, stats }: { workspace: WorkspaceWithSettings; stats: WorkspaceStats }) {
  const role = roleLabel(workspace.role);
  return (
    <Link
      href={`/content/w/${workspace.slug}`}
      className="block h-full rounded-2xl border border-border bg-card p-4 shadow-xs transition hover:border-brand-200 hover:shadow-sm"
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <h2 className="font-display font-semibold text-brand-900">{workspace.name}</h2>
        <Badge tone={role.tone}>{role.label}</Badge>
      </div>
      {stats.tomorrowUnapproved.length > 0 && (
        <p className="mb-3 rounded-lg bg-danger-bg px-3 py-2 text-xs font-semibold text-danger">
          Tomorrow: {stats.tomorrowUnapproved.length} post{stats.tomorrowUnapproved.length > 1 ? "s" : ""} not approved yet
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <BufferMeter count={stats.buffer} min={workspace.bufferMin} max={workspace.bufferMax} state={stats.bufferState} compact />
        <RhythmStat label="This week" rhythm={stats.thisWeek} />
      </div>
      <p className="mt-4 truncate border-t border-border pt-3 text-sm text-muted">
        Next post:{" "}
        {stats.nextPost ? (
          <span className="font-medium text-ink">
            {formatDay(stats.nextPost.plannedDate!)} · {stats.nextPost.title}
          </span>
        ) : (
          "nothing planned"
        )}
      </p>
    </Link>
  );
}
