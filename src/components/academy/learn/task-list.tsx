"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Users } from "lucide-react";
import { setTaskDone } from "@/app/academy/learn-actions";
import type { AcademyLocale } from "@/lib/academy/database";
import { t } from "@/lib/academy/i18n";
import { type TaskItem, taskDeadlineText, taskDueState } from "@/lib/academy/learn/tasks";
import { formatAcademyDate } from "@/lib/academy/time";

export type { TaskItem };

const key = (item: TaskItem) => `${item.taskId}:${item.placementId ?? item.personName ?? ""}`;

/**
 * Tasks with a checkbox each. Ticking calls academy_set_task_done (own task,
 * or a shared task for the placement) and refreshes the page, so the lesson
 * and the start page show the new state. Optimistic while saving.
 */
export function TaskCheckList({
  items,
  locale,
  timeZone,
  preview = false,
  showLesson = false,
}: {
  items: TaskItem[];
  locale: AcademyLocale;
  timeZone: string;
  preview?: boolean;
  showLesson?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useOptimistic(items, (current, change: { key: string; doneAt: string | null }) =>
    current.map((item) => (key(item) === change.key ? { ...item, doneAt: change.doneAt } : item)),
  );

  function toggle(item: TaskItem, done: boolean) {
    setError(null);
    startTransition(async () => {
      setOptimistic({ key: key(item), doneAt: done ? new Date().toISOString() : null });
      const result = await setTaskDone({ taskId: item.taskId, placementId: item.placementId, done });
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  if (optimistic.length === 0) return <p className="text-sm text-muted">{t(locale, "tasks.empty")}</p>;

  return (
    <div className="space-y-2">
      {preview && <p className="text-xs text-muted">{t(locale, "tasks.preview")}</p>}
      <ul className="divide-y divide-academy-blue-100">
        {optimistic.map((item) => {
          const state = taskDueState(item.dueAt, item.doneAt);
          const id = `task-${key(item).replace(/[^\w-]/g, "-")}`;
          const relative = taskDeadlineText(item.deadlineOffsetDays, locale);
          return (
            <li key={key(item)} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <input
                id={id}
                type="checkbox"
                checked={Boolean(item.doneAt)}
                disabled={preview || !item.canTick || pending}
                onChange={(e) => toggle(item, e.target.checked)}
                className="mt-0.5 size-5 shrink-0 cursor-pointer accent-academy-orange-600 disabled:cursor-not-allowed"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor={id} className={`block text-sm font-medium ${item.doneAt ? "text-muted line-through" : "text-academy-blue-900"}`}>
                  {item.title}
                  {!item.required && <span className="ml-2 text-xs font-normal text-muted">{t(locale, "tasks.optional")}</span>}
                </label>
                {item.description && <p className="text-sm whitespace-pre-line text-muted">{item.description}</p>}
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {item.dueAt ? (
                    <span
                      className={`inline-flex items-center gap-1 ${
                        state === "overdue" ? "font-semibold text-danger" : state === "soon" ? "font-medium text-academy-orange-700" : ""
                      }`}
                    >
                      {state === "overdue" ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : <Clock className="size-3.5" aria-hidden="true" />}
                      {t(locale, "tasks.due", { date: formatAcademyDate(item.dueAt, locale, timeZone) })}
                      {state === "overdue" && ` · ${t(locale, "tasks.overdue")}`}
                      {state === "soon" && ` · ${t(locale, "tasks.soon")}`}
                    </span>
                  ) : (
                    relative && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" aria-hidden="true" />
                        {preview ? relative : t(locale, "tasks.noStart", { label: relative })}
                      </span>
                    )
                  )}
                  {item.shared && (
                    <span className="inline-flex items-center gap-1" title={t(locale, "tasks.sharedHint")}>
                      <Users className="size-3.5" aria-hidden="true" />
                      {item.placementLabel ? t(locale, "tasks.shared", { placement: item.placementLabel }) : t(locale, "tasks.sharedHint")}
                    </span>
                  )}
                  {item.personName && <span>{t(locale, "tasks.forPerson", { name: item.personName })}</span>}
                  {item.doneAt && item.doneByName && (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      {t(locale, "tasks.doneBy", { name: item.doneByName })}
                    </span>
                  )}
                  {showLesson && item.lessonTitle && (
                    item.link && item.link !== "/academy" ? (
                      <Link href={item.link} className="font-medium text-academy-blue-700 hover:underline">
                        {item.lessonTitle}
                      </Link>
                    ) : (
                      <span>{item.lessonTitle}</span>
                    )
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
