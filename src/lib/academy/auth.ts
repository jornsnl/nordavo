import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { type CurrentUser, getCurrentUser, hasModule, homePathFor, requireModule } from "@/lib/auth";
import type { AcademyLocale, AcademyMemberRow, AcademyRole } from "@/lib/academy/database";
import { safeZone } from "@/lib/academy/time";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type AcademyUser = CurrentUser & {
  /** The Academy row; null for a Nordavo manager who only previews. */
  member: AcademyMemberRow | null;
  academyRole: AcademyRole | null;
  locale: AcademyLocale;
  /** profiles.time_zone, checked. */
  timeZone: string;
  /** Admin or member with module academy: manages content and people, previews everything. */
  isManager: boolean;
};

/**
 * Everyone who may open /academy: participants (academy_members) and
 * Academy managers (preview). Others go to their own home page. Read inside
 * a <Suspense> boundary, like getCurrentUser().
 */
export const requireAcademyUser = cache(async (): Promise<AcademyUser> => {
  const user = await getCurrentUser();
  const isManager = hasModule(user, "academy");
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("academy_members")
    .select("*")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!member && !isManager) {
    const home = homePathFor(user);
    redirect(home === "/academy" ? "/login?error=academy" : home);
  }

  return {
    ...user,
    member: member ?? null,
    academyRole: member?.academy_role ?? null,
    locale: member?.locale ?? "en",
    timeZone: safeZone(user.timeZone),
    isManager,
  };
});

/**
 * The Academy role of a client user, for the sign-in redirects
 * (landingPathFor): client_member and client_reader land in the Academy, not
 * the portal. Null for other portal roles.
 */
export async function clientAcademyRole(
  db: SupabaseClient<Database>,
  userId: string,
  role: string | null | undefined,
): Promise<string | null> {
  if (role !== "client") return null;
  const { data } = await db.from("academy_members").select("academy_role").eq("profile_id", userId).maybeSingle();
  return data?.academy_role ?? null;
}

/** Nordavo team members with module academy (and admins). */
export async function requireAcademyManager(): Promise<CurrentUser> {
  return requireModule("academy");
}
