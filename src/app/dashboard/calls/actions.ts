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
} from "@/lib/sales/call-session";
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
