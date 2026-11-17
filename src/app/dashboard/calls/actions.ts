"use server";

import { requireModule } from "@/lib/auth";
import { salesBookingBase } from "@/lib/sales/booking";
import { addCallContact, markCallPhone, updateCallContact, type ContactEdit, type PersonInput } from "@/lib/sales/call-contacts";
import {
  type CallActor,
  type CallInput,
  type CallStep,
  cleanExclude,
  logCall,
  nextCall,
  releaseCall,
  skipCall,
  teamScope,
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
import { createClient } from "@/lib/supabase/server";

// The call screen for the team (admins and internal users with Sales). They
// call with their own session, so RLS and the sales functions see them.

async function teamActor(): Promise<CallActor> {
  const user = await requireModule("sales");
  const db = await createClient();
  const { data: profile } = await db.from("profiles").select("booking_url").eq("id", user.id).maybeSingle();
  return {
    db,
    actorId: user.id,
    callerId: null,
    pActor: undefined,
    bookingBase: salesBookingBase(process.env.NEXT_PUBLIC_CALCOM_SALES_URL, profile?.booking_url),
  };
}

const NO_SCOPE: CallStep = { card: null, remaining: 0, error: "Pick a call list first." };

export async function startTeamCalls(scope: unknown, exclude: unknown): Promise<CallStep> {
  const actor = await teamActor();
  const s = teamScope(scope);
  if (!s) return NO_SCOPE;
  return nextCall(actor, s, cleanExclude(exclude));
}

export async function logTeamCall(scope: unknown, input: CallInput, exclude: unknown): Promise<CallStep> {
  const actor = await teamActor();
  const s = teamScope(scope);
  if (!s) return NO_SCOPE;
  return logCall(actor, s, input, cleanExclude(exclude));
}

export async function skipTeamCall(scope: unknown, contactId: string | null, exclude: unknown): Promise<CallStep> {
  const actor = await teamActor();
  const s = teamScope(scope);
  if (!s) return NO_SCOPE;
  return skipCall(actor, s, contactId, cleanExclude(exclude));
}

export async function releaseTeamCall(contactId: string): Promise<void> {
  const actor = await teamActor();
  await releaseCall(actor, contactId);
}

/** Undo of the last call: ten seconds on the screen, a minute at the most in the database. */
export async function undoTeamCall(scope: unknown, activityId: unknown, current: unknown): Promise<CallStep> {
  const actor = await teamActor();
  const s = teamScope(scope);
  if (!s) return NO_SCOPE;
  return undoCall(actor, s, typeof activityId === "string" ? activityId : "", typeof current === "string" ? current : null);
}

// Contacts on the call screen (7200c28b): the same functions as for callers,
// with the session of the team member.

export async function editTeamContact(contactId: string, input: PersonInput): Promise<ContactEdit> {
  return updateCallContact(await teamActor(), contactId, input);
}

export async function markTeamPhone(contactId: string, wrong: boolean): Promise<ContactEdit> {
  return markCallPhone(await teamActor(), contactId, wrong === true);
}

export async function addTeamContact(companyId: string, input: PersonInput): Promise<ContactEdit> {
  return addCallContact(await teamActor(), companyId, input);
}

// The call sheet (f5d4375a): the same functions as the call screen, but no
// next contact opens; the sheet stays where it is.

const NO_LIST = { ok: false, error: "Pick a call list first." } as const;

export async function claimTeamSheetContact(contactId: string): Promise<ClaimedContact> {
  return claimSheetContact(await teamActor(), contactId);
}

export async function teamSheetHistory(companyId: string): Promise<SheetHistory> {
  return sheetHistory(await teamActor(), companyId);
}

export async function logTeamSheetCall(listId: unknown, input: CallInput): Promise<SheetLogged> {
  const actor = await teamActor();
  const scope = sheetScopeFor(actor, listId);
  return scope ? logSheetCall(actor, scope, input) : NO_LIST;
}

export async function undoTeamSheetCall(listId: unknown, activityId: unknown): Promise<SheetUndone> {
  const actor = await teamActor();
  const scope = sheetScopeFor(actor, listId);
  return scope ? undoSheetCall(actor, scope, typeof activityId === "string" ? activityId : "") : NO_LIST;
}

export async function reloadTeamSheetRow(listId: unknown, companyId: string): Promise<SheetReloaded> {
  const actor = await teamActor();
  const scope = sheetScopeFor(actor, listId);
  return scope ? reloadSheetRow(actor, scope, companyId) : NO_LIST;
}
