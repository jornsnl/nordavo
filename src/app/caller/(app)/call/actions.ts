"use server";

import { requireCaller } from "@/lib/auth";
import { loadBookingLinks } from "@/lib/sales/booking-data";
import { addCallContact, markCallPhone, updateCallContact, type ContactEdit, type PersonInput } from "@/lib/sales/call-contacts";
import {
  type CallActor,
  type CallInput,
  type CallStep,
  bookingState,
  cancelBooking,
  cleanExclude,
  finishBooking,
  logCall,
  nextCall,
  releaseCall,
  skipCall,
  startBooking,
  undoCall,
} from "@/lib/sales/call-session";
import {
  claimSheetContact,
  logSheetCall,
  reloadSheetRow,
  sheetHistory,
  sheetScopeFor,
  undoSheetCall,
  type ClaimedContact,
  type SheetHistory,
  type SheetLogged,
  type SheetReloaded,
  type SheetUndone,
} from "@/lib/sales/call-sheet-actions";
import { createAdminClient } from "@/lib/supabase/admin";

// The call screen for external callers. They have no table access of their
// own (RLS), so after requireCaller() (active caller, authenticator app) the
// server works with the secret key and passes their profile as p_actor: the
// sales functions check the caller again, hold contacts for them, log
// everything they do in Activities and only change what a caller may change.
// The queue is always their own: the browser cannot pick another one.

async function callerActor(): Promise<CallActor | null> {
  const caller = await requireCaller();
  const db = createAdminClient();
  if (!db) return null;
  return {
    db,
    actorId: caller.id,
    callerId: caller.callerId,
    pActor: caller.id,
    bookingLinks: await loadBookingLinks(db),
  };
}

const NOT_CONFIGURED: CallStep = {
  card: null,
  remaining: 0,
  error: "Calling is not available right now. Ask Nordavo to finish the setup.",
};

export async function startCallerCalls(exclude: unknown): Promise<CallStep> {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return NOT_CONFIGURED;
  return nextCall(actor, { kind: "caller", callerId: actor.callerId }, cleanExclude(exclude));
}

export async function logCallerCall(input: CallInput, exclude: unknown): Promise<CallStep> {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return NOT_CONFIGURED;
  return logCall(actor, { kind: "caller", callerId: actor.callerId }, input, cleanExclude(exclude));
}

export async function skipCallerCall(contactId: string | null, exclude: unknown): Promise<CallStep> {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return NOT_CONFIGURED;
  return skipCall(actor, { kind: "caller", callerId: actor.callerId }, contactId, cleanExclude(exclude));
}

// Meeting planned: the meeting waits for its Cal.com booking before it counts.

export async function startCallerBooking(input: CallInput) {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return { ok: false, error: NOT_CONFIGURED.error ?? "Not available." } as const;
  return startBooking(actor, input);
}

export async function callerBookingStatus(meetingId: string) {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return { status: "gone", scheduledAt: null } as const;
  return bookingState(actor, meetingId);
}

export async function finishCallerBooking(contactId: string, meetingId: string, exclude: unknown): Promise<CallStep> {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return NOT_CONFIGURED;
  return finishBooking(actor, { kind: "caller", callerId: actor.callerId }, contactId, meetingId, cleanExclude(exclude));
}

export async function cancelCallerBooking(meetingId: string) {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return false;
  return cancelBooking(actor, meetingId);
}

export async function releaseCallerCall(contactId: string): Promise<void> {
  const actor = await callerActor();
  if (!actor) return;
  await releaseCall(actor, contactId);
}

/** Undo of the last call: ten seconds on the screen, a minute at the most in the database. */
export async function undoCallerCall(activityId: unknown, current: unknown): Promise<CallStep> {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return NOT_CONFIGURED;
  return undoCall(
    actor,
    { kind: "caller", callerId: actor.callerId },
    typeof activityId === "string" ? activityId : "",
    typeof current === "string" ? current : null,
  );
}

// Contacts on the call screen (7200c28b): the functions check that the caller
// holds a contact of the same company and that only these fields change.

const NOT_AVAILABLE: ContactEdit = { ok: false, error: "Calling is not available right now. Ask Nordavo to finish the setup." };

export async function editCallerContact(contactId: string, input: PersonInput): Promise<ContactEdit> {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return NOT_AVAILABLE;
  return updateCallContact(actor, contactId, input);
}

export async function markCallerPhone(contactId: string, wrong: boolean): Promise<ContactEdit> {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return NOT_AVAILABLE;
  return markCallPhone(actor, contactId, wrong === true);
}

export async function addCallerContact(companyId: string, input: PersonInput): Promise<ContactEdit> {
  const actor = await callerActor();
  if (!actor || !actor.callerId) return NOT_AVAILABLE;
  return addCallContact(actor, companyId, input);
}

// The call sheet (f5d4375a): the same functions as the call screen, but no
// next contact opens. The scope is always the caller's own queue.

const SHEET_UNAVAILABLE = { ok: false, error: "Calling is not available right now. Ask Nordavo to finish the setup." } as const;

async function sheetActor() {
  const actor = await callerActor();
  const scope = actor ? sheetScopeFor(actor, null) : null;
  return actor && scope ? { actor, scope } : null;
}

export async function claimCallerSheetContact(contactId: string): Promise<ClaimedContact> {
  const a = await sheetActor();
  return a ? claimSheetContact(a.actor, contactId) : SHEET_UNAVAILABLE;
}

export async function callerSheetHistory(companyId: string): Promise<SheetHistory> {
  const a = await sheetActor();
  return a ? sheetHistory(a.actor, companyId) : SHEET_UNAVAILABLE;
}

export async function logCallerSheetCall(_listId: unknown, input: CallInput): Promise<SheetLogged> {
  const a = await sheetActor();
  return a ? logSheetCall(a.actor, a.scope, input) : SHEET_UNAVAILABLE;
}

export async function undoCallerSheetCall(_listId: unknown, activityId: unknown): Promise<SheetUndone> {
  const a = await sheetActor();
  return a ? undoSheetCall(a.actor, a.scope, typeof activityId === "string" ? activityId : "") : SHEET_UNAVAILABLE;
}

export async function reloadCallerSheetRow(_listId: unknown, companyId: string): Promise<SheetReloaded> {
  const a = await sheetActor();
  return a ? reloadSheetRow(a.actor, a.scope, companyId) : SHEET_UNAVAILABLE;
}
