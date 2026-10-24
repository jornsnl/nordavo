import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ProfileRole } from "@/lib/database.types";
import { MFA_VERIFY_PATH, checkSecondStep } from "@/lib/security/mfa";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: ProfileRole;
  /** Only set for client portal users. */
  clientId: string | null;
};

/**
 * Data Access Layer entry point: the one place that reads the session.
 * Reads the request, so call it from a component inside a <Suspense> boundary.
 * A session that still needs its authenticator app code goes to /login/verificatie,
 * so never call this from that page.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/login");
  }

  // Same check as the proxy, for requests it did not see (and as a second line of defence).
  const cookieStore = await cookies();
  const step = await checkSecondStep(supabase, data.claims, (name) => cookieStore.get(name)?.value);
  if (step.required) {
    redirect(MFA_VERIFY_PATH);
  }

  const userId = data.claims.sub;
  const email = (data.claims.email as string | undefined) ?? "";

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, client_id")
    .eq("id", userId)
    .maybeSingle();

  const role: ProfileRole =
    profile?.role === "admin" || profile?.role === "client"
      ? profile.role
      : "member";

  return {
    id: userId,
    email,
    name: profile?.full_name || email.split("@")[0] || "Nordavo",
    role,
    clientId: role === "client" ? (profile?.client_id ?? null) : null,
  };
});

export function isStaff(user: CurrentUser) {
  return user.role === "admin" || user.role === "member";
}

/** The landing page for a user, based on their role. */
export function homePathFor(user: CurrentUser) {
  return isStaff(user) ? "/dashboard" : "/portaal";
}

/** Nordavo team only. Client users are sent to their portal. */
export async function requireStaff(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!isStaff(user)) redirect("/portaal");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireStaff();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

/** Client portal users only, always linked to a client company. */
export async function requireClient(): Promise<CurrentUser & { clientId: string }> {
  const user = await getCurrentUser();
  if (isStaff(user)) redirect("/dashboard");
  if (!user.clientId) redirect("/login?error=account");
  return { ...user, clientId: user.clientId };
}
