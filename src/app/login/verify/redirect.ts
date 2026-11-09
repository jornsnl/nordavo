import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isAcademyOnlyRole, landingPathFor } from "@/lib/academy/routing";
import { safeNextPath } from "@/lib/safe-redirect";

/** Where to go once both steps are done: same rules as the password login. */
export async function pathAfterSignIn(userId: string, next: unknown): Promise<string> {
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  return profile?.role === "client" || isAcademyOnlyRole(profile?.role)
    ? landingPathFor(profile?.role, next)
    : safeNextPath(next);
}
