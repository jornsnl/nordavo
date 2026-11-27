"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModule } from "@/lib/auth";
import { newRouteSchema, routePatchSchema, type SalesRouteRow } from "@/lib/sales/routes";
import { createClient } from "@/lib/supabase/server";

// Running routes (deel B): add, change and delete rows straight in the table.
// Changes in the portal are logged on the row with source handmatig; Claude
// writes with source claude (src/lib/mcp/routes-tools.ts).

type Result = { ok: true; row?: SalesRouteRow } | { ok: false; error: string };

const PATH = "/dashboard/routes";

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the value.";
}

export async function addRouteAction(input: unknown): Promise<Result> {
  const user = await requireModule("sales");
  const parsed = newRouteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_routes")
    .insert({ ...parsed.data, created_by: user.id, updated_by: user.id, created_source: "handmatig", updated_source: "handmatig" })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: "Could not add the route." };
  revalidatePath(PATH);
  return { ok: true, row: data };
}

export async function updateRouteAction(id: string, patch: unknown): Promise<Result> {
  const user = await requireModule("sales");
  if (!z.guid().safeParse(id).success) return { ok: false, error: "Unknown route." };
  const parsed = routePatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_routes")
    .update({ ...parsed.data, updated_by: user.id, updated_source: "handmatig" })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: "Could not save the change." };
  if (!data) return { ok: false, error: "This route no longer exists." };
  revalidatePath(PATH);
  return { ok: true, row: data };
}

export async function deleteRouteAction(id: string): Promise<Result> {
  await requireModule("sales");
  if (!z.guid().safeParse(id).success) return { ok: false, error: "Unknown route." };
  const supabase = await createClient();
  const { error } = await supabase.from("sales_routes").delete().eq("id", id);
  if (error) return { ok: false, error: "Could not delete the route." };
  revalidatePath(PATH);
  return { ok: true };
}
