"use server";

import { requireCaller } from "@/lib/auth";
import { salesBookingBase } from "@/lib/sales/booking";
import {
  type CallActor,
  type CallInput,
  type CallStep,
  cleanExclude,
  logCall,
  nextCall,
  releaseCall,
  skipCall,
} from "@/lib/sales/call-session";
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
    bookingBase: salesBookingBase(process.env.NEXT_PUBLIC_CALCOM_SALES_URL, null),
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

export async function releaseCallerCall(contactId: string): Promise<void> {
  const actor = await callerActor();
  if (!actor) return;
  await releaseCall(actor, contactId);
}
