/**
 * The device's own database (IndexedDB), for Work offline. Browser only.
 *
 *   records  the last copy of each record this device saw, by "<kind>:<id>"
 *   meta     per kind: how many records and when they were saved; plus the
 *            changes the server refused ("rejected")
 *   outbox   changes waiting for the server, in order (autoIncrement)
 *   dirty    records changed here that the server has not confirmed yet;
 *            pages lay these over the server's list (data null: deleted)
 *
 * Everything is wiped on sign out (clearDevice).
 */

export const DB_NAME = "nordavo-offline";
const DB_VERSION = 1;

export type RecordKind = "task";
export const recordKey = (kind: RecordKind, id: string) => `${kind}:${id}`;

export type MetaEntry = { kind: RecordKind; count: number; savedAt: number };

export type DirtyEntry<T = unknown> = {
  key: string;
  kind: RecordKind;
  id: string;
  /** The record as this device has it now; null when deleted here. */
  data: T | null;
  /** Made on this device: shown even when the server's list does not have it yet. */
  created: boolean;
  /** Changes for this record still in the outbox. */
  pending: number;
  /** When the server confirmed the last one; the entry goes some seconds later. */
  syncedAt: number | null;
  updatedAt: number;
};

export type OutboxEntry = {
  seq?: number;
  key: string;
  kind: RecordKind;
  /** What to send; see src/lib/offline/task-changes.ts. */
  op: string;
  payload: unknown;
  /** Short description for the sync panel, e.g. "Start: Call back Bright". */
  label: string;
  createdAt: number;
  attempts: number;
};

export type RejectedEntry = { label: string; error: string; at: number };

let opening: Promise<IDBDatabase> | null = null;

export function isAvailable() {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains("dirty")) db.createObjectStore("dirty", { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab deletes the database on sign out: let go so it can.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
    request.onblocked = () => reject(new Error("The offline database is blocked by another tab"));
  });
  return opening;
}

type StoreName = "records" | "meta" | "outbox" | "dirty";

async function tx<T>(stores: StoreName[], mode: IDBTransactionMode, run: (t: IDBTransaction) => T | Promise<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result: T;
    Promise.resolve(run(t)).then((value) => (result = value), reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- records and meta ------------------------------------------------------

/** Saves the server's copy of records the page just showed, and the count per kind. */
export async function saveRecords<T>(kind: RecordKind, items: T[], idOf: (item: T) => string) {
  await tx(["records", "meta"], "readwrite", (t) => {
    const records = t.objectStore("records");
    for (const item of items) records.put(item, recordKey(kind, idOf(item)));
    // Count what is kept of this kind, not just this page.
    const range = IDBKeyRange.bound(`${kind}:`, `${kind}:￿`);
    const count = records.count(range);
    count.onsuccess = () => t.objectStore("meta").put({ kind, count: count.result, savedAt: Date.now() } satisfies MetaEntry, kind);
  });
}

export async function getRecord<T>(kind: RecordKind, id: string): Promise<T | undefined> {
  return tx(["records"], "readonly", (t) => req(t.objectStore("records").get(recordKey(kind, id)) as IDBRequest<T | undefined>));
}

export async function listMeta(): Promise<MetaEntry[]> {
  const all = await tx(["meta"], "readonly", (t) => req(t.objectStore("meta").getAll()));
  return (all as unknown[]).filter((m): m is MetaEntry => Boolean(m && typeof m === "object" && "kind" in m && "count" in m));
}

export async function listRejected(): Promise<RejectedEntry[]> {
  const value = await tx(["meta"], "readonly", (t) => req(t.objectStore("meta").get("rejected")));
  return Array.isArray(value) ? (value as RejectedEntry[]) : [];
}

export async function addRejected(entry: RejectedEntry) {
  const current = await listRejected();
  await tx(["meta"], "readwrite", (t) => {
    t.objectStore("meta").put([...current, entry].slice(-20), "rejected");
  });
}

export async function clearRejected() {
  await tx(["meta"], "readwrite", (t) => {
    t.objectStore("meta").delete("rejected");
  });
}

// --- dirty -----------------------------------------------------------------

export async function listDirty<T>(kind: RecordKind): Promise<DirtyEntry<T>[]> {
  const all = (await tx(["dirty"], "readonly", (t) => req(t.objectStore("dirty").getAll()))) as DirtyEntry<T>[];
  return all.filter((d) => d.kind === kind);
}

export async function getDirty<T>(key: string): Promise<DirtyEntry<T> | undefined> {
  return tx(["dirty"], "readonly", (t) => req(t.objectStore("dirty").get(key) as IDBRequest<DirtyEntry<T> | undefined>));
}

export async function putDirty(entry: DirtyEntry) {
  await tx(["dirty"], "readwrite", (t) => {
    t.objectStore("dirty").put(entry);
  });
}

export async function deleteDirty(key: string) {
  await tx(["dirty"], "readwrite", (t) => {
    t.objectStore("dirty").delete(key);
  });
}

// --- outbox ----------------------------------------------------------------

/** A change goes in the outbox and its record becomes dirty in one transaction. */
export async function enqueue(entry: OutboxEntry, dirty: DirtyEntry | null) {
  await tx(["outbox", "dirty"], "readwrite", (t) => {
    t.objectStore("outbox").add(entry);
    if (dirty) t.objectStore("dirty").put(dirty);
  });
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  return tx(["outbox"], "readonly", (t) => req(t.objectStore("outbox").getAll() as IDBRequest<OutboxEntry[]>));
}

export async function countOutbox(): Promise<number> {
  return tx(["outbox"], "readonly", (t) => req(t.objectStore("outbox").count()));
}

export async function updateOutbox(entry: OutboxEntry) {
  await tx(["outbox"], "readwrite", (t) => {
    t.objectStore("outbox").put(entry);
  });
}

/** Takes a sent (or refused) change out and updates its record's dirty entry. */
export async function finishOutbox(seq: number, key: string, confirmed: boolean) {
  await tx(["outbox", "dirty"], "readwrite", async (t) => {
    t.objectStore("outbox").delete(seq);
    const dirtyStore = t.objectStore("dirty");
    const dirty = (await req(dirtyStore.get(key))) as DirtyEntry | undefined;
    if (!dirty) return;
    const pending = Math.max(0, dirty.pending - 1);
    if (pending > 0) {
      dirtyStore.put({ ...dirty, pending });
    } else if (confirmed) {
      dirtyStore.put({ ...dirty, pending, syncedAt: Date.now() });
    } else {
      // Refused and nothing else waiting: the server's version is the truth again.
      dirtyStore.delete(key);
    }
  });
}

// --- sign out --------------------------------------------------------------

/** Deletes the whole database (sign out). */
export async function deleteDatabase() {
  if (!isAvailable()) return;
  if (opening) {
    try {
      (await opening).close();
    } catch {
      // Never opened: nothing to close.
    }
    opening = null;
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
