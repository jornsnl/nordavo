"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireAcademyManager } from "@/lib/academy/auth";
import { listAcademyPoolIds } from "@/lib/academy/ats/data";
import { parsePoolParams } from "@/lib/academy/ats/pool";
import { processAtsEvents } from "@/lib/academy/ats/process";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Settings of the Academy and ATS link and of candidate groups
// (docs/academy.md, ATS-koppeling). Academy managers only; RLS checks again.

const guid = z.guid();
const PATH = "/dashboard/academy/automation";

const days = (min: number, max: number) => z.coerce.number({ error: "Enter a number" }).int().min(min, { error: `At least ${min}` }).max(max, { error: `At most ${max}` });

const settingsSchema = z.object({
  developer_course_id: z.guid().optional(),
  client_course_id: z.guid().optional(),
  reminder_after_days: days(1, 90),
  reminder_repeat_days: days(1, 90),
  reminder_max: days(0, 10),
  retention_months: days(1, 120),
  retention_action: z.enum(["anonymise", "delete"]),
});

export async function saveAtsSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAcademyManager();
  const parsed = settingsSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const on = (key: string) => formData.get(key) === "on";
  const topModules = formData.getAll("top_candidate_module_ids").filter((v): v is string => typeof v === "string" && guid.safeParse(v).success);
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_ats_settings")
    .update({
      developer_course_id: parsed.data.developer_course_id ?? null,
      client_course_id: parsed.data.client_course_id ?? null,
      top_candidate_module_ids: topModules,
      top_candidate_mail: on("top_candidate_mail"),
      invite_client_contact: on("invite_client_contact"),
      welcome_mail: on("welcome_mail"),
      reminder_enabled: on("reminder_enabled"),
      reminder_after_days: parsed.data.reminder_after_days,
      reminder_repeat_days: parsed.data.reminder_repeat_days,
      reminder_max: parsed.data.reminder_max,
      retention_months: parsed.data.retention_months,
      retention_action: parsed.data.retention_action,
      retention_enabled: on("retention_enabled"),
      updated_by: user.id,
    })
    .eq("id", true);
  if (error) {
    console.error("saveAtsSettings", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

/** One more go for an event (also one that failed five times). */
export async function retryAtsEvent(eventId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(eventId).success) return { error: "Not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_ats_events").update({ status: "pending" }).eq("id", eventId).in("status", ["failed", "pending"]);
  if (error) return { error: GENERIC_ERROR };
  const admin = createAdminClient();
  if (!admin) return { ok: true, message: "Queued again. It runs once SUPABASE_SECRET_KEY is set (job academy-ats-sync)." };
  const summary = await processAtsEvents(admin, { eventIds: [eventId] });
  revalidatePath(PATH);
  return summary.failed > 0 ? { error: "It failed again; see the error in the log." } : { ok: true, message: "Done." };
}

const groupSchema = z.object({ group_id: z.guid({ error: "Group not found" }) });

/** Automatic enrolment of a vacancy group, with extra modules. */
export async function saveGroupSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = groupSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Group not found." };
  const modules = formData.getAll("open_module_ids").filter((v): v is string => typeof v === "string" && guid.safeParse(v).success);
  const supabase = await createClient();
  const { error } = await supabase.from("academy_group_settings").upsert(
    {
      group_id: parsed.data.group_id,
      auto_enrol: formData.get("auto_enrol") === "on",
      send_mail: formData.get("send_mail") === "on",
      open_module_ids: modules,
    },
    { onConflict: "group_id" },
  );
  if (error) {
    console.error("saveGroupSettings", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  const vacancy = formData.get("vacancy_id");
  const { error: groupError } = await supabase
    .from("academy_groups")
    .update({ vacancy_id: typeof vacancy === "string" && guid.safeParse(vacancy).success ? vacancy : null })
    .eq("id", parsed.data.group_id);
  if (groupError) {
    console.error("saveGroupSettings vacancy", groupError.code, groupError.message);
    return { error: GENERIC_ERROR };
  }
  revalidatePath(`/dashboard/academy/groups/${parsed.data.group_id}`);
  return { ok: true, message: "Saved. New candidates of the vacancy follow these settings." };
}

/** Everyone already in the vacancy's pipeline into the group and the developer course. */
export async function enrolVacancyIntoGroup(groupId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(groupId).success) return { error: "Group not found." };
  const supabase = await createClient();
  const [{ data: group }, { data: settings }] = await Promise.all([
    supabase.from("academy_groups").select("vacancy_id").eq("id", groupId).maybeSingle(),
    supabase.from("academy_group_settings").select("open_module_ids, send_mail").eq("group_id", groupId).maybeSingle(),
  ]);
  if (!group?.vacancy_id) return { error: "Link the group to a vacancy first." };
  const ids = await listAcademyPoolIds({ ...parsePoolParams({ vacancy: group.vacancy_id }), page: 1 });
  if (ids.length === 0) return { error: "Nobody is in this vacancy's pipeline yet." };
  const { data: queued, error } = await supabase.rpc("academy_ats_queue_enrol", {
    p_candidate_ids: ids,
    p_group_id: groupId,
    p_open_module_ids: settings?.open_module_ids ?? [],
    p_send_mail: settings?.send_mail ?? true,
  });
  if (error) {
    console.error("enrolVacancyIntoGroup", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  const admin = createAdminClient();
  let done = 0;
  if (admin) {
    const { data: events } = await admin.from("academy_ats_events").select("id").eq("kind", "enrol").eq("status", "pending").eq("group_id", groupId).limit(25);
    done = (await processAtsEvents(admin, { eventIds: (events ?? []).map((e) => e.id) })).done;
  }
  revalidatePath(`/dashboard/academy/groups/${groupId}`);
  return {
    ok: true,
    message: `${queued ?? 0} candidates queued, ${done} done now; the rest follow within the hour (job academy-ats-sync)${admin ? "" : " once SUPABASE_SECRET_KEY is set"}.`,
  };
}
