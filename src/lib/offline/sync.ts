import {
  addRejected,
  countOutbox,
  deleteDirty,
  enqueue,
  finishOutbox,
  getDirty,
  getRecord,
  isAvailable,
  listDirty,
  listOutbox,
  listRejected,
  recordKey,
  updateOutbox,
  type DirtyEntry,
} from "./db";
import { applyTaskOp, describeTaskOp, sendTaskOp, taskIdOf, type TaskOp } from "./task-changes";
import type { TaskListItem } from "@/lib/work/data";

/**
 * Sending changes. Every change goes into the outbox first and the outbox is
 * sent straight away, in order, through the same server actions as online.
 * So a change reaches the server at once when it can; when the device is
 * offline, the server does not answer within 30 seconds, or older changes
 * are still waiting, it waits its turn. The outbox is tried again when the
 * connection comes back and every 20 seconds.
 */

export const SEND_TIMEOUT_MS = 30_000;
export const RETRY_MS = 20_000;
/** A sent record stays marked this long, so the refresh with the server's version arrives first. */
export const CONFIRM_GRACE_MS = 4_000;
/** A change that keeps failing on the server (not the network) is dropped after this many tries. */
const MAX_ATTEMPTS = 3;

export type SyncState = {
  /** synced: nothing waiting. syncing: sending now. offline: no connection or the server does not answer. */
  phase: "synced" | "syncing" | "offline";
  pending: number;
  rejected: number;
  lastSyncedAt: number | null;
};

let state: SyncState = { phase: "synced", pending: 0, rejected: 0, lastSyncedAt: null };
let reachable = true;
let flushing = false;
const listeners = new Set<() => void>();
const localListeners = new Set<() => void>();

const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("nordavo-sync") : null;
channel?.addEventListener("message", () => {
  // Another tab changed the outbox or the dirty records.
  localListeners.forEach((l) => l());
  void refreshState();
});

export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncState() {
  return state;
}

/** Called when this device's records or outbox change (this tab or another). */
export function onLocalChange(listener: () => void) {
  localListeners.add(listener);
  return () => localListeners.delete(listener);
}

function setState(next: Partial<SyncState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function changed() {
  localListeners.forEach((l) => l());
  channel?.postMessage("changed");
}

const online = () => typeof navigator === "undefined" || navigator.onLine;

export async function refreshState() {
  if (!isAvailable()) return;
  try {
    const [pending, rejected] = await Promise.all([countOutbox(), listRejected()]);
    setState({
      pending,
      rejected: rejected.length,
      phase: flushing ? "syncing" : pending > 0 && (!online() || !reachable) ? "offline" : !online() ? "offline" : "synced",
    });
  } catch {
    // Storage blocked (private mode): nothing is kept, nothing to show.
  }
}

/** A failure of the connection, not an answer of the server. */
export function isNetworkError(error: unknown): boolean {
  if (!online()) return true;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /failed to fetch|network|load failed|timed? ?out|offline|connection/i.test(message);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("The server did not answer in time"), { name: "TimeoutError" })), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Tells the shell to fetch the page again after changes reached the server. */
export const SYNCED_EVENT = "nordavo:synced";
/** A change the server refused: { label, error }. */
export const REJECTED_EVENT = "nordavo:rejected";

/**
 * A change to a Work task: the device's copy changes at once (the record is
 * dirty until the server confirms) and the change goes to the server, now or
 * later. `base` is the task as the page shows it.
 */
export async function submitTaskOp(change: TaskOp, base: TaskListItem | null = null) {
  if (!isAvailable()) {
    // No IndexedDB (a locked down browser): send directly, like before.
    const result = await sendTaskOp(change.op, change.payload);
    if ("error" in result) window.dispatchEvent(new CustomEvent(REJECTED_EVENT, { detail: { label: "", error: result.error } }));
    else window.dispatchEvent(new Event(SYNCED_EVENT));
    return;
  }
  const id = taskIdOf(change);
  const key = recordKey("task", id);
  const existing = await getDirty<TaskListItem>(key);
  const current = existing?.data ?? base ?? (await getRecord<TaskListItem>("task", id)) ?? null;
  const data = applyTaskOp(current, change);
  const dirty: DirtyEntry<TaskListItem> | null = data
    ? {
        key,
        kind: "task",
        id,
        data,
        created: Boolean(existing?.created) || change.op === "task.create",
        pending: (existing?.pending ?? 0) + 1,
        syncedAt: null,
        updatedAt: Date.now(),
      }
    : null;
  await enqueue(
    {
      key,
      kind: "task",
      op: change.op,
      payload: change.payload,
      label: describeTaskOp(change, data?.title ?? current?.title ?? "task"),
      createdAt: Date.now(),
      attempts: 0,
    },
    // Without a copy of the task (never listed on this device) only the outbox
    // holds the change; nothing to lay over a list.
    dirty,
  );
  changed();
  await refreshState();
  void flush();
}

async function drain(): Promise<number> {
  let sent = 0;
  for (;;) {
    const [entry] = await listOutbox();
    if (!entry || entry.seq === undefined) break;
    let result;
    try {
      result = await withTimeout(sendTaskOp(entry.op, entry.payload), SEND_TIMEOUT_MS);
    } catch (error) {
      if (isNetworkError(error)) {
        // Keep it, and everything after it, for the next try.
        reachable = false;
        break;
      }
      // The server broke on it (not a refusal): a few more tries, then it goes.
      const attempts = entry.attempts + 1;
      if (attempts < MAX_ATTEMPTS) {
        await updateOutbox({ ...entry, attempts });
        break;
      }
      result = { error: "The server could not process this change." };
    }
    reachable = true;
    if ("error" in result) {
      await finishOutbox(entry.seq, entry.key, false);
      await addRejected({ label: entry.label, error: result.error, at: Date.now() });
      window.dispatchEvent(new CustomEvent(REJECTED_EVENT, { detail: { label: entry.label, error: result.error } }));
    } else {
      await finishOutbox(entry.seq, entry.key, true);
      sent++;
      scheduleRelease(entry.key);
    }
    changed();
  }
  return sent;
}

/** Sends what waits in the outbox, in order. One tab at a time. */
export async function flush() {
  if (flushing || !isAvailable() || !online()) {
    await refreshState();
    return;
  }
  if ((await countOutbox()) === 0) {
    reachable = true;
    await refreshState();
    return;
  }
  flushing = true;
  setState({ phase: "syncing" });
  let sent = 0;
  try {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks) {
      await locks.request("nordavo-outbox", { ifAvailable: true }, async (lock) => {
        if (lock) sent = await drain();
      });
    } else {
      sent = await drain();
    }
  } catch {
    reachable = false;
  } finally {
    flushing = false;
  }
  if (sent > 0) {
    setState({ lastSyncedAt: Date.now() });
    window.dispatchEvent(new Event(SYNCED_EVENT));
  }
  await refreshState();
}

/** After the grace period the dirty mark goes, unless a newer change came in. */
function scheduleRelease(key: string) {
  setTimeout(async () => {
    const dirty = await getDirty(key).catch(() => undefined);
    if (dirty && dirty.pending === 0 && dirty.syncedAt !== null) {
      await deleteDirty(key);
      changed();
    }
  }, CONFIRM_GRACE_MS);
}

/** On start: marks left behind by a tab that closed during the grace period. */
export async function releaseStale() {
  if (!isAvailable()) return;
  const dirty = await listDirty("task");
  const stale = dirty.filter((d) => d.pending === 0 && d.syncedAt !== null && Date.now() - d.syncedAt > CONFIRM_GRACE_MS);
  for (const d of stale) await deleteDirty(d.key);
  if (stale.length) changed();
}
