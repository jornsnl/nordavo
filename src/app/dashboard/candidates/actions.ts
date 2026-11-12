"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SENIORITY_VALUES } from "@/lib/recruitment/candidate-fields";
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
import { parseInrAmount } from "@/lib/forms/compensation";
import { findDuplicateCandidates, type CandidateDuplicate } from "@/lib/screening/duplicates";
import { createClient } from "@/lib/supabase/server";

const statusValues = candidateStatuses.map((s) => s.value) as [CandidateStatus, ...CandidateStatus[]];

const httpUrl = (label: string) =>
  z
    .url({ protocol: /^https?$/, error: `Enter a valid ${label}, starting with https://` })
    .max(500, { error: "This link is too long." })
    .optional();

/** CTC in INR per year as people type it ("12 LPA", "12,00,000"). */
const ctcAmount = z
  .string()
  .max(50, { error: "Enter an amount, for example 12 LPA." })
  .transform((value, ctx) => {
    const amount = parseInrAmount(value);
    if (amount === null || amount > 1_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in rupees per year, for example 12 LPA or 1200000." });
      return z.NEVER;
    }
    return amount;
  })
  .optional();

const candidateSchema = z.object({
  full_name: z
    .string({ error: "Enter the name." })
    .min(2, { error: "Enter the name." })
    .max(200, { error: "This name is too long." }),
  email: z.email({ error: "Enter a valid email address." }).optional(),
  phone: z.string().max(50, { error: "This phone number is too long." }).optional(),
  location: z.string().max(120, { error: "This location is too long." }).optional(),
  current_title: z.string().max(200, { error: "This job title is too long." }).optional(),
  years_experience: z.coerce
    .number({ error: "Enter a whole number." })
    .int({ error: "Enter a whole number." })
    .min(0, { error: "Experience cannot be negative." })
    .max(60, { error: "That is a lot of experience." })
    .optional(),
  skills: z.string().max(2000, { error: "Too many skills." }).optional(),
  linkedin_url: httpUrl("LinkedIn link"),
  video_url: httpUrl("video link"),
  summary: z.string().max(5000, { error: "The summary is too long." }).optional(),
  status: z.enum(statusValues, { error: "Choose a status." }).default("available"),
  owner_id: z.string().refine(isUuid, { error: "Choose a team member." }).optional(),
  // Matching fields (T2 and the anonymous profile).
  seniority: z.enum(SENIORITY_VALUES, { error: "Choose a seniority." }).optional(),
  english_level: z.string().max(100, { error: "This English level is too long." }).optional(),
  availability: z.string().max(200, { error: "This availability is too long." }).optional(),
  profile_consent: z.enum(["yes", "no"], { error: "Choose yes, no or unknown." }).optional(),
  employers: z.string().max(2000, { error: "Too many employers." }).optional(),
  project_types: z.string().max(2000, { error: "Too many project types." }).optional(),
  sectors: z.string().max(2000, { error: "Too many sectors." }).optional(),
  cv_text: z.string().max(100000, { error: "The CV text is too long (at most 100,000 characters)." }).optional(),
  // A choice (immediate, 15 ... 90_plus); old free text stays when it was not changed.
  notice_period: z.string().max(200, { error: "This notice period is too long." }).optional(),
  current_ctc: ctcAmount,
  expected_ctc: ctcAmount,
});

/** A comma separated list without empty items and case-insensitive duplicates. */
function uniqueList(value: string | undefined) {
  const seen = new Set<string>();
  return parseList(value).filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  if (!extensionOk || !typeOk) return { error: "Upload a CV as PDF, DOC or DOCX." };
  if (value.size > MAX_UPLOAD_BYTES) {
    return { error: `The CV is too large. At most ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` };
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
  if (error.code === "23505") return "This candidate is already in the pipeline of this vacancy.";
  if (error.code === "23503") return "This vacancy or candidate no longer exists.";
  return GENERIC_ERROR;
}

/** Create or update a candidate, including the CV upload. */
export async function saveCandidate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();

  const id = formData.get("id");
  const candidateId = typeof id === "string" && id ? id : null;
  if (candidateId && !isUuid(candidateId)) return { error: "Candidate not found." };

  const values = formValues(formData);
  const parsed = candidateSchema.safeParse(values);
  const cv = cvFrom(formData);

  if (!parsed.success || cv.error) {
    return {
      error: "Check the highlighted fields.",
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
    seniority: input.seniority ?? null,
    english_level: input.english_level ?? null,
    availability: input.availability ?? null,
    profile_consent: input.profile_consent ? input.profile_consent === "yes" : null,
    employers: uniqueList(input.employers),
    project_types: uniqueList(input.project_types),
    sectors: uniqueList(input.sectors),
    cv_text: input.cv_text ?? null,
    notice_period: input.notice_period ?? null,
    current_ctc_inr_year: input.current_ctc ?? null,
    expected_ctc_inr_year: input.expected_ctc ?? null,
  };

  const supabase = await createClient();

  if (!candidateId) {
    // Duplicate check on name, email, phone and LinkedIn: warn once, the user confirms it is someone else.
    if (formData.get("confirm_duplicate") !== "on") {
      const duplicates = await findDuplicateCandidates(supabase, row);
      if (duplicates.length > 0) {
        return {
          error: `This candidate may already exist: ${duplicates.map((d) => `${d.full_name} (${d.on})`).join(", ")}. Open the existing candidate, or tick "This is someone else" and save again.`,
          fieldErrors: { confirm_duplicate: "Possible duplicate" },
          link: { href: `/dashboard/candidates/${duplicates[0].id}`, label: `Open ${duplicates[0].full_name}` },
        };
      }
    }
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

    revalidatePath("/dashboard/candidates");
    if (cvFailed) redirect(`/dashboard/candidates/${data.id}/edit?cv=failed`);
    if (linkedVacancy) {
      revalidatePath(`/dashboard/vacancies/${linkedVacancy}/pipeline`);
      redirect(`/dashboard/vacancies/${linkedVacancy}/pipeline`);
    }
    redirect(`/dashboard/candidates/${data.id}`);
  }

  const { data: existing, error: loadError } = await supabase
    .from("candidates")
    .select("cv_path")
    .eq("id", candidateId)
    .maybeSingle();
  if (loadError) return { error: GENERIC_ERROR };
  if (!existing) return { error: "Candidate not found." };

  let cvPath = existing.cv_path;
  let removeOld: string | null = null;

  if (cv.file) {
    const path = await uploadCv(supabase, candidateId, cv.file);
    if (!path) {
      return { error: "The CV upload failed. Please try again.", fieldErrors: { cv: "Upload failed." } };
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

  revalidatePath("/dashboard/candidates");
  revalidatePath(`/dashboard/candidates/${candidateId}`);
  redirect(`/dashboard/candidates/${candidateId}`);
}

export async function deleteCandidate(candidateId: string): Promise<ActionState> {
  await requireStaff();
  if (!isUuid(candidateId)) return { error: "Candidate not found." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("candidates")
    .select("cv_path")
    .eq("id", candidateId)
    .maybeSingle();

  const { error } = await supabase.from("candidates").delete().eq("id", candidateId);
  if (error) {
    if (error.code === "23503") {
      return { error: "This candidate has a placement and cannot be deleted." };
    }
    return { error: GENERIC_ERROR };
  }

  if (existing?.cv_path) await supabase.storage.from(ATTACHMENTS_BUCKET).remove([existing.cv_path]);

  revalidatePath("/dashboard/candidates");
  redirect("/dashboard/candidates");
}

const linkSchema = z.object({
  candidate_id: z.string({ error: "Choose a candidate." }).refine(isUuid, { error: "Choose a candidate." }),
  vacancy_id: z.string({ error: "Choose a vacancy." }).refine(isUuid, { error: "Choose a vacancy." }),
});

/** Add a candidate to the pipeline of a vacancy, in stage "sourced". */
export async function linkCandidateToVacancy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();

  const parsed = linkSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Choose a vacancy.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { candidate_id, vacancy_id } = parsed.data;
  const supabase = await createClient();
  const error = await insertApplication(supabase, vacancy_id, candidate_id);
  if (error) return { error };

  revalidatePath(`/dashboard/candidates/${candidate_id}`);
  revalidatePath(`/dashboard/vacancies/${vacancy_id}/pipeline`);
  revalidatePath("/dashboard/candidates");
  return { ok: true, message: "Candidate added to the pipeline." };
}

/** Possible duplicates of a new candidate, for the warning in the form (on blur of name or email). */
export async function checkCandidateDuplicates(input: {
  full_name?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
}): Promise<CandidateDuplicate[]> {
  await requireStaff();
  const clean = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const supabase = await createClient();
  try {
    return await findDuplicateCandidates(supabase, {
      full_name: clean(input.full_name, 200) ?? "",
      email: clean(input.email, 320),
      phone: clean(input.phone, 50),
      linkedin_url: clean(input.linkedin_url, 500),
    });
  } catch {
    return [];
  }
}
