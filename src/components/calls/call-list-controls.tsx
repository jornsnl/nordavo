"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, GripVertical, ListPlus, LoaderCircle, Undo2, Users, X } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { formatDate, todayIso } from "@/lib/format";
import {
  closeCallerList,
  moveCallerList,
  saveCallerOrder,
  setCallList,
  setListCallers,
  unassignCaller,
} from "@/app/dashboard/call-lists/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { CallerOption } from "./assign-callers-dialog";

/** Admins: open a call list for one or more callers until a date. */
export function ListCallersButton({
  viewId,
  listName,
  callers,
  openFor,
}: {
  viewId: string;
  listName: string;
  callers: CallerOption[];
  /** Callers the list is open for now, with their end date. */
  openFor: { callerId: string; openUntil: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(openFor.map((o) => o.callerId));
  const [until, setUntil] = useState(openFor.find((o) => o.openUntil)?.openUntil ?? "");
  const [result, setResult] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  function save() {
    setResult({});
    startTransition(async () => {
      const r = await setListCallers(viewId, picked, until || null);
      setResult(r);
      if (r.ok) setOpen(false);
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setPicked(openFor.map((o) => o.callerId));
          setUntil(openFor.find((o) => o.openUntil)?.openUntil ?? "");
          setResult({});
          setOpen(true);
        }}
      >
        <Users aria-hidden="true" />
        Open for callers
      </Button>
      <Modal open={open} onClose={() => !pending && setOpen(false)} title={`Open ${listName} for callers`} description="Ticked callers get this list in their queue until the date. Unticked callers lose it.">
        <div className="space-y-5">
          {callers.length === 0 ? (
            <p className="text-sm text-muted">There are no active callers. Add one in Settings, Callers.</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-ink">Callers</legend>
              {callers.map((c) => (
                <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-700"
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((id) => id !== c.id))}
                  />
                  <span className="font-medium text-ink">{c.name}</span>
                  {c.party && <span className="text-muted">{c.party}</span>}
                </label>
              ))}
            </fieldset>
          )}
          <Field label="Open until" htmlFor={`until-${viewId}`} hint="Empty keeps the list open until you close it.">
            <Input id={`until-${viewId}`} type="date" min={todayIso()} value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
          <FormMessage error={result.error} />
          <div className="flex justify-end max-sm:*:w-full">
            <Button onClick={save} disabled={pending} aria-busy={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/**
 * Admins: the order in which one caller works through their lists, by
 * dragging (mouse or touch) or with the up and down buttons.
 */
export function CallerListOrder({
  callerId,
  lists,
}: {
  callerId: string;
  lists: { viewId: string; name: string; openUntil: string | null; expired: boolean }[];
}) {
  const [order, setOrder] = useState(lists);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<ActionState>) {
    setError(undefined);
    startTransition(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        setOrder(lists);
      }
    });
  }

  function move(viewId: string, direction: "up" | "down") {
    const i = order.findIndex((l) => l.viewId === viewId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    run(() => moveCallerList(callerId, viewId, direction));
  }

  function dropOn(target: string) {
    if (!dragging || dragging === target) return;
    const next = order.filter((l) => l.viewId !== dragging);
    const at = next.findIndex((l) => l.viewId === target);
    next.splice(at, 0, order.find((l) => l.viewId === dragging)!);
    setOrder(next);
    setDragging(null);
    run(() => saveCallerOrder(callerId, next.map((l) => l.viewId)));
  }

  if (order.length === 0) return <p className="text-sm text-muted">No lists open.</p>;

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {order.map((l, i) => (
          <li
            key={l.viewId}
            draggable
            onDragStart={() => setDragging(l.viewId)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dropOn(l.viewId)}
            className={`flex items-center gap-2 rounded-xl border border-border bg-white px-2 py-1.5 text-sm ${dragging === l.viewId ? "opacity-50" : ""}`}
          >
            <GripVertical className="size-4 shrink-0 cursor-grab text-muted max-sm:hidden" aria-hidden="true" />
            <span className="w-5 shrink-0 text-center text-xs text-muted tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{l.name}</span>
              <span className={`block text-xs ${l.expired ? "text-danger" : "text-muted"}`}>
                {l.openUntil ? `${l.expired ? "Ended" : "Until"} ${formatDate(l.openUntil)}` : "No end date"}
              </span>
            </span>
            <span className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => move(l.viewId, "up")}
                disabled={pending || i === 0}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-ink disabled:opacity-30"
                aria-label={`Move ${l.name} up`}
              >
                <ArrowUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => move(l.viewId, "down")}
                disabled={pending || i === order.length - 1}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-ink disabled:opacity-30"
                aria-label={`Move ${l.name} down`}
              >
                <ArrowDown className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setOrder(order.filter((x) => x.viewId !== l.viewId));
                  run(() => closeCallerList(callerId, l.viewId));
                }}
                disabled={pending}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger disabled:opacity-30"
                aria-label={`Close ${l.name} for this caller`}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <FormMessage error={error} />
    </div>
  );
}

/** Marks a saved Contacts view as a call list, or back. */
export function CallListToggle({ viewId, isCallList }: { viewId: string; isCallList: boolean }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={isCallList ? "ghost" : "secondary"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await setCallList(viewId, !isCallList);
            setError(r.error);
          })
        }
      >
        {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : isCallList ? <Undo2 aria-hidden="true" /> : <ListPlus aria-hidden="true" />}
        {isCallList ? "No longer a call list" : "Use as call list"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/** Admins: give back every contact assigned to a caller. */
export function UnassignCallerButton({ callerId, count }: { callerId: string; count: number }) {
  const [result, setResult] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  if (count === 0) return null;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => setResult(await unassignCaller(callerId)))}>
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        Take back
      </Button>
      {result.error && <span className="text-xs text-danger">{result.error}</span>}
    </span>
  );
}
