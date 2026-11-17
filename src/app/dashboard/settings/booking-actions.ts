"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireAdmin } from "@/lib/auth";
import { isHttpsUrl } from "@/lib/sales/booking";
import { createClient } from "@/lib/supabase/server";

// The Cal.com links callers send leads to for a sales meeting (feedback Julius:
// "Cal link voor salesafspraken nergens in te stellen"). Admins only; RLS on
// sales_booking_links checks it again. With more than one link the caller
// picks who the meeting is with (Julius or Floris).

const fieldName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,60}$/, { error: "Use letters, digits, - and _ only." });

const linkSchema = z.object({
  label: z.string({ error: "Give the link a name." }).trim().min(1, { error: "Give the link a name." }).max(60, { error: "At most 60 characters." }),
  url: z
    .string({ error: "Paste the Cal.com link." })
    .trim()
    .max(500, { error: "That link is too long." })
    .refine(isHttpsUrl, { error: "Start with https://, for example https://cal.com/your-name/kennismaking." }),
  company_field: fieldName.default("bedrijfsnaam"),
  role_field: fieldName.default("welke-rol-zoek-je"),
});

function friendly(message: string): string {
  if (/does not exist|schema cache/i.test(message)) return "Apply the latest database migrations first.";
  if (/row-level security|42501/.test(message)) return "Only an admin can change the booking links.";
  return GENERIC_ERROR;
}

function done() {
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/calls");
  revalidatePath("/caller/call");
}

/** Adds a link; the first one is what every caller uses until a second one is added. */
export async function addBookingLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = linkSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const db = await createClient();
  const { count } = await db.from("sales_booking_links").select("id", { count: "exact", head: true });
  const { error } = await db.from("sales_booking_links").insert({ ...parsed.data, position: count ?? 0 });
  if (error) {
    console.error("addBookingLink", error.code, error.message);
    return { error: friendly(error.message) };
  }
  done();
  return { ok: true, message: "Link added." };
}

export async function updateBookingLink(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  if (!z.guid().safeParse(id).success) return { error: GENERIC_ERROR };
  const parsed = linkSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const db = await createClient();
  const { error } = await db.from("sales_booking_links").update(parsed.data).eq("id", id);
  if (error) {
    console.error("updateBookingLink", error.code, error.message);
    return { error: friendly(error.message) };
  }
  done();
  return { ok: true, message: "Link saved." };
}

export async function deleteBookingLink(id: string): Promise<ActionState> {
  await requireAdmin();
  if (!z.guid().safeParse(id).success) return { error: GENERIC_ERROR };
  const db = await createClient();
  const { error } = await db.from("sales_booking_links").delete().eq("id", id);
  if (error) {
    console.error("deleteBookingLink", error.code, error.message);
    return { error: friendly(error.message) };
  }
  done();
  return { ok: true, message: "Link removed." };
}
