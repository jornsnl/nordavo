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

const id = z.uuid();

const date = (message: string) => z.iso.date({ error: message });

const money = z
  .string()
  .regex(/^\d{1,8}([.,]\d{1,2})?$/, { error: "Vul een bedrag in, bijvoorbeeld 4500" })
  .transform((value) => Number(value.replace(",", ".")))
  .optional();

const placementSchema = z
  .object({
    client_id: z.uuid({ error: "Kies een klant" }),
    candidate_id: z.uuid({ error: "Kies een kandidaat" }),
    vacancy_id: z.uuid({ error: "Kies een geldige vacature" }).optional(),
    application_id: z.uuid().optional(),
    start_date: date("Vul een startdatum in"),
    monthly_rate: money,
    next_checkin_at: date("Vul een geldige datum in").optional(),
    end_date: date("Vul een geldige datum in").optional(),
    notes: z.string().max(5000, { error: "Maximaal 5000 tekens" }).optional(),
  })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, {
    error: "De einddatum ligt voor de startdatum",
    path: ["end_date"],
  });

const revalidateAll = (placementId?: string) => {
  revalidatePath("/dashboard/plaatsingen");
  revalidatePath("/dashboard");
  if (placementId) revalidatePath(`/dashboard/plaatsingen/${placementId}`);
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
    return { error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrorsFrom(parsed.error) };
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
      return { error: "Deze sollicitatie bestaat niet meer. Kies klant en kandidaat zelf." };
    }
    const { data: existing } = await supabase
      .from("placements")
      .select("id")
      .eq("application_id", applicationId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return { error: "Voor deze sollicitatie bestaat al een plaatsing." };
    }
    candidateId = application.candidate_id;
    vacancyId = application.vacancy.id;
    clientId = application.vacancy.client_id;
  } else if (vacancyId) {
    const { data: vacancy } = await supabase
      .from("vacancies")
      .select("client_id")
      .eq("id", vacancyId)
      .maybeSingle();
    if (!vacancy || vacancy.client_id !== clientId) {
      return {
        error: "Controleer de gemarkeerde velden.",
        fieldErrors: { vacancy_id: "Deze vacature hoort niet bij de gekozen klant" },
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
        title: "Check-in met klant",
        description: "Hoe gaat het met de developer? Vraag door op samenwerking, tempo en communicatie.",
        due_date: nextCheckin,
        assignee_id: user.id,
        entity_type: "placement",
        entity_id: placement.id,
      },
      {
        title: "Evaluatie einde garantieperiode",
        description:
          "De garantieperiode van 30 dagen loopt af. Bespreek met de klant of alles naar wens is.",
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
  revalidatePath("/dashboard/vacatures");
  revalidatePath("/dashboard/kandidaten");
  redirect(`/dashboard/plaatsingen/${placement.id}${failed ? "?melding=deels" : ""}`);
}

export async function updatePlacement(
  placementId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Plaatsing niet gevonden." };

  const parsed = placementSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  const input = parsed.data;
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("placements")
    .select("id, application_id, client_id, candidate_id, vacancy_id")
    .eq("id", placementId)
    .maybeSingle();
  if (!current) return { error: "Plaatsing niet gevonden." };

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
        error: "Controleer de gemarkeerde velden.",
        fieldErrors: { vacancy_id: "Deze vacature hoort niet bij de gekozen klant" },
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
  redirect(`/dashboard/plaatsingen/${placementId}`);
}

export type CheckinState = ActionState & { suggestedNext?: string };

const checkinSchema = z.object({
  checkin_date: date("Vul een datum in"),
  rating: z.coerce
    .number({ error: "Kies een score van 1 tot 5" })
    .int()
    .min(1, { error: "Kies een score van 1 tot 5" })
    .max(5, { error: "Kies een score van 1 tot 5" })
    .optional(),
  notes: z.string().max(5000, { error: "Maximaal 5000 tekens" }).optional(),
});

export async function addCheckin(
  placementId: string,
  _prev: CheckinState,
  formData: FormData,
): Promise<CheckinState> {
  await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Plaatsing niet gevonden." };

  const parsed = checkinSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  if (!parsed.data.rating && !parsed.data.notes) {
    return {
      error: "Geef een score of schrijf een korte notitie.",
      fieldErrors: { notes: "Vul een score of notitie in" },
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
    .eq("title", "Check-in met klant")
    .neq("status", "done")
    .lte("due_date", addDays(parsed.data.checkin_date, 7));

  revalidateAll(placementId);
  return {
    ok: true,
    message: "Check-in opgeslagen.",
    suggestedNext: addMonths(parsed.data.checkin_date, 1),
  };
}

const nextCheckinSchema = z.object({
  next_checkin_at: date("Vul een datum in"),
  create_task: z.literal("on").optional(),
});

export async function setNextCheckin(
  placementId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Plaatsing niet gevonden." };

  const parsed = nextCheckinSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de datum.", fieldErrors: fieldErrorsFrom(parsed.error) };
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
      title: "Check-in met klant",
      due_date: parsed.data.next_checkin_at,
      assignee_id: user.id,
      entity_type: "placement",
      entity_id: placementId,
    });
  }

  revalidateAll(placementId);
  return { ok: true, message: "Volgende check-in gepland." };
}

const noticeSchema = z
  .object({
    notice_given_at: date("Vul de datum van opzegging in"),
    end_date: date("Vul de laatste werkdag in"),
  })
  .refine((v) => v.end_date >= v.notice_given_at, {
    error: "De einddatum ligt voor de opzegdatum",
    path: ["end_date"],
  });

export async function givePlacementNotice(
  placementId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Plaatsing niet gevonden." };

  const parsed = noticeSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrorsFrom(parsed.error) };
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
  if (!data?.length) return { error: "Alleen een actieve plaatsing kun je opzeggen." };

  revalidateAll(placementId);
  return { ok: true, message: "Plaatsing opgezegd." };
}

const endSchema = z.object({ end_date: date("Vul de einddatum in") });

export async function endPlacement(
  placementId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Plaatsing niet gevonden." };

  const parsed = endSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de datum.", fieldErrors: fieldErrorsFrom(parsed.error) };
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
  if (!data?.length) return { error: "Deze plaatsing is al beëindigd." };

  revalidateAll(placementId);
  return { ok: true, message: "Plaatsing beëindigd." };
}

export async function deletePlacement(placementId: string): Promise<ActionState> {
  await requireStaff();
  if (!id.safeParse(placementId).success) return { error: "Plaatsing niet gevonden." };

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
  redirect("/dashboard/plaatsingen");
}
