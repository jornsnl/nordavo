import { CheckSquare } from "lucide-react";
import type { AcademyLocale } from "@/lib/academy/database";
import { t } from "@/lib/academy/i18n";
import { Panel } from "@/components/academy/ui";

// ---------------------------------------------------------------------------
// SLOT: open course tasks of this placement (Academy: plaatsingspagina).
// The tasks block builder exports the real list from
// src/components/academy/tasks/. The coordinator wires it up here at merge
// time: keep the props, replace the body with the exported component.
// ---------------------------------------------------------------------------

export type PlacementOpenTasksProps = {
  placementId: string;
  /** The signed-in user (learner page) or null on the Nordavo tab. */
  userId: string | null;
  locale: AcademyLocale;
  timeZone: string;
};

export function PlacementOpenTasks({ locale }: PlacementOpenTasksProps) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <CheckSquare className="size-4 text-academy-blue-600" aria-hidden="true" />
          {t(locale, "tasks.title")}
        </span>
      }
    >
      <p className="text-sm text-muted">{t(locale, "tasks.placeholder")}</p>
    </Panel>
  );
}
