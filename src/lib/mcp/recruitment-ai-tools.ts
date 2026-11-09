import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MATCH_SYSTEM } from "@/lib/ai/prompts/match";
import { searchBriefSchema } from "@/lib/ai/prompts/search";
import { CV_PDF_EXTRA, CV_READ_SYSTEM, cvFieldsSchema, cvScoreSchema, jobInput, screeningSystem } from "@/lib/ai/prompts/screening";
import type { Json, TablesUpdate } from "@/lib/database.types";
import { check, fail, idSchema, ok, type McpToolContext } from "@/lib/mcp/shared";
import { effectiveModules } from "@/lib/modules";
import { fillEmpty } from "@/lib/screening/candidate-csv";
import { toFields } from "@/lib/screening/cv-read";
import { cvFileKind, storableCvText } from "@/lib/screening/cv-text";
import {
  CANDIDATE_SCORING_COLUMNS,
  getActivePrompt,
  insertCvScore,
  loadScoringVacancy,
  OUT_OF_FLOW,
  scoringText,
  type CandidateRow,
} from "@/lib/screening/score-run";
import { normalizeScore } from "@/lib/screening/scoring";
import { ATTACHMENTS_BUCKET } from "@/lib/storage";
import { buildMatchPool, cleanScoredMatches, searchBriefInput, storeMatches, storeSearchBrief } from "@/lib/talent/match";

/**
 * Matching (T2, T3) and CV screening (2.11) through Claude (spec 2.14:
 * Claude is the engine). The portal needs no ANTHROPIC_API_KEY for these:
 * Claude's scheduled tasks claude-match and claude-screening
 * (docs/claude-jobs.md) read the work with these tools, judge it themselves
 * and save the result. The portal does the parts that must go the same every
 * time: the prefilter, redaction of names and contact details, the must have
 * cap, the verdict and the stage.
 */

export const RECRUITMENT_AI_READ_TOOLS = ["get_cv_file", "get_match_pool", "list_applications_to_score", "list_match_requests"] as const;
export const RECRUITMENT_AI_WRITE_TOOLS = ["save_cv_score", "save_cv_text", "save_matches", "save_search_brief"] as const;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** Largest CV file handed to Claude. */
const MAX_CV_BYTES = 10 * 1024 * 1024;

export function hasRecruitment(ctx: Pick<McpToolContext, "role" | "modules">): boolean {
  return effectiveModules(ctx.role, ctx.modules).includes("recruitment");
}

export function registerRecruitmentAiTools(server: McpServer, ctx: McpToolContext) {
  if (!hasRecruitment(ctx)) return;
  registerReadTools(server, ctx);
  if (ctx.access === "write") registerWriteTools(server, ctx);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : "unknown error");

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function registerReadTools(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;

  server.registerTool(
    "list_match_requests",
    {
      title: "List match requests",
      description:
        "Vacancies where someone pressed Match in the portal and that wait for Claude (task claude-match), oldest first. Work each one with get_match_pool and save_matches.",
      inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
      annotations: READ_ONLY,
    },
    async ({ limit }) => {
      const rows = check(
        await db
          .from("vacancies")
          .select("id, title, status, match_requested_at, stack, must_haves")
          .not("match_requested_at", "is", null)
          .order("match_requested_at", { ascending: true })
          .limit(limit),
        "match requests",
      );
      return ok({
        vacancies: rows.map((v) => ({
          vacancy_id: v.id,
          title: v.title,
          status: v.status,
          requested_at: v.match_requested_at,
          has_requirements: v.stack.length > 0 || v.must_haves.length > 0,
        })),
      });
    },
  );

  server.registerTool(
    "get_match_pool",
    {
      title: "Get match pool",
      description:
        "The fixed requirements of one vacancy and the prefiltered candidates from the talent pool, without names, contact details or employers, plus the instructions to score them. Score every candidate (ref is the candidate_id) and save with save_matches.",
      inputSchema: {
        vacancy_id: idSchema,
        top: z.number().int().min(1).max(100).default(25).describe("How many prefiltered candidates to judge."),
        pool: z.number().int().min(1).max(2000).default(500).describe("Cap on the SQL prefilter."),
      },
      annotations: READ_ONLY,
    },
    async ({ vacancy_id, top, pool }) => {
      try {
        const result = await buildMatchPool(db, vacancy_id, { topN: top, poolLimit: pool });
        return ok({
          vacancy_id,
          title: result.vacancy.title,
          pool_size: result.poolSize,
          after_sql_prefilter: result.prefilteredFromPool,
          instructions: `${MATCH_SYSTEM}\n\nThe ref of a candidate is its candidate_id: pass it back as candidate_id in save_matches.`,
          requirements: result.requirements,
          candidates: result.candidates.map((c) => c.payload),
        });
      } catch (error) {
        return fail(errorText(error));
      }
    },
  );

  server.registerTool(
    "list_applications_to_score",
    {
      title: "List CVs to score",
      description:
        "Applications that wait for a CV score (task claude-screening): never scored, or a re-score was asked for. Per vacancy the job text and requirements, per application the CV text without name and contact details, plus the scoring instructions. Score each one and save with save_cv_score. cv_pending true: read the PDF first with get_cv_file and save_cv_text.",
      inputSchema: {
        vacancy_id: idSchema.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_ONLY,
    },
    async ({ vacancy_id, limit }) => {
      let q = db
        .from("applications")
        .select("id, vacancy_id, candidate_id, cv_scored_at, score_requested_at", { count: "exact" })
        .not("stage", "in", `(${OUT_OF_FLOW.join(",")})`)
        .or("cv_scored_at.is.null,score_requested_at.not.is.null")
        .order("created_at", { ascending: true })
        .limit(limit);
      if (vacancy_id) q = q.eq("vacancy_id", vacancy_id);
      const { data: apps, error, count } = await q;
      if (error) return fail(`Could not load the applications: ${error.message}`);
      if (apps.length === 0) return ok({ applications: [], vacancies: {}, remaining: 0 });

      const prompt = await getActivePrompt(db);
      const candidates = check(
        await db.from("candidates").select(CANDIDATE_SCORING_COLUMNS).in("id", [...new Set(apps.map((a) => a.candidate_id))]),
        "candidates",
      ) as CandidateRow[];
      const byId = new Map(candidates.map((c) => [c.id, c]));

      const vacancies: Record<string, { title: string; job: string; requirements: { label: string; kind: string }[] }> = {};
      for (const id of new Set(apps.map((a) => a.vacancy_id))) {
        try {
          const { vacancy, requirements } = await loadScoringVacancy(db, id);
          vacancies[id] = {
            title: vacancy.title,
            job: jobInput({ ...vacancy, description: vacancy.description ?? vacancy.raw_text }, requirements),
            requirements: requirements.map((r) => ({ label: r.label, kind: r.kind })),
          };
        } catch {
          // A vacancy that vanished: its applications are left out below.
        }
      }

      const applications = apps
        .filter((a) => vacancies[a.vacancy_id])
        .map((a) => {
          const c = byId.get(a.candidate_id);
          const pending = Boolean(c && !c.cv_text && c.cv_path && c.cv_text_status !== "failed");
          return {
            application_id: a.id,
            vacancy_id: a.vacancy_id,
            candidate_id: a.candidate_id,
            rescore: a.cv_scored_at !== null,
            cv_pending: pending,
            cv: c && !pending ? scoringText(c) : null,
          };
        });
      return ok({
        instructions: screeningSystem(prompt.instructions),
        prompt_version: prompt.version,
        note: "cv null and cv_pending false: no CV text or skills, skip it. Answer per application in the output format above.",
        vacancies,
        applications,
        remaining: Math.max(0, (count ?? 0) - apps.length),
      });
    },
  );

  server.registerTool(
    "get_cv_file",
    {
      title: "Get CV file",
      description:
        "The uploaded CV of a candidate whose text is still pending (a PDF the portal could not read in code), with the instructions to read it. Read it and store the text with save_cv_text.",
      inputSchema: { candidate_id: idSchema },
      annotations: READ_ONLY,
    },
    async ({ candidate_id }) => {
      const candidate = check(
        await db.from("candidates").select("id, cv_path, cv_text_status").eq("id", candidate_id).maybeSingle(),
        "candidate",
      );
      if (!candidate || Array.isArray(candidate)) return fail("Candidate not found.");
      if (!candidate.cv_path) return fail("This candidate has no uploaded CV.");
      const fileName = candidate.cv_path.split("/").pop() ?? "cv.pdf";
      if (cvFileKind(fileName, null) !== "pdf") return fail("Only PDF CVs are pending; this file is read in code.");
      const { data: blob, error } = await db.storage.from(ATTACHMENTS_BUCKET).download(candidate.cv_path);
      if (error || !blob) return fail("The CV file could not be opened.");
      if (blob.size > MAX_CV_BYTES) return fail("The CV file is larger than 10 MB.");
      const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      return {
        content: [
          {
            type: "text",
            text: `${CV_READ_SYSTEM}\n\n${CV_PDF_EXTRA}\n\nSave the result with save_cv_text (candidate_id ${candidate_id}): cv_text plus the fields.`,
          },
          {
            type: "resource",
            resource: { uri: `nordavo://candidates/${candidate_id}/cv.pdf`, mimeType: "application/pdf", blob: base64 },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const matchSchema = z.object({
  candidate_id: idSchema,
  score: z.number().min(0).max(100),
  reason: z.string().min(1).max(1000),
  risks: z.array(z.string().max(300)).max(10).default([]),
  missing: z.array(z.string().max(300)).max(20).default([]),
});

function registerWriteTools(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;

  server.registerTool(
    "save_matches",
    {
      title: "Save matches",
      description:
        "Save Claude's scores for the candidates of get_match_pool. Stores the top 3 plus everyone at or above keep_above, moves the vacancy to talent stage zoeken and clears the match request. With fewer than 3 scores of 70 or higher it returns search_brief_input: make the brief and save it with save_search_brief.",
      inputSchema: {
        vacancy_id: idSchema,
        matches: z.array(matchSchema).max(100),
        keep_above: z.number().int().min(0).max(100).nullable().default(50).describe("null: the top 3 only."),
      },
      annotations: WRITE,
    },
    async ({ vacancy_id, matches, keep_above }) => {
      try {
        const scored = cleanScoredMatches(matches.map((m) => ({ ...m, candidateId: m.candidate_id })));
        if (scored.length > 0) {
          // Only candidates that exist; a made up id would fail the whole upsert.
          const found = check(await db.from("candidates").select("id").in("id", scored.map((s) => s.candidateId)), "candidates");
          const known = new Set(found.map((c) => c.id));
          const unknown = scored.filter((s) => !known.has(s.candidateId)).map((s) => s.candidateId);
          if (unknown.length > 0) return fail(`Unknown candidate_id: ${unknown.join(", ")}. Use the refs of get_match_pool.`);
        }
        const saved = await storeMatches(db, vacancy_id, scored, { keepAbove: keep_above });
        const context = { scored: scored.length, strong: saved.strong };
        return ok({
          vacancy_id,
          scored: scored.length,
          stored: saved.stored,
          strong: saved.strong,
          search_brief_input: saved.needsSearchBrief ? { ...(await searchBriefInput(db, vacancy_id, context)), ...context } : null,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    },
  );

  server.registerTool(
    "save_search_brief",
    {
      title: "Save search brief",
      description:
        "Save the search brief outside the pool (T3) on a vacancy: keywords, LinkedIn and Naukri booleans, titles, locations (Bangalore is put first), minimum years and notes. Replaces an older brief.",
      inputSchema: {
        vacancy_id: idSchema,
        brief: searchBriefSchema,
        scored: z.number().int().min(0).max(1000).default(0),
        strong: z.number().int().min(0).max(1000).default(0),
      },
      annotations: WRITE,
    },
    async ({ vacancy_id, brief, scored, strong }) => {
      try {
        const stored = await storeSearchBrief(db, vacancy_id, brief, { scored, strong });
        return ok({ vacancy_id, generated_at: stored.generated_at });
      } catch (error) {
        return fail(errorText(error));
      }
    },
  );

  server.registerTool(
    "save_cv_score",
    {
      title: "Save CV score",
      description:
        "Save Claude's score of one CV from list_applications_to_score: per requirement met, alternative or missing with evidence, the match percentage, verdict and summary. The portal caps the score below 50 when a must have is missing and sets the verdict from the score.",
      inputSchema: {
        application_id: idSchema,
        ...cvScoreSchema.shape,
        model: z.string().max(60).optional().describe("The model that scored, e.g. claude-opus-5-5."),
      },
      annotations: WRITE,
    },
    async ({ application_id, model, ...raw }) => {
      try {
        const app = check(
          await db.from("applications").select("id, vacancy_id, candidate_id, stage").eq("id", application_id).maybeSingle(),
          "application",
        );
        if (!app || Array.isArray(app)) return fail("Application not found.");
        if (OUT_OF_FLOW.includes(app.stage)) return fail("This application is rejected or placed: it is not scored.");
        const [{ requirements }, prompt] = await Promise.all([loadScoringVacancy(db, app.vacancy_id), getActivePrompt(db)]);
        const result = normalizeScore(raw, requirements);
        await insertCvScore(db, {
          application_id,
          vacancy_id: app.vacancy_id,
          candidate_id: app.candidate_id,
          purpose: "score",
          score: result.score,
          verdict: result.verdict,
          summary: result.summary,
          breakdown: result.breakdown as unknown as Json,
          must_have_missing: result.mustHaveMissing,
          model: model?.trim() || "claude-mcp",
          prompt_id: prompt.id,
          prompt_version: prompt.version,
          created_by: ctx.userId,
        });
        return ok({ application_id, score: result.score, verdict: result.verdict, must_have_missing: result.mustHaveMissing });
      } catch (error) {
        return fail(errorText(error));
      }
    },
  );

  server.registerTool(
    "save_cv_text",
    {
      title: "Save CV text",
      description:
        "Store the text of a pending PDF CV that Claude read with get_cv_file, and fill fields of the candidate that are still empty (nothing is overwritten). Then the CV can be scored.",
      inputSchema: {
        candidate_id: idSchema,
        cv_text: z.string().min(1).max(200_000),
        fields: cvFieldsSchema.partial().optional(),
      },
      annotations: WRITE,
    },
    async ({ candidate_id, cv_text, fields }) => {
      const candidate = check(
        await db
          .from("candidates")
          .select("id, email, phone, linkedin_url, current_title, years_experience, skills, summary, video_url, employers")
          .eq("id", candidate_id)
          .maybeSingle(),
        "candidate",
      );
      if (!candidate || Array.isArray(candidate)) return fail("Candidate not found.");
      const text = storableCvText(cv_text);
      if (!text) return fail("The CV text is empty.");
      const update: TablesUpdate<"candidates"> = {
        cv_text: text,
        cv_text_status: "read",
        cv_read_at: new Date().toISOString(),
      };
      if (fields) {
        const clean = toFields({
          full_name: fields.full_name ?? null,
          email: fields.email ?? null,
          phone: fields.phone ?? null,
          linkedin_url: fields.linkedin_url ?? null,
          location: fields.location ?? null,
          current_title: fields.current_title ?? null,
          years_experience: fields.years_experience ?? null,
          skills: fields.skills ?? [],
          employers: fields.employers ?? [],
          summary: fields.summary ?? null,
        });
        Object.assign(update, fillEmpty(candidate, { ...clean, video_url: null }));
      }
      const { error } = await db.from("candidates").update(update).eq("id", candidate_id);
      if (error) return fail(`Could not save the CV text: ${error.message}`);
      return ok({ candidate_id, characters: text.length, fields_filled: Object.keys(update).filter((k) => !k.startsWith("cv_")) });
    },
  );
}
