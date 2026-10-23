import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
};

/**
 * Data Access Layer entry point: the one place that reads the session.
 * Reads the request, so call it from a component inside a <Suspense> boundary.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/login");
  }

  const userId = data.claims.sub;
  const email = (data.claims.email as string | undefined) ?? "";

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", userId)
    .maybeSingle();

  return {
    id: userId,
    email,
    name: profile?.full_name || email.split("@")[0] || "Nordavo",
    role: profile?.role === "admin" ? "admin" : "member",
  };
});
