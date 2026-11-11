"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import type { ApplyState } from "@/components/forms/form-renderer";
import { HONEYPOT_FIELD, mapAnswers, parseSubmission } from "@/lib/forms/answers";
import { resolvePublicForm, TOKEN_RE } from "@/lib/forms/public";
import { ATTACHMENTS_BUCKET, buildStoragePath } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { readFormCv } from "@/lib/screening/cv-read";

/**
 * Public submission of an application form. No session: everything runs
 * with the service role after strict validation, and only the narrow
 * database functions submit_recruitment_form and attach_form_cv write.
 */

const MIN_FILL_MS = 3000;

const ERRORS: Record<string, string> = {
  rate_limited: "We received several applications from your connection in a short time. Please try again in ten minutes.",
  form_closed: "This form no longer accepts applications.",
  form_changed: "This form was just updated. Reload the page and submit again.",
  form_not_found: "This link is not valid.",
};

async function ipHash() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
  const salt = process.env.SUPABASE_SECRET_KEY ?? "nordavo-forms";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 48);
}

function typedValues(formData: FormData): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string" || !key.startsWith("f_")) continue;
    const existing = values[key];
    if (existing === undefined) values[key] = value.slice(0, 5000);
    else values[key] = [...(Array.isArray(existing) ? existing : [existing]), value.slice(0, 300)];
  }
  return values;
}

export async function submitApplication(token: string, prev: ApplyState, formData: FormData): Promise<ApplyState> {
  const attempt = (prev.attempt ?? 0) + 1;
  if (!TOKEN_RE.test(token)) return { error: ERRORS.form_not_found, attempt };

  // Honeypot and a minimum fill time: answer as if it worked, store nothing.
  const startedAt = Number(formData.get("started_at"));
  const honeypot = formData.get(HONEYPOT_FIELD);
  if ((typeof honeypot === "string" && honeypot.trim() !== "") || (Number.isFinite(startedAt) && Date.now() - startedAt < MIN_FILL_MS)) {
    return { ok: true, attempt };
  }

  const resolved = await resolvePublicForm(token);
  if (resolved.state === "unavailable") return { error: "Applying is not possible right now. Please try again later.", attempt };
  if (resolved.state === "not_found") return { error: ERRORS.form_not_found, attempt };
  if (resolved.state === "closed") return { error: ERRORS.form_closed, attempt };
  const form = resolved.form;

  const values = typedValues(formData);
  const parsed = parseSubmission(form.blocks, formData);
  if (!parsed.ok) return { errors: parsed.errors, values, attempt };

  const mapped = mapAnswers(form.blocks, parsed.answers);
  const db = createAdminClient();
  if (!db) return { error: "Applying is not possible right now. Please try again later.", values, attempt };

  const { data, error } = await db.rpc("submit_recruitment_form", {
    p_token: token,
    p_payload: {
      form_version: form.version,
      answers: parsed.answers,
      candidate: mapped.candidate,
      compensation: mapped.compensation,
      source: mapped.source,
      ip_hash: await ipHash(),
    },
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    const code = error?.message ?? "";
    console.error(`[apply] submission failed: ${code}`);
    return { error: ERRORS[code] ?? "Something went wrong. Please try again.", values, attempt };
  }
  const result = data as { candidate_id: string; response_id: string };

  for (const { question, file } of parsed.files) {
    const path = buildStoragePath("candidate", result.candidate_id, file.name);
    const upload = await db.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (upload.error) {
      console.error(`[apply] cv upload failed: ${upload.error.message}`);
      return {
        error: "Your answers are saved, but the file upload failed. Please select your CV again and submit once more.",
        values,
        errors: { [question.id]: "Upload failed, please try again." },
        attempt,
      };
    }
    const attached = await db.rpc("attach_form_cv", {
      p_response_id: result.response_id,
      p_question_id: question.id,
      p_path: path,
      p_file_name: file.name,
      p_mime_type: file.type || "application/octet-stream",
      p_size: file.size,
    });
    if (attached.error) {
      await db.storage.from(ATTACHMENTS_BUCKET).remove([path]);
      console.error(`[apply] cv not recorded: ${attached.error.message}`);
      return { error: "Your answers are saved, but the file could not be stored. Please submit once more.", values, attempt };
    }
  }

  // Read the CV into text right away (feedback Julius: the CVs of LinkedIn and
  // Naukri candidates only come in through this form), after the answer is
  // sent so the candidate does not wait. The job cv-read catches up on what fails.
  if (parsed.files.length > 0) {
    after(async () => {
      try {
        await readFormCv(db, result.candidate_id);
      } catch (cause) {
        console.error(`[apply] cv not read: ${cause instanceof Error ? cause.message : cause}`);
      }
    });
  }

  return { ok: true, attempt };
}
