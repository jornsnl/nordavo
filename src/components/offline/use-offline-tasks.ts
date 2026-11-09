"use client";

import { useEffect, useMemo, useState } from "react";
import { isAvailable, listDirty, saveRecords, type DirtyEntry } from "@/lib/offline/db";
import { matchesView, overlay, type TaskView } from "@/lib/offline/overlay";
import { onLocalChange } from "@/lib/offline/sync";
import type { TaskListItem } from "@/lib/work/data";

/**
 * A task list as this device has it: the server's list with the tasks
 * changed here (and not yet confirmed) laid over it, and the ones made here
 * added. `view` says which tasks the list shows, so a task that no longer
 * fits (done, in a filtered list) goes and a new one lands where it belongs.
 * The server's list is also kept on the device, for offline.
 */
export function useOfflineTasks(server: TaskListItem[], view?: TaskView): TaskListItem[] {
  const [dirty, setDirty] = useState<DirtyEntry<TaskListItem>[]>([]);

  useEffect(() => {
    if (!isAvailable()) return;
    let live = true;
    const load = () =>
      listDirty<TaskListItem>("task")
        .then((entries) => live && setDirty(entries))
        .catch(() => {});
    load();
    const off = onLocalChange(load);
    return () => {
      live = false;
      off();
    };
  }, []);

  useEffect(() => {
    // A list shown while offline came from the device itself: nothing new to keep.
    if (!isAvailable() || !navigator.onLine || server.length === 0) return;
    saveRecords("task", server, (t) => t.id).catch(() => {});
  }, [server]);

  const key = JSON.stringify(view ?? null);
  return useMemo(() => {
    const fits = view ? (task: TaskListItem) => matchesView(task, view) : undefined;
    return overlay(server, dirty, fits);
    // The view is compared by value: pages pass a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, dirty, key]);
}
