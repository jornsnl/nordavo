"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import {
  fieldErrorsFrom,
  formValues,
  GENERIC_ERROR,
  type ActionState,
} from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.guid();

const clientSchema = z.object({
  name: z
    .string({ error: "Enter a name." })
    .min(1, "Enter a name.")
    .max(200, "Use at most 200 characters."),
  website: z
    .string()
    .max(300, "Use at most 300 characters.")
    .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .pipe(z.url({ error: "This is not a valid website." }))
    .optional(),
  industry: z.string().max(200, "Use at most 200 characters.").optional(),
  city: z.string().max(200, "Use at most 200 characters.").optional(),
  status: z.enum(["lead", "active", "inactive"], { error: "Choose a status." }),
  owner_id: z.guid({ error: "Choose a team member." }).optional(),
  notes: z.string().max(5000, "Use at most 5000 characters.").optional(),
});

function toRow(data: z.infer<typeof clientSchema>) {
  return {
    name: data.name,
    website: data.website ?? null,
    industry: data.industry ?? null,
    city: data.city ?? null,
    status: data.status,
    owner_id: data.owner_id ?? null,
    notes: data.notes ?? null,
  };
}

export async function createClientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = clientSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert(toRow(parsed.data))
    .select("id")
    .single();
  if (error) return { error: GENERIC_ERROR };

  revalidatePath("/dashboard/clients");
  redirect(`/dashboard/clients/${data.id}`);
}

export async function updateClientAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!idSchema.safeParse(id).success) return { error: GENERIC_ERROR };
  const parsed = clientSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("clients").update(toRow(parsed.data)).eq("id", id);
  if (error) return { error: GENERIC_ERROR };

  revalidatePath("/dashboard/clients");
  revalidatePath(`/dashboard/clients/${id}`);
  redirect(`/dashboard/clients/${id}`);
}

export async function deleteClientAction(
  id: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(id).success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) {
    // 23503: foreign key violation, placements reference this client (on delete restrict).
    if (error.code === "23503") {
      return {
        error:
          "This client has placements, so it cannot be deleted. Set the client to inactive if you no longer work with them.",
      };
    }
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/clients");
  revalidatePath("/dashboard/vacancies");
  redirect("/dashboard/clients");
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const contactSchema = z.object({
  contact_id: z.guid().optional(),
  full_name: z
    .string({ error: "Enter a name." })
    .min(1, "Enter a name.")
    .max(200, "Use at most 200 characters."),
  email: z.email({ error: "This is not a valid email address." }).optional(),
  phone: z.string().max(50, "Use at most 50 characters.").optional(),
  job_title: z.string().max(200, "Use at most 200 characters.").optional(),
  linkedin_url: z
    .url({ protocol: /^https?$/, error: "Enter a valid LinkedIn link, starting with https://" })
    .max(500, "This link is too long.")
    .optional(),
  is_primary: z.literal("on").optional(),
});

export async function saveContactAction(
  clientId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!idSchema.safeParse(clientId).success) return { error: GENERIC_ERROR };
  const parsed = contactSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { contact_id, is_primary, ...fields } = parsed.data;
  const row = {
    full_name: fields.full_name,
    email: fields.email ?? null,
    phone: fields.phone ?? null,
    job_title: fields.job_title ?? null,
    linkedin_url: fields.linkedin_url ?? null,
    is_primary: is_primary === "on",
  };

  const supabase = await createClient();

  // Only one primary contact per client: unset the others first.
  if (row.is_primary) {
    let unset = supabase
      .from("client_contacts")
      .update({ is_primary: false })
      .eq("client_id", clientId)
      .eq("is_primary", true);
    if (contact_id) unset = unset.neq("id", contact_id);
    const { error } = await unset;
    if (error) return { error: GENERIC_ERROR };
  }

  const { error } = contact_id
    ? await supabase
        .from("client_contacts")
        .update(row)
        .eq("id", contact_id)
        .eq("client_id", clientId)
    : await supabase.from("client_contacts").insert({ ...row, client_id: clientId });
  if (error) return { error: GENERIC_ERROR };

  revalidatePath(`/dashboard/clients/${clientId}`);
  return { ok: true, message: contact_id ? "Contact updated." : "Contact added." };
}

export async function deleteContactAction(
  clientId: string,
  contactId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(clientId).success || !idSchema.safeParse(contactId).success) {
    return { error: GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("client_contacts")
    .delete()
    .eq("id", contactId)
    .eq("client_id", clientId);
  if (error) return { error: GENERIC_ERROR };

  revalidatePath(`/dashboard/clients/${clientId}`);
  return { ok: true, message: "Contact deleted." };
}
