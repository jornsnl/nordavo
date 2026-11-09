import "server-only";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type StaffMember = { id: string; name: string };

/** Team members (admins and members) for owner and assignee pickers. */
export async function listStaff(): Promise<StaffMember[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("role", ["admin", "member"])
    .order("full_name");
  if (error) throw new Error(`Could not load team members: ${error.message}`);
  return data.map((p) => ({ id: p.id, name: p.full_name || p.email || "Unknown" }));
}
