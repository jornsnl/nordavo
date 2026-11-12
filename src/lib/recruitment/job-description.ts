import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, hasClaude } from "@/lib/ai/claude";
import { requestAi } from "@/lib/ai/queue";
import { vacancyInput } from "@/lib/ai/prompts/vacancy";
import {
  VACANCY_FILE_PDF_EXTRA,
  VACANCY_FILE_SYSTEM,
  vacancyFilePdfSchema,
  vacancyFileSchema,
  type VacancyFileReading,
} from "@/lib/ai/prompts/vacancy-file";
import { VACANCY_SYSTEM } from "@/lib/ai/prompts/vacancy";
import type { Database, TablesUpdate } from "@/lib/database.types";
import { cvFileKind, mimeFor, sniffMatches, type CvFileKind } from "@/lib/screening/cv-text";
import { extractDocxText } from "@/lib/screening/docx";
import { extractPdfText, looksLikeText } from "@/lib/screening/pdf-text";
import { ATTACHMENTS_BUCKET, MAX_UPLOAD_BYTES, buildStoragePath } from "@/lib/storage";
import { plainTextToMarkdown } from "./job-profile";

/**
 * A client's vacancy file (feedback round 3): stored with the vacancy
 * (attachments, kind job_description) and read into its fields. Text comes
 * from Word and simple PDFs in code, other PDFs are read by Claude. With
 * ANTHROPIC_API_KEY Claude fills the requirements and formats the job
 * profile right away; without it the text is stored, the job profile gets
 * light formatting and the reading is queued for claude-requests (the
 * requirements card shows it to check).
 */

type Db = SupabaseClient<Database>;

const MODEL = "claude-haiku-5-5";

export type JobFileResult = { ok: true; message: string; warning?: string } | { ok: false; error: string };

export function validateJobFile(fileName: string, mime: string | null, bytes: Uint8Array): { kind: CvFileKind } | { error: string } {
  const kind = cvFileKind(fileName, mime);
  if (!kind) return { error: "Upload the vacancy as PDF or Word (DOCX)." };
  if (bytes.length === 0) return { error: "The file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) return { error: `The file is too large. At most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
  if (!sniffMatches(kind, bytes)) return { error: "The file content does not match its extension." };
  return { kind };
}

function textFromFile(bytes: Buffer, kind: CvFileKind): string | null {
  try {
    if (kind === "docx") return extractDocxText(bytes).trim() || null;
    if (kind === "pdf") {
      const text = extractPdfText(bytes);
      return looksLikeText(text) ? text.trim() : null;
    }
  } catch {
    return null;
  }
  return null;
}

function lines(items: string[]) {
  return items.map((i) => i.trim()).filter(Boolean).slice(0, 12);
}

/** Store the file and read it into the vacancy. Fills only what is still empty, unless `overwrite`. */
export async function processJobFile(
  db: Db,
  vacancyId: string,
  file: { bytes: Buffer; fileName: string; mime: string | null },
  kind: CvFileKind,
): Promise<JobFileResult> {
  const { data: vacancy, error: loadError } = await db
    .from("vacancies")
    .select("id, title, description, raw_text, stack, must_haves, nice_to_haves, unclear, hours, timezone_overlap, budget_min, budget_max, client_contact_required, intake_at")
    .eq("id", vacancyId)
    .maybeSingle();
  if (loadError || !vacancy) return { ok: false, error: "This vacancy no longer exists." };

  const path = buildStoragePath("vacancy", vacancyId, file.fileName);
  const { error: uploadError } = await db.storage.from(ATTACHMENTS_BUCKET).upload(path, file.bytes, { contentType: mimeFor(kind), upsert: false });
  if (uploadError) return { ok: false, error: "The file could not be stored. Try again." };
  const { error: rowError } = await db.from("attachments").insert({
    entity_type: "vacancy",
    entity_id: vacancyId,
    storage_path: path,
    file_name: file.fileName.slice(0, 200),
    mime_type: mimeFor(kind),
    size_bytes: file.bytes.length,
    kind: "job_description",
  });
  if (rowError) {
    await db.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return { ok: false, error: "The file could not be saved. Try again." };
  }

  if (kind === "doc") {
    return { ok: true, message: "File stored with the vacancy.", warning: "Old Word files (.doc) cannot be read. Save it as DOCX or PDF to fill the fields automatically." };
  }

  const text = textFromFile(file.bytes, kind);
  let reading: VacancyFileReading | null = null;
  let sourceText = text;
  let claudeNote: string | undefined;

  if (hasClaude()) {
    try {
      if (text) {
        reading = await askJson({
          system: VACANCY_FILE_SYSTEM,
          input: vacancyInput({ title: vacancy.title, text }),
          schema: vacancyFileSchema,
          effort: "low",
          model: MODEL,
          maxTokens: 8000,
        });
      } else if (kind === "pdf") {
        const pdf = await askJson({
          system: `${VACANCY_FILE_SYSTEM}\n\n${VACANCY_FILE_PDF_EXTRA}`,
          input: [
            { type: "pdf", base64: file.bytes.toString("base64") },
            { type: "text", text: `Functietitel in ons systeem: ${vacancy.title}. Lees deze vacature.` },
          ],
          schema: vacancyFilePdfSchema,
          effort: "low",
          model: MODEL,
          maxTokens: 12000,
        });
        reading = pdf;
        sourceText = pdf.source_text.trim() || null;
      }
    } catch {
      claudeNote = "Claude could not read the file; the text is stored and the job profile is formatted simply.";
    }
  }

  const update: TablesUpdate<"vacancies"> = {};
  if (sourceText) update.raw_text = sourceText.slice(0, 30000);
  if (!vacancy.description?.trim()) {
    const profile = reading?.job_profile.trim() || (sourceText ? plainTextToMarkdown(sourceText) : "");
    if (profile) update.description = profile.slice(0, 20000);
  }
  const hasRequirements = vacancy.stack.length > 0 || vacancy.must_haves.length > 0;
  if (reading && !hasRequirements) {
    Object.assign(update, {
      stack: lines(reading.stack),
      must_haves: lines(reading.must_haves),
      nice_to_haves: lines(reading.nice_to_haves),
      unclear: lines(reading.unclear),
      hours: vacancy.hours ?? (Number.isFinite(reading.hours) && reading.hours >= 1 && reading.hours <= 60 ? Math.round(reading.hours) : null),
      timezone_overlap: vacancy.timezone_overlap ?? (reading.timezone_overlap.slice(0, 300) || null),
      budget_min: vacancy.budget_min ?? reading.budget_min,
      budget_max: vacancy.budget_max ?? reading.budget_max,
      client_contact_required: vacancy.client_contact_required ?? reading.client_contact_required,
      intake_at: vacancy.intake_at ?? new Date().toISOString(),
    } satisfies TablesUpdate<"vacancies">);
  }
  if (Object.keys(update).length > 0) {
    const { error } = await db.from("vacancies").update(update).eq("id", vacancyId);
    if (error) return { ok: false, error: "The file is stored, but the fields could not be filled." };
  }

  if (!hasClaude()) {
    if (sourceText) {
      // Claude reads the requirements through the MCP; the requirements card shows the reading to check.
      await requestAi(db, {
        kind: "vacancy_extract",
        module: "recruitment",
        entityType: "vacancy",
        entityId: vacancyId,
        system: VACANCY_SYSTEM,
        input: vacancyInput({ title: vacancy.title, text: sourceText }),
      });
      return {
        ok: true,
        message: update.description ? "File stored and read into the job profile." : "File stored and read.",
        warning: "No Claude key: the requirements are read in the next run of claude-requests. Check them on the requirements card.",
      };
    }
    return { ok: true, message: "File stored with the vacancy.", warning: "This PDF needs Claude to be read. Paste the text on the requirements card, or add the Claude key." };
  }
  if (!reading) {
    return { ok: true, message: "File stored with the vacancy.", warning: claudeNote ?? "No text found in this file." };
  }
  const filled = [update.description ? "job profile" : null, update.stack ? "requirements" : null].filter(Boolean);
  return {
    ok: true,
    message: filled.length > 0 ? `File stored. Filled in: ${filled.join(" and ")}.` : "File stored. The fields were already filled, nothing was overwritten.",
    warning: hasRequirements ? "The requirements were already filled in, so they were kept. Paste the text on the requirements card to read them again." : undefined,
  };
}
