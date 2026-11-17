"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireCaller } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// A caller opens a contact from Your calls, adds to the note and corrects an
// outcome. They have no table access (RLS): after requireCaller() the server
// calls the caller_* functions with the secret key and their profile as
// p_actor; the functions check that the call is theirs (20261124800000_caller_overview.sql).

const noteSchema = z.object({
  contactId: z.guid({ error: "Contact not found" }),
  note: z.string({ error: "Write a note" }).min(1, { error: "Write a note" }).max(5000, { error: "At most 5000 characters" }),
});

const correctSchema = z.object({
  activityId: z.guid({ error: "Call not found" }),
  contactId: z.guid({ error: "Contact not found" }),
  outcome: z.enum(["no_answer", "reached_interested", "reached_not_interested", "wrong_person", "wrong_number"], {
    error: "Pick the right outcome",
  }),
  reason: z.string({ error: "Give a reason" }).min(3, { error: "Give a reason" }).max(1000, { error: "At most 1000 characters" }),
});

const knownErrors = [
  "Give a reason for the correction",
  "Ask Nordavo to change this outcome",
  "That is already the outcome",
  "This outcome cannot be set here",
  "You have not called this contact",
  "Call not found",
];

export async function addCallerNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const caller = await requireCaller();
  const parsed = noteSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the note.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const db = createAdminClient();
  if (!db) return { error: "Calling is not available right now. Ask Nordavo to finish the setup." };
  const { error } = await db.rpc("caller_add_call_note", {
    p_contact: parsed.data.contactId,
    p_note: parsed.data.note,
    p_actor: caller.id,
  });
  if (error) {
    console.error("addCallerNote", error.code, error.message);
    return { error: knownErrors.find((m) => error.message.includes(m)) ?? GENERIC_ERROR };
  }
  revalidatePath(`/caller/contact/${parsed.data.contactId}`);
  return { ok: true, message: "Note saved." };
}

export async function correctCallerCall(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const caller = await requireCaller();
  const parsed = correctSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const db = createAdminClient();
  if (!db) return { error: "Calling is not available right now. Ask Nordavo to finish the setup." };
  const { error } = await db.rpc("caller_correct_call", {
    p_activity: parsed.data.activityId,
    p_outcome: parsed.data.outcome,
    p_reason: parsed.data.reason,
    p_actor: caller.id,
  });
  if (error) {
    console.error("correctCallerCall", error.code, error.message);
    return { error: knownErrors.find((m) => error.message.includes(m)) ?? GENERIC_ERROR };
  }
  revalidatePath(`/caller/contact/${parsed.data.contactId}`);
  revalidatePath("/caller");
  return { ok: true, message: "Outcome corrected. The reason is in the log." };
}
