"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toggleTaskDoneAction } from "@/app/work/record-actions";
import { GO_TIMEOUT_MS, goTargetFor, isTypingTarget, moveCursor, shortcutGroups } from "@/lib/shortcuts";
import { toast } from "@/components/ui/toaster";
import { TOGGLE_SELECT_EVENT } from "@/components/work/task-selection";
import { EDIT_TASK_EVENT, getCurrentTask } from "./current-task";
import { QuickAddDialog } from "./quick-add-dialog";

const subscribeNever = () => () => {};
const useIsMac = () =>
  useSyncExternalStore(
    subscribeNever,
    () => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent),
    () => false,
  );

type RowTask = { id: string; title: string; status: string };

/** Visible task rows in the page, in order (TaskRowItem marks them with data-task-row). */
function taskRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-task-row]")).filter((el) => el.offsetParent !== null);
}

function cursorRow(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-task-row][data-cursor="true"]');
}

function rowTask(el: HTMLElement): RowTask {
  return { id: el.dataset.taskRow ?? "", title: el.dataset.taskTitle ?? "this task", status: el.dataset.taskStatus ?? "" };
}

/**
 * The keyboard shortcuts of the portal and Work (feedback Julius): q quick
 * add, / search, g + letter to jump, j/k to walk through tasks, e edit,
 * c or Enter complete, x select, ? for the list. Nothing fires while you type
 * in a field or another window is open. Mounted once by each shell, so it
 * also works in the narrow Sidepad view.
 */
export function PortalShortcuts({ onSearch, portal }: { onSearch: () => void; portal: boolean }) {
  const router = useRouter();
  const [quickAdd, setQuickAdd] = useState(false);
  const [help, setHelp] = useState(false);
  const goPending = useRef<number | null>(null);
  const handler = useRef<(event: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    handler.current = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      // Another window (a dialog or the search) has the keyboard.
      if (document.querySelector("dialog[open], [role='dialog'][aria-modal='true']:not([inert])")) return;

      const key = event.key;

      if (goPending.current !== null) {
        window.clearTimeout(goPending.current);
        goPending.current = null;
        const target = goTargetFor(key, portal);
        if (target) {
          event.preventDefault();
          router.push(target.href);
        }
        return;
      }

      switch (key) {
        case "q":
          event.preventDefault();
          setQuickAdd(true);
          return;
        case "/":
          event.preventDefault();
          onSearch();
          return;
        case "?":
          event.preventDefault();
          setHelp(true);
          return;
        case "g":
          event.preventDefault();
          goPending.current = window.setTimeout(() => (goPending.current = null), GO_TIMEOUT_MS);
          return;
        case "j":
        case "k":
        case "ArrowDown":
        case "ArrowUp": {
          const rows = taskRows();
          if (rows.length === 0) return;
          // Arrow keys only take over once a task is selected, so the page still scrolls.
          if ((key === "ArrowDown" || key === "ArrowUp") && !cursorRow()) return;
          event.preventDefault();
          const current = rows.findIndex((el) => el.dataset.cursor === "true");
          const next = moveCursor(current, key === "j" || key === "ArrowDown" ? 1 : -1, rows.length);
          rows.forEach((el, i) => {
            if (i === next) el.dataset.cursor = "true";
            else delete el.dataset.cursor;
          });
          rows[next]?.scrollIntoView({ block: "nearest" });
          return;
        }
        case "Escape": {
          const row = cursorRow();
          if (row) delete row.dataset.cursor;
          return;
        }
        case "x": {
          const row = cursorRow();
          if (!row) return;
          event.preventDefault();
          window.dispatchEvent(new CustomEvent(TOGGLE_SELECT_EVENT, { detail: row.dataset.taskRow }));
          return;
        }
        case "e": {
          const row = cursorRow();
          const task = row ? rowTask(row) : getCurrentTask();
          if (!task) return;
          event.preventDefault();
          if (row) router.push(`/work/tasks/${task.id}?edit=1`);
          else window.dispatchEvent(new Event(EDIT_TASK_EVENT));
          return;
        }
        case "c":
        case "Enter": {
          const row = cursorRow();
          // Enter on a focused link or button keeps doing what it does.
          if (key === "Enter" && (!row || (document.activeElement && document.activeElement !== document.body))) return;
          const task = row ? rowTask(row) : getCurrentTask();
          if (!task) return;
          event.preventDefault();
          if (task.status === "done") {
            toast(`"${task.title}" is already done.`, { tone: "info" });
            return;
          }
          void toggleTaskDoneAction(task.id, true)
            .then((result) => {
              if (result.error) toast(result.error, { tone: "error" });
              else toast(result.message && result.message !== "Done." ? result.message : `Done: ${task.title}`);
              router.refresh();
            })
            .catch(() => toast("Could not complete the task. Check your connection.", { tone: "error" }));
          return;
        }
      }
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => handler.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <QuickAddDialog open={quickAdd} onClose={() => setQuickAdd(false)} />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} portal={portal} />
    </>
  );
}

/** "?": every shortcut on one screen. */
function ShortcutHelp({ open, onClose, portal }: { open: boolean; onClose: () => void; portal: boolean }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const mac = useIsMac();

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className="sheet-up mx-auto mt-[8dvh] mb-auto max-h-[84dvh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-0 text-ink shadow-2xl backdrop:bg-brand-950/50"
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id={`${id}-title`} className="font-display text-lg font-semibold text-brand-900">
              Keyboard shortcuts
            </h2>
            <button
              type="button"
              onClick={onClose}
              autoFocus
              className="rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50 pointer-coarse:min-h-11"
            >
              Close
            </button>
          </div>
          <p className="mb-4 text-sm text-muted">They work on every screen, also in a narrow side panel, but not while you type in a field.</p>
          <div className="grid gap-6 sm:grid-cols-3">
            {shortcutGroups(portal, mac).map((group) => (
              <section key={group.title}>
                <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{group.title}</h3>
                <ul className="space-y-1.5">
                  {group.items.map((item) => (
                    <li key={item.keys.join("+") + item.label} className="flex items-center justify-between gap-3 text-sm">
                      <span>{item.label}</span>
                      <span className="flex shrink-0 gap-1">
                        {item.keys.map((k) => (
                          <kbd key={k} className="min-w-6 rounded-md border border-border bg-surface px-1.5 py-0.5 text-center font-sans text-xs text-ink">
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </dialog>
  );
}
