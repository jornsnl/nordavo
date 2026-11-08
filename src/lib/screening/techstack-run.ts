import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJsonWithUsage, hasClaude } from "@/lib/ai/claude";
import { TECHSTACK_SYSTEM, techstackSchema } from "@/lib/ai/prompts/screening";
import type { Database, TablesInsert } from "@/lib/database.types";
import { redactIdentifiers } from "@/lib/talent/anonymize";
import { evaluateTechstack, type TechstackOutcome, type TechstackRules } from "@/lib/screening/techstack";
import { mapLimit } from "@/lib/screening/limit";

/**
 * Runs the techstack check (2.7) on the applications of one vacancy that
 * are in sourced or techstack_check: the keyword pass for everyone, then
 * optionally Claude (the cheap model, low effort) for the unclear ones.
 * Stores the result per application; moves nothing (that happens after a
 * person confirmed, through move_applications).
 */

type Db = SupabaseClient<Database>;

export const TECHSTACK_STAGES = ["sourced", "techstack_check"] as const;
export const TECHSTACK_MODEL = "claude-haiku-5-5";

export type TechstackRunSummary = { checked: number; pass: number; fail: number; unclear: number; byClaude: number };

export async function loadTechstackRules(db: Db, vacancyId: string) {
  const { data, error } = await db
    .from("vacancies")
    .select("id, title, stack, must_haves, excluded_profiles, techstack_min_hits")
    .eq("id", vacancyId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the vacancy: ${error.message}`);
  if (!data) throw new Error("This vacancy no longer exists.");
  return data;
}

export async function runTechstackCheck(
  db: Db,
  vacancyId: string,
  { applicationIds, useClaude = false }: { applicationIds?: string[]; useClaude?: boolean } = {},
): Promise<TechstackRunSummary> {
  const vacancy = await loadTechstackRules(db, vacancyId);
  const rules: TechstackRules = vacancy;

  let q = db
    .from("applications")
    .select("id, candidate:candidates(full_name, email, phone, skills, current_title, summary, cv_text)")
    .eq("vacancy_id", vacancyId)
    .in("stage", [...TECHSTACK_STAGES])
    .limit(2000);
  if (applicationIds && applicationIds.length > 0) q = q.in("id", applicationIds);
  const { data: apps, error } = await q;
  if (error) throw new Error(`Could not load the candidates: ${error.message}`);

  const results = new Map<string, TechstackOutcome & { method: "rules" | "ai"; model: string | null }>();
  for (const app of apps ?? []) {
    const c = app.candidate;
    if (!c) continue;
    const outcome = evaluateTechstack(rules, { skills: c.skills, currentTitle: c.current_title, summary: c.summary, cvText: c.cv_text });
    results.set(app.id, { ...outcome, method: "rules", model: null });
  }

  let byClaude = 0;
  if (useClaude && hasClaude()) {
    const unclear = (apps ?? []).filter((a) => a.candidate && results.get(a.id)?.result === "unclear");
    const role = {
      title: vacancy.title,
      stack: vacancy.stack,
      must_haves: vacancy.must_haves,
      profiles_that_do_not_fit: vacancy.excluded_profiles,
    };
    await mapLimit(unclear, 4, async (app) => {
      const c = app.candidate!;
      const ids = { nameParts: c.full_name.split(/\s+/).filter((p) => p.length >= 2), email: c.email, phone: c.phone, employers: [] };
      const candidate = {
        title: c.current_title,
        skills: c.skills,
        summary: c.summary ? redactIdentifiers(c.summary, ids).slice(0, 1000) : null,
        cv_excerpt: c.cv_text ? redactIdentifiers(c.cv_text, ids).slice(0, 4000) : null,
      };
      try {
        const { data } = await askJsonWithUsage({
          system: TECHSTACK_SYSTEM,
          input: [
            { type: "text", text: `Role:\n${JSON.stringify(role, null, 2)}`, cache: true },
            { type: "text", text: `Candidate:\n${JSON.stringify(candidate, null, 2)}` },
          ],
          schema: techstackSchema,
          effort: "low",
          model: TECHSTACK_MODEL,
          maxTokens: 1000,
        });
        const previous = results.get(app.id)!;
        results.set(app.id, { result: data.result, reason: data.reason.trim().slice(0, 900) || previous.reason, hits: previous.hits, method: "ai", model: TECHSTACK_MODEL });
        byClaude += 1;
      } catch {
        // Keep the keyword result: unclear, for a person.
      }
    });
  }

  const rows: TablesInsert<"techstack_checks">[] = [...results.entries()].map(([applicationId, r]) => ({
    application_id: applicationId,
    vacancy_id: vacancyId,
    result: r.result,
    reason: r.reason.slice(0, 1000),
    hits: r.hits,
    method: r.method,
    model: r.model,
    checked_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: saveError } = await db.from("techstack_checks").upsert(rows.slice(i, i + 500), { onConflict: "application_id" });
    if (saveError) throw new Error(`Could not save the results: ${saveError.message}`);
  }

  const all = [...results.values()];
  return {
    checked: all.length,
    pass: all.filter((r) => r.result === "pass").length,
    fail: all.filter((r) => r.result === "fail").length,
    unclear: all.filter((r) => r.result === "unclear").length,
    byClaude,
  };
}
