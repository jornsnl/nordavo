import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJsonWithUsage, hasClaude } from "@/lib/ai/claude";
import { CV_PDF_EXTRA, CV_READ_SYSTEM, cvFieldsSchema, cvPdfSchema, type CvFields } from "@/lib/ai/prompts/screening";
import type { CandidateOrigin, CandidateSource, CvTextStatus, Database, TablesUpdate } from "@/lib/database.types";
import { cleanEmail, cleanLinkedin, cleanPhone, fillEmpty, splitSkills } from "@/lib/screening/candidate-csv";
import {
  cvFileKind,
  heuristicFields,
  mimeFor,
  nameFromFileName,
  sniffMatches,
  storableCvText,
  type CvFileKind,
} from "@/lib/screening/cv-text";
import { extractDocxText } from "@/lib/screening/docx";
import { addToPipeline, findCandidateByContact } from "@/lib/screening/import";
import { extractPdfText, looksLikeText } from "@/lib/screening/pdf-text";
import { ATTACHMENTS_BUCKET, buildStoragePath } from "@/lib/storage";
import { requestAi } from "@/lib/ai/queue";

/**
 * Reading CVs (2.6.2, 2.11): text from DOCX in code, from PDF in code when
 * the PDF has simple fonts, otherwise Claude reads the PDF as a document.
 * Without ANTHROPIC_API_KEY a DOCX still works and a PDF is stored with its
 * text marked pending (the scoring job reads it later). Fields (name,
 * contact details, skills) come from Claude, or from the text by pattern.
 */

type Db = SupabaseClient<Database>;

/** Extraction is simple work: the cheapest model at low effort. */
export const CV_READ_MODEL = "claude-haiku-5-5";

export type CvReadResult = {
  text: string | null;
  status: CvTextStatus;
  /** Why the text is pending or failed, for the UI. */
  note: string | null;
  fields: CvFields | null;
};

export function toFields(raw: CvFields): CvFields {
  return {
    full_name: raw.full_name?.trim().slice(0, 200) || null,
    email: cleanEmail(raw.email),
    phone: cleanPhone(raw.phone),
    linkedin_url: cleanLinkedin(raw.linkedin_url),
    location: raw.location?.trim().slice(0, 120) || null,
    current_title: raw.current_title?.trim().slice(0, 200) || null,
    years_experience:
      raw.years_experience !== null && Number.isFinite(raw.years_experience) && raw.years_experience >= 0 && raw.years_experience <= 60
        ? Math.floor(raw.years_experience)
        : null,
    skills: splitSkills(raw.skills.join(",")).slice(0, 30),
    employers: raw.employers.map((e) => e.trim().slice(0, 200)).filter(Boolean).slice(0, 10),
    summary: raw.summary?.trim().slice(0, 5000) || null,
  };
}

/** Text and fields of one CV file. Never throws for a bad file: the status says what happened. */
export async function readCvFile(bytes: Buffer, fileName: string, kind: CvFileKind): Promise<CvReadResult> {
  if (kind === "doc") {
    return { text: null, status: "failed", note: "Old Word format (.doc) cannot be read. Save it as PDF or DOCX.", fields: null };
  }
  let text: string | null = null;
  if (kind === "docx") {
    try {
      text = storableCvText(extractDocxText(bytes));
    } catch {
      return { text: null, status: "failed", note: "This Word file could not be read.", fields: null };
    }
  } else {
    try {
      const light = extractPdfText(bytes);
      if (looksLikeText(light)) text = storableCvText(light);
    } catch {
      // Fall through to Claude.
    }
  }

  if (text) {
    if (!hasClaude()) return { text, status: "read", note: null, fields: null };
    try {
      const { data } = await askJsonWithUsage({
        system: CV_READ_SYSTEM,
        input: `File: ${fileName}\n\n${text.slice(0, 60000)}`,
        schema: cvFieldsSchema,
        effort: "low",
        model: CV_READ_MODEL,
        maxTokens: 4000,
      });
      return { text, status: "read", note: null, fields: toFields(data) };
    } catch {
      return { text, status: "read", note: "Text read; Claude could not extract the fields.", fields: null };
    }
  }

  if (kind === "pdf" && hasClaude()) {
    try {
      const { data } = await askJsonWithUsage({
        system: `${CV_READ_SYSTEM}\n\n${CV_PDF_EXTRA}`,
        input: [
          { type: "pdf", base64: bytes.toString("base64") },
          { type: "text", text: `File: ${fileName}. Read this CV.` },
        ],
        schema: cvPdfSchema,
        effort: "low",
        model: CV_READ_MODEL,
        maxTokens: 16000,
      });
      const cvText = storableCvText(data.cv_text);
      return { text: cvText, status: cvText ? "read" : "failed", note: cvText ? null : "Claude found no text in this PDF.", fields: toFields(data) };
    } catch (error) {
      return { text: null, status: "pending", note: `Claude could not read the PDF (${error instanceof Error ? error.message : "unknown error"}). Try Read CV again later.`, fields: null };
    }
  }
  return { text: null, status: "pending", note: "PDF stored, text pending: Claude reads it through the MCP in its next run.", fields: null };
}

export type CvUploadInput = {
  bytes: Buffer;
  fileName: string;
  mime: string | null;
  vacancyId: string | null;
  source: CandidateSource;
  origin: CandidateOrigin;
};

export type CvUploadResult = {
  fileName: string;
  outcome: "created" | "matched";
  candidateId: string;
  candidateName: string;
  textStatus: CvTextStatus;
  note: string | null;
  /** Already in the vacancy's pipeline (nothing added). */
  alreadyInVacancy: boolean;
};

/** Validates the file. Returns an error message or the kind. */
export function validateCvFile(fileName: string, mime: string | null, bytes: Uint8Array, maxBytes: number): { kind: CvFileKind } | { error: string } {
  const kind = cvFileKind(fileName, mime);
  if (!kind) return { error: "Not a CV file. Use PDF or DOCX." };
  if (bytes.length === 0) return { error: "The file is empty." };
  if (bytes.length > maxBytes) return { error: `The file is too large. At most ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  if (!sniffMatches(kind, bytes)) return { error: "The file content does not match its extension." };
  return { kind };
}

async function storeCvFile(db: Db, candidateId: string, bytes: Buffer, fileName: string, kind: CvFileKind) {
  const path = buildStoragePath("candidate", candidateId, fileName);
  const { error } = await db.storage.from(ATTACHMENTS_BUCKET).upload(path, bytes, { contentType: mimeFor(kind), upsert: false });
  if (error) throw new Error(`Could not store the CV: ${error.message}`);
  const { error: rowError } = await db.from("attachments").insert({
    entity_type: "candidate",
    entity_id: candidateId,
    storage_path: path,
    file_name: fileName.slice(0, 200),
    mime_type: mimeFor(kind),
    size_bytes: bytes.length,
    kind: "cv",
  });
  if (rowError) {
    await db.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    throw new Error(`Could not save the CV: ${rowError.message}`);
  }
  return path;
}

function cvColumns(read: CvReadResult, path: string): TablesUpdate<"candidates"> {
  return {
    cv_path: path,
    cv_text_status: read.status,
    cv_read_at: read.status === "read" ? new Date().toISOString() : null,
    ...(read.text ? { cv_text: read.text } : {}),
  };
}

/**
 * One CV of a bulk upload: read it, match it to an existing candidate by
 * email, phone or LinkedIn in the CV, or create a new candidate; store the
 * file as the candidate's CV and, with a vacancy, add them in stage sourced.
 */
export async function processCvUpload(db: Db, input: CvUploadInput, kind: CvFileKind): Promise<CvUploadResult> {
  const read = await readCvFile(input.bytes, input.fileName, kind);
  const found = read.text ? heuristicFields(read.text, input.fileName) : { full_name: nameFromFileName(input.fileName), email: null, phone: null, linkedin_url: null };
  const contact = {
    email: read.fields?.email ?? found.email,
    phone: read.fields?.phone ?? found.phone,
    linkedin_url: read.fields?.linkedin_url ?? found.linkedin_url,
  };

  const existing = contact.email || contact.phone || contact.linkedin_url ? await findCandidateByContact(db, contact) : null;
  let candidateId: string;
  let candidateName: string;
  if (existing) {
    candidateId = existing.id;
    const { data: row } = await db.from("candidates").select("full_name").eq("id", existing.id).maybeSingle();
    candidateName = row?.full_name ?? "Candidate";
  } else {
    const name = read.fields?.full_name ?? found.full_name ?? (input.fileName.replace(/\.[a-z]+$/i, "").slice(0, 200) || "Unknown name");
    const f = read.fields;
    const { data, error } = await db
      .from("candidates")
      .insert({
        full_name: name,
        email: contact.email,
        phone: contact.phone,
        linkedin_url: contact.linkedin_url,
        location: f?.location ?? "Bangalore",
        current_title: f?.current_title ?? null,
        years_experience: f?.years_experience ?? null,
        skills: f?.skills ?? [],
        employers: f?.employers ?? [],
        summary: f?.summary ?? null,
        source: input.source,
        origin: input.origin,
      })
      .select("id, full_name")
      .single();
    if (error || !data) throw new Error(`Could not create the candidate: ${error?.message ?? "unknown error"}`);
    candidateId = data.id;
    candidateName = data.full_name;
  }

  const path = await storeCvFile(db, candidateId, input.bytes, input.fileName, kind);
  const update: TablesUpdate<"candidates"> = cvColumns(read, path);
  if (existing && read.fields) {
    Object.assign(update, fillEmpty(existing, { ...read.fields, video_url: null }));
  }
  const { error: updateError } = await db.from("candidates").update(update).eq("id", candidateId);
  if (updateError) throw new Error(`Could not save the CV text: ${updateError.message}`);
  await queueCvReading(db, candidateId, read, { path, name: input.fileName, kind });

  let alreadyInVacancy = false;
  if (input.vacancyId) {
    const { already } = await addToPipeline(db, { vacancyId: input.vacancyId, source: input.source, origin: input.origin }, [candidateId]);
    alreadyInVacancy = already.has(candidateId);
  }

  return {
    fileName: input.fileName,
    outcome: existing ? "matched" : "created",
    candidateId,
    candidateName,
    textStatus: read.status,
    note: read.note,
    alreadyInVacancy,
  };
}

/**
 * "Read CV": read the candidate's uploaded CV file into cv_text, and fill
 * empty fields. Returns the status and a note for the UI.
 */
export async function readStoredCv(db: Db, candidateId: string): Promise<{ status: CvTextStatus; note: string | null; characters: number }> {
  const { data: candidate, error } = await db
    .from("candidates")
    .select("id, cv_path, email, phone, linkedin_url, current_title, years_experience, skills, summary, video_url, employers")
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the candidate: ${error.message}`);
  if (!candidate) throw new Error("This candidate no longer exists.");
  if (!candidate.cv_path) throw new Error("This candidate has no uploaded CV.");

  const fileName = candidate.cv_path.split("/").pop() ?? "cv";
  const kind = cvFileKind(fileName, null);
  if (!kind) throw new Error("The uploaded CV is not a PDF or DOCX file.");
  const { data: blob, error: downloadError } = await db.storage.from(ATTACHMENTS_BUCKET).download(candidate.cv_path);
  if (downloadError || !blob) throw new Error("The CV file could not be opened.");
  const bytes = Buffer.from(await blob.arrayBuffer());

  const read = await readCvFile(bytes, fileName, kind);
  const update: TablesUpdate<"candidates"> = {
    cv_text_status: read.status,
    cv_read_at: read.status === "read" ? new Date().toISOString() : null,
    ...(read.text ? { cv_text: read.text } : {}),
    ...(read.fields ? fillEmpty(candidate, { ...read.fields, video_url: null }) : {}),
  };
  const { error: updateError } = await db.from("candidates").update(update).eq("id", candidateId);
  if (updateError) throw new Error(`Could not save the CV text: ${updateError.message}`);
  await queueCvReading(db, candidateId, read, { path: candidate.cv_path, name: fileName, kind });
  return { status: read.status, note: read.note, characters: read.text?.length ?? 0 };
}

/**
 * A CV that came in through the application form: read it into cv_text
 * unless the candidate already has text. Returns what happened, or null
 * when there was nothing to read.
 */
export async function readFormCv(db: Db, candidateId: string) {
  const { data: candidate } = await db.from("candidates").select("cv_path, cv_text_status, has_cv_text").eq("id", candidateId).maybeSingle();
  if (!candidate?.cv_path || candidate.has_cv_text || candidate.cv_text_status === "read") return null;
  return readStoredCv(db, candidateId);
}

/** Candidates with a CV file but no text yet (form uploads before this existed, failed reads), oldest first. */
export async function cvsToRead(db: Db, limit: number) {
  const { data, error } = await db
    .from("candidates")
    .select("id")
    .not("cv_path", "is", null)
    .eq("has_cv_text", false)
    .or("cv_text_status.is.null,cv_text_status.eq.pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Could not load the CVs to read: ${error.message}`);
  return data.map((c) => c.id);
}

/**
 * Without the API key Claude reads CVs through the MCP (claude-requests):
 * the fields from text read in code (cv_fields), or a PDF the portal could
 * not read (cv_read, text and fields).
 */
export async function queueCvReading(db: Db, candidateId: string, read: CvReadResult, file: { path: string; name: string; kind: CvFileKind }) {
  if (hasClaude()) return;
  if (read.text && !read.fields) {
    await requestAi(db, {
      kind: "cv_fields",
      module: "recruitment",
      entityType: "candidate",
      entityId: candidateId,
      system: CV_READ_SYSTEM,
      input: `File: ${file.name}\n\n${read.text.slice(0, 60000)}`,
    });
  } else if (read.status === "pending" && file.kind === "pdf") {
    await requestAi(db, {
      kind: "cv_read",
      module: "recruitment",
      entityType: "candidate",
      entityId: candidateId,
      system: `${CV_READ_SYSTEM}\n\n${CV_PDF_EXTRA}`,
      input: [
        { type: "file", path: file.path, mime: "application/pdf", title: file.name },
        { type: "text", text: `File: ${file.name}. Read this CV.` },
      ],
    });
  }
}

/** Store what Claude read: the text (when given and not read yet) and fields that are still empty. */
export async function applyCvReading(db: Db, candidateId: string, reading: { cv_text?: string | null; fields?: CvFields | null }) {
  const { data: candidate, error } = await db
    .from("candidates")
    .select("id, cv_text_status, email, phone, linkedin_url, current_title, years_experience, skills, summary, video_url, employers")
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the candidate: ${error.message}`);
  if (!candidate) throw new Error("This candidate no longer exists.");
  const update: TablesUpdate<"candidates"> = {};
  const text = storableCvText(reading.cv_text);
  if (text && candidate.cv_text_status !== "read") {
    Object.assign(update, { cv_text: text, cv_text_status: "read", cv_read_at: new Date().toISOString() });
  }
  if (reading.fields) Object.assign(update, fillEmpty(candidate, { ...toFields(reading.fields), video_url: null }));
  if (Object.keys(update).length === 0) return { updated: [] as string[] };
  const { error: updateError } = await db.from("candidates").update(update).eq("id", candidateId);
  if (updateError) throw new Error(`Could not save the CV reading: ${updateError.message}`);
  return { updated: Object.keys(update) };
}
