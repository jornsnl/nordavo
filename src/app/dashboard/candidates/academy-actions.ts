"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR } from "@/lib/action-state";
import { hasModule, requireModule } from "@/lib/auth";
import { listAcademyPoolIds } from "@/lib/academy/ats/data";
import { parsePoolParams } from "@/lib/academy/ats/pool";
import { processAtsEvents } from "@/lib/academy/ats/process";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// ATS to Academy (docs/academy.md, ATS-koppeling): from the candidate page
// and the talent pool. Enrolling is for Academy managers (module academy;
// the database checks it again), marking top candidates for the
// recruitment team. New accounts and invitations need SUPABASE_SECRET_KEY;
// up to INLINE candidates are done right away, the rest by the job
// academy-ats-sync within the hour.

const INLINE = 25;
const guid = z.guid();
const NO_KEY = "Queued. Accounts and invitations are made once SUPABASE_SECRET_KEY is set on the server (job academy-ats-sync).";

function refresh(candidateIds: string[]) {
  revalidatePath("/dashboard/candidates/academy");
  if (candidateIds.length === 1) revalidatePath(`/dashboard/candidates/${candidateIds[0]}`);
}

/** The candidates a bulk form applies to: the ticked rows, or every match of the filters. */
async function targetIds(formData: FormData): Promise<string[]> {
  if (formData.get("target") === "all") {
    const raw = formData.get("filters");
    const params = Object.fromEntries(new URLSearchParams(typeof raw === "string" ? raw : ""));
    return listAcademyPoolIds({ ...parsePoolParams(params), page: 1 });
  }
  return [...new Set(formData.getAll("candidate_ids").filter((v): v is string => typeof v === "string" && guid.safeParse(v).success))];
}

/** Process the queued enrolments of these candidates now (as many as fit in a request). */
async function processNow(candidateIds: string[], kind: "enrol" | "top_candidate") {
  const admin = createAdminClient();
  if (!admin || candidateIds.length === 0) return { done: 0, processed: false };
  const { data: events } = await admin
    .from("academy_ats_events")
    .select("id")
    .eq("kind", kind)
    .eq("status", "pending")
    .in("candidate_id", candidateIds.slice(0, 500))
    .order("created_at")
    .limit(INLINE);
  const ids = (events ?? []).map((e) => e.id);
  if (ids.length === 0) return { done: 0, processed: true };
  const summary = await processAtsEvents(admin, { eventIds: ids });
  return { done: summary.done, processed: true };
}

/** Add candidates to the developer course (default modules plus the chosen ones), optionally in a group. */
export async function enrolCandidates(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("academy");
  const ids = await targetIds(formData);
  if (ids.length === 0) return { error: "Choose at least one candidate." };
  if (ids.length > 5000) return { error: "At most 5000 candidates at once. Narrow the filters." };
  const group = formData.get("group_id");
  const groupId = typeof group === "string" && guid.safeParse(group).success ? group : null;
  const modules = formData.getAll("open_module_ids").filter((v): v is string => typeof v === "string" && guid.safeParse(v).success);
  const supabase = await createClient();
  const { data: queued, error } = await supabase.rpc("academy_ats_queue_enrol", {
    p_candidate_ids: ids,
    p_group_id: groupId,
    p_open_module_ids: modules,
    p_send_mail: formData.get("send_mail") === "on",
  });
  if (error) {
    console.error("enrolCandidates", error.code, error.message);
    return { error: error.code === "42501" ? "Only Academy managers add people to the Academy." : GENERIC_ERROR };
  }
  const now = await processNow(ids, "enrol");
  refresh(ids);
  const count = queued ?? 0;
  if (count === 0) return { ok: true, message: "These candidates are already queued for the Academy." };
  if (!now.processed) return { ok: true, message: `${count} queued. ${NO_KEY}` };
  const rest = count - now.done;
  return {
    ok: true,
    message: `${now.done} of ${count} added to the developer course${rest > 0 ? `; the other ${rest} follow within the hour (job academy-ats-sync)` : ""}.`,
  };
}

/** Top candidate on or off, for one or many candidates. The extra modules open (or close) in the database. */
export async function setTopCandidates(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("recruitment");
  const ids = await targetIds(formData);
  if (ids.length === 0) return { error: "Choose at least one candidate." };
  const on = formData.get("top") === "on" || formData.get("top") === "true";
  const supabase = await createClient();
  let changed = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase
      .from("candidates")
      .update({ top_candidate: on })
      .in("id", ids.slice(i, i + 500))
      .neq("top_candidate", on)
      .select("id");
    if (error) {
      console.error("setTopCandidates", error.code, error.message);
      return { error: GENERIC_ERROR };
    }
    changed += data?.length ?? 0;
  }
  if (on) await processNow(ids, "top_candidate");
  refresh(ids);
  return {
    ok: true,
    message: on
      ? `${changed} marked as top candidate. Candidates in the Academy get the extra modules and a mail.`
      : `${changed} no longer top candidate. Their progress stays.`,
  };
}

/** Add enrolled candidates to an Academy group (others are enrolled into it). */
export async function addCandidatesToGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("academy");
  const group = formData.get("group_id");
  if (typeof group !== "string" || !guid.safeParse(group).success) return { error: "Choose a group." };
  const ids = await targetIds(formData);
  if (ids.length === 0) return { error: "Choose at least one candidate." };
  const supabase = await createClient();
  const { data: members } = await supabase.from("academy_members").select("profile_id, candidate_id").in("candidate_id", ids.slice(0, 1000));
  const rows = (members ?? []).map((m) => ({ group_id: group, profile_id: m.profile_id }));
  if (rows.length > 0) {
    const { error } = await supabase.from("academy_group_members").upsert(rows, { onConflict: "group_id,profile_id", ignoreDuplicates: true });
    if (error) {
      console.error("addCandidatesToGroup", error.code, error.message);
      return { error: GENERIC_ERROR };
    }
  }
  refresh(ids);
  const missing = ids.length - rows.length;
  return {
    ok: true,
    message: `${rows.length} added to the group.${missing > 0 ? ` ${missing} are not in the Academy yet: add them to the developer course with this group.` : ""}`,
  };
}

/** Finish what is queued for one candidate (retry after a failure). */
export async function processCandidateAcademy(candidateId: string): Promise<ActionState> {
  const user = await requireModule("recruitment");
  if (!guid.safeParse(candidateId).success) return { error: "Candidate not found." };
  if (!hasModule(user, "academy")) return { error: "Only Academy managers run the Academy automation." };
  const admin = createAdminClient();
  if (!admin) return { error: NO_KEY };
  // A failed event at its attempt limit gets one more go when asked by hand.
  await admin.from("academy_ats_events").update({ status: "pending" }).eq("candidate_id", candidateId).eq("status", "failed");
  const { data: events } = await admin.from("academy_ats_events").select("id").eq("candidate_id", candidateId).eq("status", "pending");
  const summary = await processAtsEvents(admin, { eventIds: (events ?? []).map((e) => e.id) });
  refresh([candidateId]);
  return summary.failed > 0
    ? { error: `${summary.failed} step(s) failed; see the log on this card.` }
    : { ok: true, message: summary.seen === 0 ? "Nothing waiting." : `${summary.done} done.` };
}

/** The bulk bar of the talent pool: one form, the chosen operation. */
export async function poolBulkAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  switch (formData.get("op")) {
    case "enrol":
      return enrolCandidates(prev, formData);
    case "top_on":
      formData.set("top", "true");
      return setTopCandidates(prev, formData);
    case "top_off":
      formData.set("top", "false");
      return setTopCandidates(prev, formData);
    case "group":
      return addCandidatesToGroup(prev, formData);
    default:
      return { error: "Choose what to do." };
  }
}

/** Run the Academy automation of a placement (again): accounts, courses, placement page, mails. */
export async function runPlacementAcademy(placementId: string): Promise<ActionState> {
  await requireModule("academy");
  if (!guid.safeParse(placementId).success) return { error: "Placement not found." };
  const admin = createAdminClient();
  if (!admin) {
    // Without the key only the database part can run (no new accounts, no mail).
    const supabase = await createClient();
    const { error } = await supabase.rpc("academy_ats_rerun_placement", { p_placement_id: placementId });
    if (error) return { error: GENERIC_ERROR };
    revalidatePath(`/dashboard/placements/${placementId}`);
    return { ok: true, message: `Database part done. ${NO_KEY}` };
  }
  // A placement recorded before the Academy link has no event yet.
  const { data: placement } = await admin.from("placements").select("id, candidate_id, vacancy_id").eq("id", placementId).maybeSingle();
  if (!placement) return { error: "Placement not found." };
  await admin
    .from("academy_ats_events")
    .upsert(
      { kind: "placed", dedupe_key: `placed:${placement.id}`, placement_id: placement.id, candidate_id: placement.candidate_id, vacancy_id: placement.vacancy_id },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  await admin.from("academy_ats_events").update({ status: "pending" }).eq("placement_id", placementId).in("status", ["failed", "done", "skipped"]);
  const summary = await processAtsEvents(admin, { placementId });
  revalidatePath(`/dashboard/placements/${placementId}`);
  return summary.failed > 0 ? { error: "The automation failed; see the error below." } : { ok: true, message: "Done. Steps that were already done were not repeated." };
}
