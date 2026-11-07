"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  type ActionState,
  GENERIC_ERROR,
  fieldErrorsFrom,
  formValues,
} from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { addDays, addMonths } from "@/components/placements/dates";

const id = z.guid();

const CHECKIN_TASK_TITLE = "Client check-in";

const date = (message: string) => z.iso.date({ error: message });

const money = z
  .string()
  .regex(/^\d{1,8}([.,]\d{1,2})?$/, { error: "Enter an amount, for example 4500" })
  .transform((value) => Number(value.replace(",", ".")))
  .optional();

const placementSchema = z
  .object({
    client_id: z.guid({ error: "Choose a client" }),
    candidate_id: z.guid({ error: "Choose a candidate" }),
    vacancy_id: z.guid({ error: "Choose a valid vacancy" }).optional(),
    application_id: z.guid().optional(),
    start_date: date("Enter a start date"),
    monthly_rate: money,
    next_checkin_at: date("Enter a valid date").optional(),
    end_date: date("Enter a valid date").optional(),
    notes: z.string().max(5000, { error: "At most 5000 characters" }).optional(),
  })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, {
    error: "The end date is before the start date",
    path: ["end_date"],
  });

const revalidateAll = (placementId?: string) => {
  revalidatePath("/dashboard/placements");
  revalidatePath("/dashboard");
  if (placementId) revalidatePath(`/dashboard/placements/${placementId}`);
};

/**
 * Creates a placement and closes the loop in one go: application to
 * "placed", candidate to "placed", vacancy to "filled" and two follow-up tasks.
 */
export async function createPlacement(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireStaff();
  const parsed = placementSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const input = parsed.data;
  const supabase = await createClient();

  let clientId = input.client_id;
  let candidateId = input.candidate_id;
  let vacancyId = input.vacancy_id ?? null;
  let applicationId = input.application_id ?? null;

  if (applicationId) {
    // The application decides who is placed where; the form fields are locked.
    const { data: application } = await supabase
      .from("applications")
      .select("id, candidate_id, vacancy:vacancies(id, client_id)")
      .eq("id", applicationId)
      .maybeSingle();
    if (!application?.vacancy) {
      return { error: "This application no longer exists. Choose the client and candidate yourself." };
    }
    const { data: existing } = await supabase
      .from("placements")
      .select("id")
      .eq("application_id", applicationId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return { error: "A placement already exists for this application." };
    }
    candidateId = application.candidate_id;
    vacancyId = application.vacancy.id;
    if (!application.vacancy.client_id) {
      return { error: "Link this vacancy to a client before you record a placement." };
    }
    clientId = application.vacancy.client_id;
  } else if (vacancyId) {
    const { data: vacancy } = await supabase
      .from("vacancies")
      .select("client_id")
      .eq("id", vacancyId)
      .maybeSingle();
    if (!vacancy || vacancy.client_id !== clientId) {
      return {
        error: "Check the highlighted fields.",
        fieldErrors: { vacancy_id: "This vacancy does not belong to the chosen client" },
      };
    }
    // Link the pipeline entry if the candidate was already in this vacancy.
    const { data: application } = await supabase
      .from("applications")
      .select("id")
      .eq("vacancy_id", vacancyId)
      .eq("candidate_id", candidateId)
      .maybeSingle();
    applicationId = application?.id ?? null;
  }

  const nextCheckin = input.next_checkin_at ?? addDays(input.start_date, 14);

  const { data: placement, error } = await supabase
    .from("placements")
    .insert({
      client_id: clientId,
      candidate_id: candidateId,
      vacancy_id: vacancyId,
      application_id: applicationId,
      start_date: input.start_date,
      monthly_rate: input.monthly_rate ?? null,
      next_checkin_at: nextCheckin,
      notes: input.notes ?? null,
    })
    .select("id, guarantee_until")
    .single();

  if (error || !placement) {
    console.error("createPlacement", error);
    return { error: GENERIC_ERROR };
  }

  const today = todayIso();
  const guaranteeUntil = placement.guarantee_until ?? addDays(input.start_date, 30);

  const followUps = await Promise.all([
    applicationId
      ? supabase.from("applications").update({ stage: "placed" }).eq("id", applicationId)
      : null,
    supabase.from("candidates").update({ status: "placed" }).eq("id", candidateId),
    vacancyId
      ? supabase.from("vacancies").update({ status: "filled", closed_at: today }).eq("id", vacancyId)
      : null,
    supabase.from("tasks").insert([
      {
        title: CHECKIN_TASK_TITLE,
        description: "How is the developer doing? Ask about collaboration, pace and communication.",
        due_date: nextCheckin,
        // Bulk inserts send NULL for keys missing in a row, so every row
        // lists the same columns.
        priority: "normal",
        assignee_id: user.id,
        entity_type: "placement",
        entity_id: placement.id,
      },
      {
        title: "Guarantee period review",
        description:
          "The 30-day guarantee period is ending. Check with the client that everything is as expected.",
        due_date: addDays(guaranteeUntil, -5),
        priority: "high",
        assignee_id: user.id,
        entity_type: "placement",
        entity_id: placement.id,
      },
    ]),
  ]);

  const failed = followUps.some((result) => result?.error);
  if (failed) {
    console.error(
      "createPlacement follow-ups",
      followUps.map((result) => result?.error).filter(Boolean),
    );
  }

  revalidateAll(placement.id);
  revalidatePath("/dashboard/vacancies");
  revalidatePath("/dashboard/candidates");
  redirect(`/dashboard/placements/${placement.id}${failed ? "?notice=partial" : ""}`);
}

export async function updatePlacement(
  placementId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Placement not found." };

  const parsed = placementSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  const input = parsed.data;
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("placements")
    .select("id, application_id, client_id, candidate_id, vacancy_id")
    .eq("id", placementId)
    .maybeSingle();
  if (!current) return { error: "Placement not found." };

  // Placements from the pipeline keep their client, candidate and vacancy.
  const locked = Boolean(current.application_id);
  const clientId = locked ? current.client_id : input.client_id;
  const vacancyId = locked ? current.vacancy_id : (input.vacancy_id ?? null);

  if (!locked && vacancyId) {
    const { data: vacancy } = await supabase
      .from("vacancies")
      .select("client_id")
      .eq("id", vacancyId)
      .maybeSingle();
    if (!vacancy || vacancy.client_id !== clientId) {
      return {
        error: "Check the highlighted fields.",
        fieldErrors: { vacancy_id: "This vacancy does not belong to the chosen client" },
      };
    }
  }

  const { error } = await supabase
    .from("placements")
    .update({
      client_id: clientId,
      candidate_id: locked ? current.candidate_id : input.candidate_id,
      vacancy_id: vacancyId,
      start_date: input.start_date,
      end_date: input.end_date ?? null,
      monthly_rate: input.monthly_rate ?? null,
      next_checkin_at: input.next_checkin_at ?? null,
      notes: input.notes ?? null,
    })
    .eq("id", placementId);

  if (error) {
    console.error("updatePlacement", error);
    return { error: GENERIC_ERROR };
  }

  revalidateAll(placementId);
  redirect(`/dashboard/placements/${placementId}`);
}

export type CheckinState = ActionState & { suggestedNext?: string };

const checkinSchema = z.object({
  checkin_date: date("Enter a date"),
  rating: z.coerce
    .number({ error: "Choose a score from 1 to 5" })
    .int()
    .min(1, { error: "Choose a score from 1 to 5" })
    .max(5, { error: "Choose a score from 1 to 5" })
    .optional(),
  notes: z.string().max(5000, { error: "At most 5000 characters" }).optional(),
});

export async function addCheckin(
  placementId: string,
  _prev: CheckinState,
  formData: FormData,
): Promise<CheckinState> {
  await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Placement not found." };

  const parsed = checkinSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  if (!parsed.data.rating && !parsed.data.notes) {
    return {
      error: "Give a score or write a short note.",
      fieldErrors: { notes: "Enter a score or a note" },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("placement_checkins").insert({
    placement_id: placementId,
    checkin_date: parsed.data.checkin_date,
    rating: parsed.data.rating ?? null,
    notes: parsed.data.notes ?? null,
  });

  if (error) {
    console.error("addCheckin", error);
    return { error: GENERIC_ERROR };
  }

  // The check-in happened, so open check-in tasks for this placement are done.
  await supabase
    .from("tasks")
    .update({ status: "done" })
    .eq("entity_type", "placement")
    .eq("entity_id", placementId)
    // Tasks created before the English UI carry the Dutch title.
    .in("title", [CHECKIN_TASK_TITLE, "Check-in met klant"])
    .neq("status", "done")
    .lte("due_date", addDays(parsed.data.checkin_date, 7));

  revalidateAll(placementId);
  return {
    ok: true,
    message: "Check-in saved.",
    suggestedNext: addMonths(parsed.data.checkin_date, 1),
  };
}

const nextCheckinSchema = z.object({
  next_checkin_at: date("Enter a date"),
  create_task: z.literal("on").optional(),
});

export async function setNextCheckin(
  placementId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Placement not found." };

  const parsed = nextCheckinSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the date.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("placements")
    .update({ next_checkin_at: parsed.data.next_checkin_at })
    .eq("id", placementId);

  if (error) {
    console.error("setNextCheckin", error);
    return { error: GENERIC_ERROR };
  }

  if (parsed.data.create_task) {
    await supabase.from("tasks").insert({
      title: CHECKIN_TASK_TITLE,
      due_date: parsed.data.next_checkin_at,
      assignee_id: user.id,
      entity_type: "placement",
      entity_id: placementId,
    });
  }

  revalidateAll(placementId);
  return { ok: true, message: "Next check-in scheduled." };
}

const noticeSchema = z
  .object({
    notice_given_at: date("Enter the date notice was given"),
    end_date: date("Enter the last working day"),
  })
  .refine((v) => v.end_date >= v.notice_given_at, {
    error: "The end date is before the notice date",
    path: ["end_date"],
  });

export async function givePlacementNotice(
  placementId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Placement not found." };

  const parsed = noticeSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("placements")
    .update({
      status: "notice",
      notice_given_at: parsed.data.notice_given_at,
      end_date: parsed.data.end_date,
    })
    .eq("id", placementId)
    .eq("status", "active")
    .select("id");

  if (error) {
    console.error("givePlacementNotice", error);
    return { error: GENERIC_ERROR };
  }
  if (!data?.length) return { error: "Only an active placement can be given notice." };

  revalidateAll(placementId);
  return { ok: true, message: "Notice given for the placement." };
}

const endSchema = z.object({ end_date: date("Enter the end date") });

export async function endPlacement(
  placementId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Placement not found." };

  const parsed = endSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the date.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("placements")
    .update({ status: "ended", end_date: parsed.data.end_date, next_checkin_at: null })
    .eq("id", placementId)
    .neq("status", "ended")
    .select("id");

  if (error) {
    console.error("endPlacement", error);
    return { error: GENERIC_ERROR };
  }
  if (!data?.length) return { error: "This placement has already ended." };

  revalidateAll(placementId);
  return { ok: true, message: "Placement ended." };
}

export async function deletePlacement(placementId: string): Promise<ActionState> {
  await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Placement not found." };

  const supabase = await createClient();
  const { error } = await supabase.from("placements").delete().eq("id", placementId);
  if (error) {
    console.error("deletePlacement", error);
    return { error: GENERIC_ERROR };
  }

  // Follow-up tasks only make sense with the placement.
  await supabase
    .from("tasks")
    .delete()
    .eq("entity_type", "placement")
    .eq("entity_id", placementId);

  revalidateAll();
  redirect("/dashboard/placements");
}
