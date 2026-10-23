"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  type ActionState,
  GENERIC_ERROR,
  fieldErrorsFrom,
  formValues,
  parseList,
} from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { isUuid } from "@/lib/data/candidates";
import type { CandidateStatus } from "@/lib/database.types";
import { candidateStatuses } from "@/lib/labels";
import { ATTACHMENTS_BUCKET, MAX_UPLOAD_BYTES, buildStoragePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

const statusValues = candidateStatuses.map((s) => s.value) as [CandidateStatus, ...CandidateStatus[]];

const httpUrl = (label: string) =>
  z
    .url({ protocol: /^https?$/, error: `Vul een geldige ${label} in, beginnend met https://` })
    .max(500, { error: "Deze link is te lang." })
    .optional();

const candidateSchema = z.object({
  full_name: z
    .string({ error: "Vul de naam in." })
    .min(2, { error: "Vul de naam in." })
    .max(200, { error: "Deze naam is te lang." }),
  email: z.email({ error: "Vul een geldig e-mailadres in." }).optional(),
  phone: z.string().max(50, { error: "Dit telefoonnummer is te lang." }).optional(),
  location: z.string().max(120, { error: "Deze locatie is te lang." }).optional(),
  current_title: z.string().max(200, { error: "Deze functietitel is te lang." }).optional(),
  years_experience: z.coerce
    .number({ error: "Vul een heel getal in." })
    .int({ error: "Vul een heel getal in." })
    .min(0, { error: "Ervaring kan niet negatief zijn." })
    .max(60, { error: "Dat is wel erg veel ervaring." })
    .optional(),
  skills: z.string().max(2000, { error: "Te veel skills." }).optional(),
  linkedin_url: httpUrl("LinkedIn link"),
  video_url: httpUrl("video link"),
  summary: z.string().max(5000, { error: "De samenvatting is te lang." }).optional(),
  status: z.enum(statusValues, { error: "Kies een status." }).default("available"),
  owner_id: z.string().refine(isUuid, { error: "Kies een teamlid." }).optional(),
});

const CV_EXTENSIONS = [".pdf", ".doc", ".docx"];
const CV_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function cvFrom(formData: FormData): { file?: File; error?: string } {
  const value = formData.get("cv");
  if (!(value instanceof File) || value.size === 0) return {};
  const name = value.name.toLowerCase();
  const extensionOk = CV_EXTENSIONS.some((ext) => name.endsWith(ext));
  const typeOk = !value.type || CV_MIME_TYPES.includes(value.type);
  if (!extensionOk || !typeOk) return { error: "Upload een cv als PDF, DOC of DOCX." };
  if (value.size > MAX_UPLOAD_BYTES) {
    return { error: `Het cv is te groot. Maximaal ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` };
  }
  return { file: value };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function uploadCv(supabase: Supabase, candidateId: string, file: File) {
  const path = buildStoragePath("candidate", candidateId, file.name);
  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  return error ? null : path;
}

/** Next position at the bottom of the "sourced" column of a vacancy. */
async function nextSourcedPosition(supabase: Supabase, vacancyId: string) {
  const { data } = await supabase
    .from("applications")
    .select("position")
    .eq("vacancy_id", vacancyId)
    .eq("stage", "sourced")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.position ?? 0) + 1024;
}

async function insertApplication(supabase: Supabase, vacancyId: string, candidateId: string) {
  const position = await nextSourcedPosition(supabase, vacancyId);
  const { error } = await supabase
    .from("applications")
    .insert({ vacancy_id: vacancyId, candidate_id: candidateId, stage: "sourced", position });
  if (!error) return null;
  if (error.code === "23505") return "Deze kandidaat staat al in de pipeline van deze vacature.";
  if (error.code === "23503") return "Deze vacature of kandidaat bestaat niet meer.";
  return GENERIC_ERROR;
}

/** Create or update a candidate, including the CV upload. */
export async function saveCandidate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();

  const id = formData.get("id");
  const candidateId = typeof id === "string" && id ? id : null;
  if (candidateId && !isUuid(candidateId)) return { error: "Kandidaat niet gevonden." };

  const values = formValues(formData);
  const parsed = candidateSchema.safeParse(values);
  const cv = cvFrom(formData);

  if (!parsed.success || cv.error) {
    return {
      error: "Controleer de gemarkeerde velden.",
      fieldErrors: {
        ...(parsed.success ? {} : fieldErrorsFrom(parsed.error)),
        ...(cv.error ? { cv: cv.error } : {}),
      },
    };
  }

  const input = parsed.data;
  const row = {
    full_name: input.full_name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    location: input.location ?? "Bangalore",
    current_title: input.current_title ?? null,
    years_experience: input.years_experience ?? null,
    skills: [...new Set(parseList(input.skills))],
    linkedin_url: input.linkedin_url ?? null,
    video_url: input.video_url ?? null,
    summary: input.summary ?? null,
    status: input.status,
    owner_id: input.owner_id ?? null,
  };

  const supabase = await createClient();

  if (!candidateId) {
    // Insert first: the storage path needs the new id.
    const { data, error } = await supabase.from("candidates").insert(row).select("id").single();
    if (error || !data) return { error: GENERIC_ERROR };

    let cvFailed = false;
    if (cv.file) {
      const path = await uploadCv(supabase, data.id, cv.file);
      if (path) {
        const { error: pathError } = await supabase
          .from("candidates")
          .update({ cv_path: path })
          .eq("id", data.id);
        if (pathError) {
          await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
          cvFailed = true;
        }
      } else {
        cvFailed = true;
      }
    }

    const vacancyId = values.vacancy_id;
    let linkedVacancy: string | null = null;
    if (isUuid(vacancyId)) {
      const linkError = await insertApplication(supabase, vacancyId, data.id);
      if (!linkError) linkedVacancy = vacancyId;
    }

    revalidatePath("/dashboard/kandidaten");
    if (cvFailed) redirect(`/dashboard/kandidaten/${data.id}/bewerken?cv=mislukt`);
    if (linkedVacancy) {
      revalidatePath(`/dashboard/vacatures/${linkedVacancy}/pipeline`);
      redirect(`/dashboard/vacatures/${linkedVacancy}/pipeline`);
    }
    redirect(`/dashboard/kandidaten/${data.id}`);
  }

  const { data: existing, error: loadError } = await supabase
    .from("candidates")
    .select("cv_path")
    .eq("id", candidateId)
    .maybeSingle();
  if (loadError) return { error: GENERIC_ERROR };
  if (!existing) return { error: "Kandidaat niet gevonden." };

  let cvPath = existing.cv_path;
  let removeOld: string | null = null;

  if (cv.file) {
    const path = await uploadCv(supabase, candidateId, cv.file);
    if (!path) {
      return { error: "Het cv uploaden is mislukt. Probeer het opnieuw.", fieldErrors: { cv: "Upload mislukt." } };
    }
    removeOld = existing.cv_path;
    cvPath = path;
  } else if (formData.get("remove_cv") === "on" && existing.cv_path) {
    removeOld = existing.cv_path;
    cvPath = null;
  }

  const { error } = await supabase
    .from("candidates")
    .update({ ...row, cv_path: cvPath })
    .eq("id", candidateId);

  if (error) {
    // Do not leave an orphaned upload behind.
    if (cv.file && cvPath) await supabase.storage.from(ATTACHMENTS_BUCKET).remove([cvPath]);
    return { error: GENERIC_ERROR };
  }

  if (removeOld) await supabase.storage.from(ATTACHMENTS_BUCKET).remove([removeOld]);

  revalidatePath("/dashboard/kandidaten");
  revalidatePath(`/dashboard/kandidaten/${candidateId}`);
  redirect(`/dashboard/kandidaten/${candidateId}`);
}

export async function deleteCandidate(candidateId: string): Promise<ActionState> {
  await requireStaff();
  if (!isUuid(candidateId)) return { error: "Kandidaat niet gevonden." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("candidates")
    .select("cv_path")
    .eq("id", candidateId)
    .maybeSingle();

  const { error } = await supabase.from("candidates").delete().eq("id", candidateId);
  if (error) {
    if (error.code === "23503") {
      return { error: "Deze kandidaat heeft een plaatsing en kan niet worden verwijderd." };
    }
    return { error: GENERIC_ERROR };
  }

  if (existing?.cv_path) await supabase.storage.from(ATTACHMENTS_BUCKET).remove([existing.cv_path]);

  revalidatePath("/dashboard/kandidaten");
  redirect("/dashboard/kandidaten");
}

const linkSchema = z.object({
  candidate_id: z.string({ error: "Kies een kandidaat." }).refine(isUuid, { error: "Kies een kandidaat." }),
  vacancy_id: z.string({ error: "Kies een vacature." }).refine(isUuid, { error: "Kies een vacature." }),
});

/** Add a candidate to the pipeline of a vacancy, in stage "sourced". */
export async function linkCandidateToVacancy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();

  const parsed = linkSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Kies een vacature.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { candidate_id, vacancy_id } = parsed.data;
  const supabase = await createClient();
  const error = await insertApplication(supabase, vacancy_id, candidate_id);
  if (error) return { error };

  revalidatePath(`/dashboard/kandidaten/${candidate_id}`);
  revalidatePath(`/dashboard/vacatures/${vacancy_id}/pipeline`);
  revalidatePath("/dashboard/kandidaten");
  return { ok: true, message: "Kandidaat toegevoegd aan de pipeline." };
}
