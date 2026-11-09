import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { insertLessonDraft } from "@/lib/academy/ats/draft-insert";
import { lessonDraftSchema, normalizeDraft } from "@/lib/academy/ats/draft";
import { assessmentSchema, failAssessment, saveAssessment } from "@/lib/academy/learn/ai";
import { matchResultSchema } from "@/lib/ai/prompts/match";
import { profileContentSchema } from "@/lib/ai/prompts/profile";
import { cvFieldsSchema, cvPdfSchema, cvScoreSchema, techstackSchema } from "@/lib/ai/prompts/screening";
import { vacancyExtractionSchema } from "@/lib/ai/prompts/vacancy";
import type { AiRequest, AiRequestKind } from "@/lib/ai/queue";
import type { Database } from "@/lib/database.types";
import { applyCvReading } from "@/lib/screening/cv-read";
import { saveComparisonScore } from "@/lib/screening/score-run";
import { saveTechstackJudgement } from "@/lib/screening/techstack-run";
import { saveAnonymousProfile } from "@/lib/talent/profile";

/**
 * What the portal does with Claude's answer to a queued request (src/lib/ai/queue.ts).
 * Each kind has the schema the answer must match (the same as the direct
 * Claude API call) and an apply step with the same code as the direct path.
 * apply returns "applied" when the answer is stored where it belongs, or
 * "done" when a person still takes it over (a vacancy reading to check, a
 * talent pool answer to read). An apply that throws leaves the request open
 * and hands the error back to Claude, so it can answer again.
 */

type Db = SupabaseClient<Database>;

export type ApplyContext = { actorId: string | null; model: string };

type AiTask<S extends z.ZodType> = {
  /** Short description for Claude. */
  what: string;
  schema: S;
  apply: (db: Db, request: AiRequest, result: z.infer<S>, ctx: ApplyContext) => Promise<"applied" | "done">;
  /** When Claude gives up on a request. */
  onGiveUp?: (db: Db, request: AiRequest, reason: string) => Promise<void>;
};

function task<S extends z.ZodType>(t: AiTask<S>): AiTask<S> {
  return t;
}

function entity(request: AiRequest): string {
  if (!request.entityId) throw new Error("This request has no record.");
  return request.entityId;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

export const aiTasks: Record<AiRequestKind, AiTask<z.ZodType>> = {
  vacancy_extract: task({
    what: "Read a vacancy text into its fixed requirements. A recruiter checks your reading before it is saved.",
    schema: vacancyExtractionSchema,
    apply: async () => "done",
  }),
  techstack_check: task({
    what: "Judge one unclear candidate in the techstack check: pass, fail or unclear, with a short reason.",
    schema: techstackSchema,
    apply: async (db, request, result, ctx) => {
      await saveTechstackJudgement(db, entity(request), result, ctx.model);
      return "applied";
    },
  }),
  talent_pool_rank: task({
    what: "Rank the shortlist of the talent pool for a recruiter's question: a score, reason, risks and missing must haves per candidate (ref is the candidate id).",
    schema: matchResultSchema,
    apply: async () => "done",
  }),
  anonymous_profile: task({
    what: "Write the anonymous profile (T4) of a candidate for a vacancy. It must not contain a name, contact detail or employer: the portal checks that and refuses the answer otherwise.",
    schema: profileContentSchema,
    apply: async (db, request, result) => {
      await saveAnonymousProfile(db, entity(request), result);
      return "applied";
    },
  }),
  cv_score_compare: task({
    what: "Score one CV against the job with a prompt version under test. Stored for comparison only; the application keeps its real score.",
    schema: cvScoreSchema,
    apply: async (db, request, result, ctx) => {
      const vacancyId = str(request.context.vacancy_id);
      const candidateId = str(request.context.candidate_id);
      if (!vacancyId || !candidateId) throw new Error("This request misses its vacancy or candidate.");
      await saveComparisonScore(
        db,
        {
          applicationId: entity(request),
          vacancyId,
          candidateId,
          promptId: str(request.context.prompt_id),
          promptVersion: typeof request.context.prompt_version === "number" ? request.context.prompt_version : 0,
          model: ctx.model,
          actorId: ctx.actorId,
        },
        result,
      );
      return "applied";
    },
  }),
  cv_fields: task({
    what: "Extract the facts of a CV (name, contact details, title, years, skills, employers, summary) from its text. Only empty fields of the candidate are filled.",
    schema: cvFieldsSchema,
    apply: async (db, request, result) => {
      await applyCvReading(db, entity(request), { fields: result });
      return "applied";
    },
  }),
  cv_read: task({
    what: "Read a CV PDF (attached): its full text and the facts. Only empty fields of the candidate are filled.",
    schema: cvPdfSchema,
    apply: async (db, request, result) => {
      await applyCvReading(db, entity(request), { cv_text: result.cv_text, fields: result });
      return "applied";
    },
  }),
  academy_assessment: task({
    what: "Propose a score for an Academy assignment on the fixed rubric. Nordavo sets the final score.",
    schema: assessmentSchema,
    apply: async (db, request, result) => {
      await saveAssessment(db, entity(request), result);
      return "applied";
    },
    onGiveUp: async (db, request, reason) => {
      if (request.entityId) await failAssessment(db, request.entityId, reason);
    },
  }),
  lesson_draft: task({
    what: "Write a lesson draft from a video transcript: an explanation, tasks and a knowledge check of three questions. It lands as draft blocks for Nordavo to accept.",
    schema: lessonDraftSchema,
    apply: async (db, request, result) => {
      const failed = await insertLessonDraft(db, entity(request), normalizeDraft(result), "ai", str(request.context.video_id));
      if (failed) throw new Error(failed);
      return "applied";
    },
  }),
};

export const AI_REQUEST_KINDS = Object.keys(aiTasks) as AiRequestKind[];
