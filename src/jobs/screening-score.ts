import { defineJob } from "@/lib/gtm/jobs";
import { scoreApplications } from "@/lib/screening/score-run";
import { isScreeningModel } from "@/lib/screening/scoring";

/**
 * 2.11: score every unscored CV against its vacancy's JD, no daily limit.
 * Reads pending PDF CVs first when Claude is connected.
 *
 *   npm run job -- screening-score [--vacancy=<uuid>] [--limit=500] [--model=claude-haiku-5-5] [--bulk=true] [--concurrency=4]
 *
 * Without --vacancy it scores the unscored applications of every vacancy.
 * --model overrides the vacancy's model for this run (a cheap first pass);
 * --bulk=true uses low effort. Only counts go into job_runs.
 */
function intParam(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export const screeningScore = defineJob({
  name: "screening-score",
  description: "2.11: score unscored CVs against the JD (param vacancy optional, limit, model)",
  run: async (ctx) => {
    const vacancyId = ctx.params.vacancy;
    if (vacancyId && !/^[0-9a-f-]{36}$/i.test(vacancyId)) throw new Error("--vacancy must be a vacancy id.");
    const model = ctx.params.model;
    if (model && !isScreeningModel(model)) throw new Error("--model must be claude-haiku-5-5, claude-sonnet-5-5 or claude-opus-5-5.");
    const summary = await scoreApplications(ctx.db, {
      vacancyId: vacancyId || undefined,
      limit: intParam(ctx.params.limit, 500, 1, 2000),
      concurrency: intParam(ctx.params.concurrency, 4, 1, 8),
      model: model && isScreeningModel(model) ? model : undefined,
      bulk: ctx.params.bulk === "true",
      log: ctx.log,
    });
    ctx.countIn(summary.considered);
    ctx.countOut(summary.scored);
    ctx.meta.skipped = summary.skipped;
    ctx.meta.failed = summary.failed;
    ctx.meta.remaining = summary.remaining;
    ctx.meta.cost_usd = summary.costUsd;
    ctx.meta.input_tokens = summary.inputTokens;
    ctx.meta.output_tokens = summary.outputTokens;
    ctx.meta.cache_read_tokens = summary.cacheReadTokens;
    if (vacancyId) ctx.meta.vacancy_id = vacancyId;
    if (summary.considered > 0 && summary.failed === summary.considered) {
      throw new Error(`No CV could be scored: ${summary.errors[0] ?? "unknown error"}`);
    }
  },
});
