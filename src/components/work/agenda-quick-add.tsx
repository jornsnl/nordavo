"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Clock, Plus } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { isAvailable, listDirty, type DirtyEntry } from "@/lib/offline/db";
import type { PendingAgendaItem } from "@/lib/offline/agenda-changes";
import { onLocalChange, submitAgendaItem } from "@/lib/offline/sync";

/**
 * Dump a point on the agenda in one line: a title, Enter. Works on a phone
 * and without a connection: the point gets its id here, waits in the outbox
 * and reaches the server once. Points that are still on their way show
 * underneath until the server's own list has them.
 */
export function AgendaQuickAdd({
  meetingId,
  serverIds,
  autoFocus = false,
}: {
  meetingId: string;
  /** Ids of the points the server already lists, so a sent point is not shown twice. */
  serverIds: string[];
  autoFocus?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pending = usePendingAgenda(meetingId, serverIds);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = input.current?.value.trim() ?? "";
    if (!title) return;
    setBusy(true);
    try {
      await submitAgendaItem({
        op: "agenda.add",
        payload: { id: crypto.randomUUID(), meeting_id: meetingId, title: title.slice(0, 300), at: new Date().toISOString() },
      });
      if (input.current) input.current.value = "";
      if (!navigator.onLine) toast("Saved on this device. It is sent when you are back online.", { tone: "info" });
    } catch {
      toast("This point could not be saved on this device.", { tone: "error" });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={add} className="flex min-w-0 items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-xs">
        <label htmlFor={inputId} className="sr-only">
          New agenda point
        </label>
        <input
          id={inputId}
          ref={input}
          name="title"
          required
          maxLength={300}
          placeholder="Add a point for this meeting"
          enterKeyHint="done"
          autoComplete="off"
          autoFocus={autoFocus}
          className="min-w-0 flex-1 rounded-xl bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted/70"
        />
        <button
          type="submit"
          disabled={busy}
          aria-label="Add point"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      </form>
      {pending.length > 0 && (
        <ul className="space-y-1.5" aria-label="Points waiting to be sent">
          {pending.map((p) => (
            <li key={p.item.id} className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-3 py-2 text-sm text-muted">
              <Clock className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{p.item.title}</span>
              <span className="text-xs">{p.sent ? "Saved" : "Waiting to be sent"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Points of this meeting made on this device that the server does not list yet. */
function usePendingAgenda(meetingId: string, serverIds: string[]): { item: PendingAgendaItem; sent: boolean }[] {
  const [entries, setEntries] = useState<DirtyEntry<PendingAgendaItem>[]>([]);
  useEffect(() => {
    if (!isAvailable()) return;
    let live = true;
    let latest = 0;
    const load = () => {
      const mine = ++latest;
      return listDirty<PendingAgendaItem>("agenda")
        .then((all) => live && mine === latest && setEntries(all))
        .catch(() => {});
    };
    load();
    const off = onLocalChange(load);
    return () => {
      live = false;
      off();
    };
  }, []);
  const known = new Set(serverIds);
  return entries
    .flatMap((e) => (e.data && e.data.meetingId === meetingId && !known.has(e.id) ? [{ item: e.data, sent: e.pending === 0 && e.syncedAt !== null }] : []))
    .sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt));
}
