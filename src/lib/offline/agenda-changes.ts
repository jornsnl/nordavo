import { syncAddAgendaItemAction, type SyncAddAgendaItem } from "@/app/work/meeting-actions";
import type { SyncResult } from "@/app/work/sync-actions";

/**
 * A point on a meeting agenda works offline too: it gets its id on the device
 * (crypto.randomUUID), waits in the outbox like a task, and reaches the server
 * once, with the moment it was written. Only adding is offline; changing a
 * point, making a task and closing the meeting need a connection.
 */

export type AgendaOp = { op: "agenda.add"; payload: SyncAddAgendaItem };

/** The point as this device has it while it waits to be sent. */
export type PendingAgendaItem = { id: string; meetingId: string; title: string; createdAt: string };

/** Sends one change. Throws on a network failure; returns { error } when the server refuses. */
export async function sendAgendaOp(op: string, payload: unknown): Promise<SyncResult> {
  if (op === "agenda.add") return syncAddAgendaItemAction(payload as SyncAddAgendaItem);
  return { error: "This change cannot be sent any more." };
}
