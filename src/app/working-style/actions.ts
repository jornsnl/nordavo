"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sendWspMailAfter } from "@/lib/wsp/after";
import type { WspAccess } from "@/lib/wsp/data";

// The person's own actions on the Working Style Profile: through the
// personal link (no account needed) or the own account. The database checks
// the link or the account on every call (wsp_* functions, RLS on wsp_shares).

export type WspActionResult = { ok: true } | { ok: false; error: string };

const accessSchema = z.union([
  z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.object({ assessmentId: z.guid() }),
]);

function rpcAccess(access: WspAccess) {
  return "token" in access ? { p_token: access.token, p_assessment: null } : { p_token: null, p_assessment: access.assessmentId };
}

function message(error: { message?: string } | null, fallback = "Something went wrong. Please try again.") {
  const text = error?.message ?? "";
  // Messages raised by the wsp_* functions are written for the person.
  if (/^(This|Tick|Choose|Answer|The working|Only)/.test(text)) return text;
  return fallback;
}

function revalidate(access: WspAccess) {
  if ("token" in access) revalidatePath(`/working-style/${access.token}`);
  else revalidatePath(`/academy/working-style/${access.assessmentId}`);
  revalidatePath("/academy/working-style");
}

export async function acceptWspIntro(access: WspAccess): Promise<WspActionResult> {
  const parsed = accessSchema.safeParse(access);
  if (!parsed.success) return { ok: false, error: "This link is not valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_accept_intro", rpcAccess(parsed.data));
  if (error) return { ok: false, error: message(error) };
  return { ok: true };
}

const answerSchema = z.object({
  itemId: z.guid(),
  answer: z.number().int().min(1).max(5),
  page: z.number().int().min(1).max(20),
  elapsedMs: z.number().int().min(0).max(3_600_000),
});

/** One answer, saved at once (with the time spent on the page since the last save). */
export async function saveWspAnswer(access: WspAccess, input: z.infer<typeof answerSchema>): Promise<WspActionResult> {
  const a = accessSchema.safeParse(access);
  const parsed = answerSchema.safeParse(input);
  if (!a.success || !parsed.success) return { ok: false, error: "This answer could not be saved." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_save_answer", {
    ...rpcAccess(a.data),
    p_item: parsed.data.itemId,
    p_answer: parsed.data.answer,
    p_page: parsed.data.page,
    p_elapsed_ms: parsed.data.elapsedMs,
  });
  if (error) return { ok: false, error: message(error, "Your answer was not saved. Check your connection and try again.") };
  return { ok: true };
}

/** Time on a page without a new answer (Next, Back, leaving the page). */
export async function recordWspPageTime(access: WspAccess, page: number, elapsedMs: number): Promise<WspActionResult> {
  const a = accessSchema.safeParse(access);
  if (!a.success || !Number.isInteger(page) || !Number.isFinite(elapsedMs)) return { ok: false, error: "Not saved." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wsp_page_time", {
    ...rpcAccess(a.data),
    p_page: page,
    p_elapsed_ms: Math.max(0, Math.min(3_600_000, Math.round(elapsedMs))),
  });
  if (error) return { ok: false, error: message(error) };
  return { ok: true };
}

/** After the last page: the database scores, flags and completes; staff get a mail. */
export async function completeWsp(access: WspAccess): Promise<WspActionResult> {
  const parsed = accessSchema.safeParse(access);
  if (!parsed.success) return { ok: false, error: "This link is not valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wsp_complete", rpcAccess(parsed.data));
  if (error) return { ok: false, error: message(error) };
  sendWspMailAfter(data ? [data] : undefined);
  revalidate(parsed.data);
  return { ok: true };
}

/** "Delete my profile": everything goes at once; active shares are withdrawn with the mail to the client. */
export async function deleteMyWsp(access: WspAccess): Promise<WspActionResult> {
  const parsed = accessSchema.safeParse(access);
  if (!parsed.success) return { ok: false, error: "This link is not valid." };
  const supabase = await createClient();
  const id = "assessmentId" in parsed.data ? parsed.data.assessmentId : undefined;
  const { error } = await supabase.rpc("wsp_delete_my_profile", rpcAccess(parsed.data));
  if (error) return { ok: false, error: message(error) };
  sendWspMailAfter(id ? [id] : undefined);
  revalidate(parsed.data);
  return { ok: true };
}

const shareSchema = z.object({ assessmentId: z.guid(), clientId: z.guid(), share: z.boolean() });

/**
 * Give or withdraw permission for one client, from the own account only.
 * RLS on wsp_shares makes sure consented_by is the signed-in person.
 */
export async function setWspShare(input: z.infer<typeof shareSchema>): Promise<WspActionResult> {
  const parsed = shareSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { assessmentId, clientId, share } = parsed.data;
  if (share) {
    const { error } = await supabase
      .from("wsp_shares")
      .insert({ assessment_id: assessmentId, client_id: clientId, consented_by: user.id });
    if (error) return { ok: false, error: "Your permission could not be saved. Only you can share your own profile, from your own account." };
  } else {
    const { data, error } = await supabase
      .from("wsp_shares")
      .update({ revoked_by: user.id })
      .eq("assessment_id", assessmentId)
      .eq("client_id", clientId)
      .is("revoked_at", null)
      .select("id");
    if (error || !data?.length) return { ok: false, error: "Your permission could not be withdrawn. Please try again." };
    sendWspMailAfter([assessmentId]);
  }
  revalidatePath("/academy/working-style");
  revalidatePath(`/academy/working-style/${assessmentId}`);
  return { ok: true };
}
