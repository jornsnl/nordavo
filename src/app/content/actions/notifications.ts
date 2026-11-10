"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ContentPrefKind } from "@/lib/content/database";
import { requireContentUser } from "@/lib/content/data";
import { contentErrorMessage, type ContentActionState } from "@/lib/content/errors";
import { checkbox } from "@/lib/content/forms";
import { notificationKinds } from "@/lib/content/rules";

/** Notifications of the signed-in user: mark read, and the personal preferences. */

export async function markNotificationReadAction(id: number): Promise<ContentActionState> {
  const user = await requireContentUser();
  if (!z.number().int().positive().safeParse(id).success) return { error: "Not found." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { error: contentErrorMessage(error) };
  revalidatePath("/content", "layout");
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<ContentActionState> {
  const user = await requireContentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) return { error: contentErrorMessage(error) };
  revalidatePath("/content", "layout");
  return { ok: true, message: "All marked as read." };
}

/** One form with in_app:<kind> and email:<kind> checkboxes for every kind. */
export async function saveNotificationPrefsAction(_prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  const user = await requireContentUser();
  const supabase = await createClient();
  const rows = notificationKinds.map((k) => ({
    user_id: user.id,
    kind: k.value as ContentPrefKind,
    // The Monday summary is a mail only.
    in_app: k.value === "weekly_summary" ? false : checkbox(formData, `in_app:${k.value}`),
    email: checkbox(formData, `email:${k.value}`),
  }));
  const { error } = await supabase.from("content_notification_prefs").upsert(rows, { onConflict: "user_id,kind" });
  if (error) return { error: contentErrorMessage(error) };
  revalidatePath("/content/settings");
  return { ok: true, message: "Preferences saved." };
}
