import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candidate, CandidateOrigin, CandidateSource, Database, TablesInsert, TablesUpdate } from "@/lib/database.types";
import {
  CandidateIndex,
  dedupeKeys,
  draftFromRow,
  fillEmpty,
  type CandidateCsvRow,
  type CandidateDraft,
  type CandidateImportMapping,
  type DedupeKeys,
} from "@/lib/screening/candidate-csv";

/**
 * Import candidates into one vacancy (2.6.1, 2.18): every row becomes a
 * candidate (or is matched to an existing one on email, LinkedIn or phone)
 * and an application in stage sourced, with the source and origin of the
 * batch on both. Existing candidates only get their empty fields filled.
 * Runs with the user's client: staff RLS allows the writes.
 */

type Db = SupabaseClient<Database>;

export type CandidateImportReport = {
  rows: number;
  created: number;
  matched: number;
  skipped: { row: number; reason: string }[];
};

export type BatchOptions = { vacancyId: string; source: CandidateSource; origin: CandidateOrigin };

type Existing = Pick<
  Candidate,
  "id" | "email" | "phone" | "linkedin_url" | "current_title" | "years_experience" | "skills" | "summary" | "video_url" | "employers" | "source"
>;

/** Existing candidates that share an email, phone key or LinkedIn with these keys. */
export async function findExistingCandidates(db: Db, keys: DedupeKeys[]): Promise<Existing[]> {
  const emails = [...new Set(keys.flatMap((k) => (k.email ? [k.email] : [])))];
  const phones = [...new Set(keys.flatMap((k) => (k.phone ? [k.phone] : [])))];
  const linkedins = [...new Set(keys.flatMap((k) => (k.linkedin ? [k.linkedin] : [])))];
  if (emails.length + phones.length + linkedins.length === 0) return [];
  const { data, error } = await db.rpc("screening_find_candidates", { p_emails: emails, p_phone_keys: phones, p_linkedins: linkedins });
  if (error) throw new Error(`Could not look for existing candidates: ${error.message}`);
  return data ?? [];
}

/** Next free positions at the bottom of the sourced column. */
async function sourcedBase(db: Db, vacancyId: string) {
  const { data } = await db
    .from("applications")
    .select("position")
    .eq("vacancy_id", vacancyId)
    .eq("stage", "sourced")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.position ?? 0;
}

/**
 * Add candidates to the vacancy's pipeline in stage sourced. Returns the ids
 * that were added; candidates already in this vacancy are left alone.
 */
export async function addToPipeline(db: Db, options: BatchOptions, candidateIds: string[]): Promise<{ added: Set<string>; already: Set<string> }> {
  const unique = [...new Set(candidateIds)];
  if (unique.length === 0) return { added: new Set(), already: new Set() };
  const { data: existing, error: loadError } = await db
    .from("applications")
    .select("candidate_id")
    .eq("vacancy_id", options.vacancyId)
    .in("candidate_id", unique);
  if (loadError) throw new Error(`Could not read the pipeline: ${loadError.message}`);
  const already = new Set((existing ?? []).map((a) => a.candidate_id));
  const toAdd = unique.filter((id) => !already.has(id));
  if (toAdd.length === 0) return { added: new Set(), already };
  const base = await sourcedBase(db, options.vacancyId);
  const rows: TablesInsert<"applications">[] = toAdd.map((candidateId, i) => ({
    vacancy_id: options.vacancyId,
    candidate_id: candidateId,
    stage: "sourced",
    position: base + 1024 * (i + 1),
    source: options.source,
    origin: options.origin,
  }));
  const { error } = await db.from("applications").upsert(rows, { onConflict: "vacancy_id,candidate_id", ignoreDuplicates: true });
  if (error) throw new Error(`Could not add the candidates to the pipeline: ${error.message}`);
  return { added: new Set(toAdd), already };
}

function insertRow(draft: CandidateDraft, options: BatchOptions): TablesInsert<"candidates"> {
  return {
    full_name: draft.full_name,
    email: draft.email,
    phone: draft.phone,
    linkedin_url: draft.linkedin_url,
    location: draft.location ?? "Bangalore",
    current_title: draft.current_title,
    years_experience: draft.years_experience,
    skills: draft.skills,
    summary: draft.summary,
    video_url: draft.video_url,
    employers: draft.employers,
    source: options.source,
    origin: options.origin,
  };
}

/**
 * Import one chunk of rows. `offset` is the number of data rows before this
 * chunk, so skipped row numbers match the file (header row is row 1).
 */
export async function importCandidateRows(
  db: Db,
  rows: CandidateCsvRow[],
  mapping: CandidateImportMapping,
  options: BatchOptions,
  offset = 0,
): Promise<CandidateImportReport> {
  const report: CandidateImportReport = { rows: rows.length, created: 0, matched: 0, skipped: [] };
  const rowNumber = (i: number) => offset + i + 2;

  const drafts: { i: number; draft: CandidateDraft; keys: DedupeKeys }[] = [];
  rows.forEach((row, i) => {
    const result = draftFromRow(row, mapping);
    if (!result.ok) report.skipped.push({ row: rowNumber(i), reason: result.reason });
    else drafts.push({ i, draft: result.draft, keys: dedupeKeys(result.draft) });
  });

  const existing = await findExistingCandidates(db, drafts.map((d) => d.keys));
  const byId = new Map(existing.map((c) => [c.id, c]));
  const index = new CandidateIndex(existing);
  // Also dedupe within the file: the second row with the same email points at the first.
  const fileIndex = new CandidateIndex();
  const resolved: { i: number; candidateId: string | null; draft: CandidateDraft; existing: boolean; duplicateOfRow?: number }[] = [];
  const firstRowOfKey = new Map<string, number>();

  for (const d of drafts) {
    const hit = index.find(d.keys);
    if (hit) {
      resolved.push({ i: d.i, candidateId: hit.id, draft: d.draft, existing: true });
      continue;
    }
    const inFile = fileIndex.find(d.keys);
    if (inFile) {
      report.skipped.push({ row: rowNumber(d.i), reason: `Duplicate of row ${firstRowOfKey.get(inFile.id)} in this file (same ${inFile.on})` });
      continue;
    }
    const tempId = `row-${d.i}`;
    fileIndex.add(tempId, d.keys);
    firstRowOfKey.set(tempId, rowNumber(d.i));
    resolved.push({ i: d.i, candidateId: null, draft: d.draft, existing: false });
  }

  // Fill empty fields of matched candidates (never overwrite what is there).
  for (const r of resolved.filter((x) => x.existing)) {
    const current = byId.get(r.candidateId!);
    if (!current) continue;
    const update: TablesUpdate<"candidates"> = fillEmpty(current, r.draft);
    if (!current.source) {
      update.source = options.source;
      update.origin = options.origin;
    }
    if (Object.keys(update).length > 0) {
      await db.from("candidates").update(update).eq("id", current.id);
    }
  }

  // Create the new candidates in one insert.
  const fresh = resolved.filter((r) => !r.existing);
  if (fresh.length > 0) {
    const { data, error } = await db
      .from("candidates")
      .insert(fresh.map((r) => insertRow(r.draft, options)))
      .select("id");
    if (error || !data || data.length !== fresh.length) {
      throw new Error(`Could not create the candidates: ${error?.message ?? "unexpected response"}`);
    }
    data.forEach((row, n) => (fresh[n].candidateId = row.id));
  }

  const ids = resolved.map((r) => r.candidateId!).filter(Boolean);
  const { added, already } = await addToPipeline(db, options, ids);
  const counted = new Set<string>();
  for (const r of resolved) {
    const id = r.candidateId!;
    if (counted.has(id)) {
      report.skipped.push({ row: rowNumber(r.i), reason: "Same candidate as an earlier row" });
      continue;
    }
    counted.add(id);
    if (!r.existing) report.created += 1;
    else if (added.has(id)) report.matched += 1;
    else if (already.has(id)) report.skipped.push({ row: rowNumber(r.i), reason: "Already in this vacancy" });
  }
  return report;
}

/** For the CV upload: the existing candidate with this email, phone or LinkedIn, or null. */
export async function findCandidateByContact(
  db: Db,
  contact: { email: string | null; phone: string | null; linkedin_url: string | null },
): Promise<Existing | null> {
  const keys = dedupeKeys(contact);
  const found = await findExistingCandidates(db, [keys]);
  if (found.length === 0) return null;
  const hit = new CandidateIndex(found).find(keys);
  return hit ? (found.find((c) => c.id === hit.id) ?? null) : null;
}

