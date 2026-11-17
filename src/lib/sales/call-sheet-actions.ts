import "server-only";
import { z } from "zod";
import { reloadCompanyRow } from "@/lib/sales/call-sheet-data";
import type { SheetCompanyRow } from "@/lib/sales/call-sheet";
import {
  claimCall,
  loadCompanyTimeline,
  recordCall,
  revertCall,
  type CallActor,
  type CallInput,
  type CallTimelineItem,
} from "@/lib/sales/call-session";
import { callOutcomes, labelOf } from "@/lib/sales/labels";

// What the call sheet does on the server (feedback Julius, f5d4375a): hold a
// contact, log an outcome, undo it, read the history of a company and reload a
// row. Every call rule stays in the database (sales_log_call, sales_undo_call,
// sales_claim_contact); this file only connects the sheet to the same
// functions the call screen uses (call-session.ts). Shared by the team
// (session client) and external callers (secret key client with p_actor,
// after requireCaller()).

/** The sheet of one call list (team) or of the queue of one caller. */
export type SheetScope = { kind: "list"; listId: string } | { kind: "caller"; callerId: string };

/** The scope from the browser: only a list id for the team; a caller always gets their own queue. */
export function sheetScopeFor(actor: Pick<CallActor, "callerId">, listId: unknown): SheetScope | null {
  if (actor.callerId) return { kind: "caller", callerId: actor.callerId };
  const parsed = z.guid().safeParse(listId);
  return parsed.success ? { kind: "list", listId: parsed.data } : null;
}

export type ClaimedContact = { ok: true } | { ok: false; error: string };

const claimMessages = {
  taken: "Someone else has this contact open. Try again in a few minutes.",
  denied: "You no longer have access to calling.",
  error: "The contact could not be held. Please try again.",
} as const;

/** Holds a contact for the person calling, so nobody else opens it for 30 minutes. */
export async function claimSheetContact(actor: CallActor, contactId: string): Promise<ClaimedContact> {
  const result = await claimCall(actor, contactId);
  return result === "held" ? { ok: true } : { ok: false, error: claimMessages[result] };
}

/** A caller may read what they hold or what they called; the team may read every company. */
async function mayRead(actor: CallActor, companyId: string): Promise<boolean> {
  if (!actor.callerId) return true;
  const [held, called] = await Promise.all([
    actor.db.from("contacts").select("id").eq("company_id", companyId).eq("claimed_by", actor.actorId).limit(1),
    actor.db.from("activities").select("id").eq("company_id", companyId).eq("caller_id", actor.callerId).limit(1),
  ]);
  return (held.data?.length ?? 0) > 0 || (called.data?.length ?? 0) > 0;
}

export type SheetHistory = { ok: true; items: CallTimelineItem[] } | { ok: false; error: string };

/** The contact moments of a company (calls, mails, LinkedIn, meetings), newest first. */
export async function sheetHistory(actor: CallActor, companyId: string): Promise<SheetHistory> {
  if (!z.guid().safeParse(companyId).success) return { ok: false, error: "Unknown company." };
  if (!(await mayRead(actor, companyId))) return { ok: false, error: "Open a contact of this company first." };
  const { data } = await actor.db.from("contacts").select("id, first_name, last_name, full_name").eq("company_id", companyId);
  const names = new Map(
    (data ?? []).map((c) => [c.id, c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "Unknown contact"]),
  );
  return { ok: true, items: await loadCompanyTimeline(actor.db, companyId, names) };
}

export type SheetLogged =
  | { ok: true; row: SheetCompanyRow | null; outcome: string; attempts: number; activityId: string | null; companyId: string | null }
  | { ok: false; error: string };

/** Logs one outcome like the call screen does, but opens no next contact: the sheet stays where it is. */
export async function logSheetCall(actor: CallActor, scope: SheetScope, input: CallInput): Promise<SheetLogged> {
  const done = await recordCall(actor, input);
  if (!done.ok) return done;
  const row = done.companyId ? await reloadCompanyRow(actor.db, scope, actor.actorId, done.companyId) : null;
  return {
    ok: true,
    row,
    outcome: labelOf(callOutcomes, done.input.outcome),
    attempts: done.attempts,
    activityId: done.activityId,
    companyId: done.companyId,
  };
}

export type SheetUndone = { ok: true; row: SheetCompanyRow | null; contactId: string } | { ok: false; error: string };

/** Puts the last call back (sales_undo_call); the contact is held for the person again. */
export async function undoSheetCall(actor: CallActor, scope: SheetScope, activityId: string): Promise<SheetUndone> {
  const undone = await revertCall(actor, activityId);
  if (!undone.ok) return undone;
  const { data } = await actor.db.from("contacts").select("company_id").eq("id", undone.contactId).maybeSingle();
  const row = data?.company_id ? await reloadCompanyRow(actor.db, scope, actor.actorId, data.company_id) : null;
  return { ok: true, row, contactId: undone.contactId };
}

export type SheetReloaded = { ok: true; row: SheetCompanyRow | null } | { ok: false; error: string };

/** One company row again, after a contact was changed or added. */
export async function reloadSheetRow(actor: CallActor, scope: SheetScope, companyId: string): Promise<SheetReloaded> {
  if (!z.guid().safeParse(companyId).success) return { ok: false, error: "Unknown company." };
  if (!(await mayRead(actor, companyId))) return { ok: false, error: "Open a contact of this company first." };
  return { ok: true, row: await reloadCompanyRow(actor.db, scope, actor.actorId, companyId) };
}
