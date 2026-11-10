"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContentUser } from "@/lib/content/data";
import { contentErrorMessage, type ContentActionState } from "@/lib/content/errors";
import { isDay } from "@/lib/content/rules";
import { createClient } from "@/lib/supabase/server";

/**
 * Planning writes: rescheduling (calendar drag or the date fields),
 * scheduling and publishing. The post triggers enforce the rules (approval,
 * date and slot, media, LinkedIn URL); their messages are shown as is.
 */

const id = z.guid();
const slot = z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/).max(60);

function done(message?: string): ContentActionState {
  revalidatePath("/content", "layout");
  return { ok: true, message };
}

function dateOrNull(value: FormDataEntryValue | null | undefined): string | null | "invalid" {
  if (typeof value !== "string" || value.trim() === "") return null;
  return isDay(value.trim()) ? value.trim() : "invalid";
}

/** Move a post to another day (and slot); null clears the date. Used by the calendar drag. */
export async function reschedulePostAction(postId: string, plannedDate: string | null, timeSlot: string | null): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success) return { error: "Post not found." };
  if (plannedDate !== null && !isDay(plannedDate)) return { error: "Pick a valid date." };
  if (timeSlot !== null && !slot.safeParse(timeSlot).success) return { error: "Pick a valid time slot." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_posts")
    .update({ planned_date: plannedDate, time_slot: timeSlot })
    .eq("id", postId)
    .select("id");
  if (error) return { error: contentErrorMessage(error) };
  if (!data?.length) return { error: "You cannot reschedule this post." };
  return done(plannedDate ? `Moved to ${plannedDate}.` : "Date removed.");
}

/** Date and time slot from the publish panel, optionally setting the post to Scheduled. */
export async function savePlanningAction(postId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success) return { error: "Post not found." };
  const plannedDate = dateOrNull(formData.get("planned_date"));
  if (plannedDate === "invalid") return { error: "Check the date.", fieldErrors: { planned_date: "Pick a valid date" } };
  const rawSlot = formData.get("time_slot");
  const timeSlot = typeof rawSlot === "string" && rawSlot ? rawSlot : null;
  if (timeSlot && !slot.safeParse(timeSlot).success) return { error: "Pick a valid time slot." };
  const schedule = formData.get("intent") === "schedule";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_posts")
    .update({ planned_date: plannedDate, time_slot: timeSlot, ...(schedule ? { status: "scheduled" } : {}) })
    .eq("id", postId)
    .select("id");
  if (error) return { error: contentErrorMessage(error) };
  if (!data?.length) return { error: "You cannot change this post." };
  return done(schedule ? "Scheduled." : "Date saved.");
}

const urlSchema = z
  .string({ error: "Paste the LinkedIn URL" })
  .trim()
  .min(1, { error: "Paste the LinkedIn URL" })
  .max(2000)
  .regex(/^https?:\/\/\S+$/i, { error: "Paste the full link, starting with https://" });

/** Paste the LinkedIn URL once the post is live: the post moves to Published. */
export async function publishPostAction(postId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success) return { error: "Post not found." };
  const parsed = urlSchema.safeParse(formData.get("linkedin_url"));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: { linkedin_url: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { data: current } = await supabase.from("content_posts").select("status").eq("id", postId).maybeSingle();
  if (!current) return { error: "Post not found." };
  const live = current.status === "published" || current.status === "measured";
  const { data, error } = await supabase
    .from("content_posts")
    .update({ linkedin_url: parsed.data, ...(live ? {} : { status: "published" }) })
    .eq("id", postId)
    .select("id");
  if (error) return { error: contentErrorMessage(error) };
  if (!data?.length) return { error: "You cannot change this post." };
  return done(live ? "Link updated." : "Marked as published.");
}
