import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ApplicationStage, AttachmentKind, NoteKind } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/data/candidates";

export type StageNote = {
  id: string;
  body: string;
  kind: NoteKind;
  stage: ApplicationStage | null;
  /** The application the note is on, or null for a note on the candidate. */
  applicationId: string | null;
  vacancyTitle: string | null;
  authorId: string | null;
  authorName: string;
  createdAt: string;
};

export type KindAttachment = {
  id: string;
  fileName: string;
  kind: AttachmentKind;
  sizeBytes: number | null;
  uploaderName: string;
  createdAt: string;
};

function author(p: { full_name: string | null; email: string | null } | null) {
  return p?.full_name || p?.email || "Unknown";
}

/** Notes and files (background check report, test result) of one application. */
export async function getApplicationExtras(applicationId: string) {
  await requireStaff();
  if (!isUuid(applicationId)) return { notes: [] as StageNote[], files: [] as KindAttachment[] };
  const supabase = await createClient();

  const [notes, files] = await Promise.all([
    supabase
      .from("notes")
      .select("id, body, kind, stage, author_id, created_at, author:profiles(full_name, email)")
      .eq("entity_type", "application")
      .eq("entity_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("attachments")
      .select("id, file_name, kind, size_bytes, created_at, uploader:profiles(full_name, email)")
      .eq("entity_type", "application")
      .eq("entity_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (notes.error) throw new Error(`Could not load notes: ${notes.error.message}`);
  if (files.error) throw new Error(`Could not load files: ${files.error.message}`);

  return {
    notes: notes.data.map(
      (n): StageNote => ({
        id: n.id,
        body: n.body,
        kind: n.kind,
        stage: n.stage,
        applicationId,
        vacancyTitle: null,
        authorId: n.author_id,
        authorName: author(n.author),
        createdAt: n.created_at,
      }),
    ),
    files: files.data.map(
      (f): KindAttachment => ({
        id: f.id,
        fileName: f.file_name,
        kind: f.kind,
        sizeBytes: f.size_bytes,
        uploaderName: author(f.uploader),
        createdAt: f.created_at,
      }),
    ),
  };
}

export type ApplicationExtras = Awaited<ReturnType<typeof getApplicationExtras>>;

/**
 * Everything the recruitment panel on the candidate page needs: topper and
 * park state, the applications (to park them too or to write a note on),
 * and the notes on the candidate and on each application.
 */
export async function getCandidateRecruitment(candidateId: string) {
  await requireStaff();
  if (!isUuid(candidateId)) return null;
  const supabase = await createClient();

  const [candidate, applications] = await Promise.all([
    supabase
      .from("candidates")
      .select("id, full_name, status, park_reason, parked_at, is_topper, topper_reason, topper_at, topper_by")
      .eq("id", candidateId)
      .maybeSingle(),
    supabase
      .from("applications")
      .select("id, stage, exit_from_stage, park_reason, vacancy:vacancies(id, title)")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false }),
  ]);
  if (candidate.error) throw new Error(`Could not load candidate: ${candidate.error.message}`);
  if (applications.error) throw new Error(`Could not load applications: ${applications.error.message}`);
  if (!candidate.data) return null;

  const applicationIds = applications.data.map((a) => a.id);
  const titles = new Map(applications.data.map((a) => [a.id, a.vacancy?.title ?? null]));

  const noteQuery = supabase
    .from("notes")
    .select("id, body, kind, stage, entity_type, entity_id, author_id, created_at, author:profiles(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(300);
  const { data: notes, error: notesError } = await (applicationIds.length > 0
    ? noteQuery.or(
        `and(entity_type.eq.candidate,entity_id.eq.${candidateId}),and(entity_type.eq.application,entity_id.in.(${applicationIds.join(",")}))`,
      )
    : noteQuery.eq("entity_type", "candidate").eq("entity_id", candidateId));
  if (notesError) throw new Error(`Could not load notes: ${notesError.message}`);

  const { topper_by, ...rest } = candidate.data;
  const { data: topper } = topper_by
    ? await supabase.from("profiles").select("full_name, email").eq("id", topper_by).maybeSingle()
    : { data: null };
  return {
    candidate: { ...rest, topperByName: topper ? author(topper) : null },
    applications: applications.data.map((a) => ({
      id: a.id,
      stage: a.stage,
      exitFromStage: a.exit_from_stage,
      parkReason: a.park_reason,
      vacancyId: a.vacancy?.id ?? null,
      vacancyTitle: a.vacancy?.title ?? "Unknown vacancy",
    })),
    notes: notes.map(
      (n): StageNote => ({
        id: n.id,
        body: n.body,
        kind: n.kind,
        stage: n.stage,
        applicationId: n.entity_type === "application" ? n.entity_id : null,
        vacancyTitle: n.entity_type === "application" ? (titles.get(n.entity_id) ?? null) : null,
        authorId: n.author_id,
        authorName: author(n.author),
        createdAt: n.created_at,
      }),
    ),
  };
}

export type CandidateRecruitment = NonNullable<Awaited<ReturnType<typeof getCandidateRecruitment>>>;
