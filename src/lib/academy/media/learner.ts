import "server-only";
import type { AcademyCertificateRow, AcademyNotificationRow } from "@/lib/academy/database";
import { requireAcademyUser } from "@/lib/academy/auth";
import { createClient } from "@/lib/supabase/server";

// Learner data of the media area: notifications and certificates.

/** The newest notifications of the signed-in user (RLS: own only). */
export async function listMyNotifications(limit = 100): Promise<AcademyNotificationRow[]> {
  const user = await requireAcademyUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_notifications")
    .select("*")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  return data ?? [];
}

/** The certificate of the signed-in user for a course, if issued. */
export async function getMyCertificate(courseId: string): Promise<AcademyCertificateRow | null> {
  const user = await requireAcademyUser();
  if (!user.member) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("academy_certificates").select("*").eq("profile_id", user.id).eq("course_id", courseId).maybeSingle();
  return data ?? null;
}
