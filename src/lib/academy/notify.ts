import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AcademyLocale } from "@/lib/academy/database";
import type { Database, Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The one way to create an in-app Academy notification from TypeScript
 * (docs/academy.md, Meldingen). Every Academy builder uses this:
 *
 *   await notifyAcademy({
 *     profileId,
 *     kind: "task_overdue",                       // free text, max 60
 *     title: { nl: "Een taak is te laat", en: "A task is overdue" },
 *     body: { nl: "...", en: "..." },             // optional
 *     link: `/academy/courses/${courseId}`,       // a path in the portal
 *     payload: { task_id: taskId },               // optional
 *   });
 *
 * Texts may be one string or { nl, en }; the person's Academy language
 * (academy_members.locale) picks the version. Notifications appear behind the
 * bell and on /academy/notifications, and go out in the person's daily or
 * weekly mail summary (job academy-digest).
 *
 * Writes with the service role (academy_notify) when SUPABASE_SECRET_KEY is
 * set, else with the given client (an Academy manager may insert through
 * RLS). Never throws: returns how many were created.
 *
 * From SQL (security definer functions, triggers):
 *   perform public.academy_notify(profile_id, kind, title, body, link, payload);
 */

export type LocalizedText = string | { nl: string; en: string };

export type AcademyNotificationInput = {
  profileId: string;
  kind: string;
  title: LocalizedText;
  body?: LocalizedText | null;
  /** A path inside the portal, starting with /. */
  link?: string | null;
  payload?: Json;
};

type Db = SupabaseClient<Database>;

export function localize(text: LocalizedText | null | undefined, locale: AcademyLocale): string | null {
  if (text === null || text === undefined) return null;
  return typeof text === "string" ? text : (text[locale] ?? text.en);
}

export async function notifyAcademy(input: AcademyNotificationInput | AcademyNotificationInput[], options: { db?: Db } = {}): Promise<number> {
  const items = (Array.isArray(input) ? input : [input]).filter((i) => i.profileId && i.kind);
  if (items.length === 0) return 0;
  const db = (createAdminClient() as Db | null) ?? options.db ?? null;
  if (!db) {
    console.warn("[academy] notification not created: no service role key and no client");
    return 0;
  }

  const ids = [...new Set(items.map((i) => i.profileId))];
  const { data: members } = await db.from("academy_members").select("profile_id, locale").in("profile_id", ids);
  const locales = new Map((members ?? []).map((m) => [m.profile_id, m.locale]));

  const rows = items.map((i) => {
    const locale = locales.get(i.profileId) ?? "en";
    return {
      profile_id: i.profileId,
      kind: i.kind.slice(0, 60),
      title: (localize(i.title, locale) ?? "").slice(0, 300) || "Nordavo Academy",
      body: localize(i.body, locale)?.slice(0, 5000) ?? null,
      link: i.link && i.link.startsWith("/") ? i.link.slice(0, 1000) : null,
      payload: i.payload ?? {},
    };
  });

  const { error, count } = await db.from("academy_notifications").insert(rows, { count: "exact" });
  if (error) {
    console.error("[academy] notification not created:", error.code, error.message);
    return 0;
  }
  return count ?? rows.length;
}
