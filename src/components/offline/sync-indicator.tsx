"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, CloudOff, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  clearRejected,
  isAvailable,
  listMeta,
  listOutbox,
  listRejected,
  type MetaEntry,
  type OutboxEntry,
  type RejectedEntry,
} from "@/lib/offline/db";
import { flush, getSyncState, onLocalChange, refreshState, subscribeSync, type SyncState } from "@/lib/offline/sync";
import { listCachedPages, type CachedPage } from "@/lib/offline/worker";

const SERVER_STATE: SyncState = { phase: "synced", pending: 0, rejected: 0, lastSyncedAt: null };

const kindLabel: Record<MetaEntry["kind"], string> = { task: "Work tasks" };

function when(ms: number | null) {
  if (!ms) return "";
  const date = new Date(ms);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function pageName(url: string) {
  const u = new URL(url);
  const path = `${u.pathname}${u.search}`;
  const names: Record<string, string> = {
    "/work": "My tasks",
    "/work?view=board": "My tasks, board",
    "/work/log": "Quick log",
    "/dashboard": "Overview",
    "/dashboard/leads": "Leads",
    "/dashboard/vacancies": "Vacancies",
    "/dashboard/candidates": "Candidates",
    "/dashboard/clients": "Clients",
  };
  return names[path] ?? path;
}

/**
 * The sync state in the top bar: a green tick when everything is on the
 * server, a spinner while sending, "Offline" with the number of waiting
 * changes, and refused changes in red. Tapping it shows what this device
 * keeps, which pages open offline and what needs a connection.
 */
export function SyncIndicator({ tone = "light" }: { tone?: "light" | "dark" }) {
  const state = useSyncExternalStore(subscribeSync, getSyncState, () => SERVER_STATE);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void refreshState();
  }, []);

  const { phase, pending, rejected } = state;
  const Icon = rejected > 0 ? TriangleAlert : phase === "syncing" ? Loader2 : phase === "offline" ? CloudOff : CheckCircle2;
  const label =
    phase === "syncing"
      ? "Syncing"
      : phase === "offline"
        ? pending > 0
          ? `Offline, ${pending} waiting`
          : "Offline"
        : pending > 0
          ? `${pending} waiting`
          : "Synced";
  const color =
    rejected > 0
      ? "text-danger"
      : phase === "offline"
        ? tone === "dark"
          ? "text-accent-500"
          : "text-amber-700"
        : phase === "syncing"
          ? tone === "dark"
            ? "text-brand-100"
            : "text-brand-700"
          : tone === "dark"
            ? "text-emerald-300"
            : "text-emerald-700";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${label}${rejected > 0 ? `, ${rejected} not saved` : ""}. Show what this device keeps`}
        data-sync-phase={phase}
        className={`flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-brand-500 ${color} ${
          tone === "dark" ? "hover:bg-white/10" : "hover:bg-brand-50"
        }`}
      >
        <Icon className={`size-4 shrink-0 ${phase === "syncing" ? "animate-spin" : ""}`} aria-hidden="true" />
        <span aria-hidden="true">{label}</span>
        {rejected > 0 && (
          <span aria-hidden="true" className="rounded-full bg-danger px-1.5 text-[10px] text-white">
            {rejected}
          </span>
        )}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="On this device" description={describe(state)}>
        {open && <SyncPanel state={state} />}
      </Modal>
    </>
  );
}

function describe({ phase, pending, lastSyncedAt }: SyncState) {
  if (phase === "syncing") return "Sending your changes to the server.";
  if (phase === "offline") {
    return pending > 0
      ? `No connection. ${pending} change${pending === 1 ? " waits" : "s wait"} and ${pending === 1 ? "is" : "are"} sent when you are back online.`
      : "No connection. The pages below still open.";
  }
  return lastSyncedAt ? `Everything is on the server (last sent ${when(lastSyncedAt)}).` : "Everything is on the server.";
}

function SyncPanel({ state }: { state: SyncState }) {
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [rejected, setRejected] = useState<RejectedEntry[]>([]);
  const [meta, setMeta] = useState<MetaEntry[]>([]);
  const [pages, setPages] = useState<CachedPage[] | null>(null);

  useEffect(() => {
    if (!isAvailable()) return;
    let live = true;
    const load = () =>
      Promise.all([listOutbox(), listRejected(), listMeta()])
        .then(([o, r, m]) => {
          if (!live) return;
          setOutbox(o);
          setRejected(r);
          setMeta(m);
        })
        .catch(() => {});
    load();
    void listCachedPages().then((p) => live && setPages(p));
    const off = onLocalChange(load);
    return () => {
      live = false;
      off();
    };
  }, [state.pending, state.rejected]);

  return (
    <div className="space-y-6 text-sm">
      {outbox.length > 0 && (
        <Section title="Waiting to be sent">
          <ul className="space-y-1.5">
            {outbox.map((entry) => (
              <li key={entry.seq} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{entry.label}</span>
                <span className="shrink-0 text-muted">{when(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void flush()}
            disabled={state.phase === "syncing"}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 font-medium hover:bg-brand-50 disabled:opacity-50"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Send now
          </button>
        </Section>
      )}

      {rejected.length > 0 && (
        <Section title="Not saved">
          <p className="mb-2 text-muted">The server refused these changes, so they were not saved. Make them again on the task if they are still needed.</p>
          <ul className="space-y-2">
            {rejected.map((entry) => (
              <li key={`${entry.at}-${entry.label}`} className="rounded-lg bg-red-50 px-3 py-2 text-danger">
                <span className="font-medium">{entry.label}</span>
                <span className="block text-xs">{entry.error}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void clearRejected().then(refreshState)}
            className="mt-3 min-h-10 rounded-lg border border-border px-3 font-medium hover:bg-brand-50"
          >
            Clear this list
          </button>
        </Section>
      )}

      <Section title="Kept on this device">
        {meta.length === 0 ? (
          <p className="text-muted">Nothing yet. Open My tasks once while online.</p>
        ) : (
          <ul className="space-y-1.5">
            {meta.map((m) => (
              <li key={m.kind} className="flex justify-between gap-3">
                <span>
                  {kindLabel[m.kind]}: {m.count}
                </span>
                <span className="text-muted">saved {when(m.savedAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Tasks can be added, started, finished and reprioritised without a connection. Everything is wiped when you sign out.</p>
      </Section>

      <Section title="Opens without a connection">
        {pages === null ? (
          <p className="text-muted">Offline pages work in the installed app and in the browser after the first visit.</p>
        ) : pages.length === 0 ? (
          <p className="text-muted">No pages yet. They are kept as you open them while online.</p>
        ) : (
          <ul className="space-y-1.5">
            {pages.map((page) => (
              <li key={page.url} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{pageName(page.url)}</span>
                <span className="shrink-0 text-muted">{when(page.cachedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Needs a connection">
        <p className="text-muted">
          Comments, files, assignees, moving tasks between projects, the task page form, and every other part of the portal: leads, vacancies,
          candidates, clients and settings. Those pages show the last copy you opened, read only.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-display text-sm font-semibold text-brand-900">{title}</h3>
      {children}
    </section>
  );
}
