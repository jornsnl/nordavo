import "server-only";
import { getCurrentUser, requireAdmin, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user's own profile, for the settings page. */
export async function getOwnProfile() {
  const user = await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    fullName: data?.full_name ?? "",
    email: data?.email ?? user.email,
    role: user.role,
  };
}

/** Every user of the portal. Admins only. */
export async function listProfiles() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, client_id, created_at, client:clients(id, name)")
    .order("role")
    .order("full_name");

  if (error) throw new Error(`Gebruikers laden mislukt: ${error.message}`);
  return data;
}

export type ProfileListItem = Awaited<ReturnType<typeof listProfiles>>[number];

/** Clients a client account can be linked to. Admins only. */
export async function listClientOptions() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").select("id, name").order("name");
  if (error) throw new Error(`Klanten laden mislukt: ${error.message}`);
  return data;
}

export async function isCurrentUserAdmin() {
  const user = await getCurrentUser();
  return user.role === "admin";
}
