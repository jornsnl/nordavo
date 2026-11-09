import { CheckSquare } from "lucide-react";
import type { AcademyUser } from "@/lib/academy/auth";
import { t } from "@/lib/academy/i18n";
import { getPlacementTasks, placementTaskItem } from "@/lib/academy/learn/data";
import { sortTasks } from "@/lib/academy/learn/tasks";
import { Panel } from "@/components/academy/ui";
import { TaskCheckList } from "./task-list";

/**
 * Open course tasks of one placement, for the placement page: the shared
 * tasks (the client ticks them off, the developer and Nordavo see them) and
 * the placement-only tasks of its people. Server component; render it inside
 * a <Suspense> boundary. Set showDone to list done tasks too.
 *
 *   import { PlacementTasksPanel } from "@/components/academy/learn/placement-tasks";
 *   <PlacementTasksPanel placementId={placement.id} user={user} />
 */
export async function PlacementTasksPanel({ placementId, user, showDone = false }: { placementId: string; user: AcademyUser; showDone?: boolean }) {
  const rows = await getPlacementTasks(placementId);
  const items = sortTasks(rows.filter((r) => showDone || !r.done_at).map((r) => ({ ...placementTaskItem(r, placementId), due_at: r.due_at, done_at: r.done_at })));
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <CheckSquare className="size-4 text-academy-blue-600" aria-hidden="true" />
          {t(user.locale, "home.openTasks")}
        </span>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t(user.locale, "tasks.allDone")}</p>
      ) : (
        <TaskCheckList items={items} locale={user.locale} timeZone={user.timeZone} preview={user.isManager && !user.member} showLesson />
      )}
    </Panel>
  );
}
