import { defineJob } from "@/lib/gtm/jobs";
import { runMatching } from "@/lib/talent/match";

/**
 * T2: match pool candidates from Airtable on one vacancy and store the top 3
 * in matches (status voorgesteld). Also runs T3 (search brief) when fewer than
 * 3 matches score 70 or higher.
 *
 *   npm run job -- t2-match --vacancy=<uuid> [--top=25] [--batch=5] [--keep-above=50|none]
 *
 * Only counts go into job_runs: no candidate details (hard rule 11).
 */
function intParam(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== "" ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export const t2Match = defineJob({
  name: "t2-match",
  description: "T2: kandidaten uit de Airtable-pool matchen op een vacature (param vacancy)",
  run: async (ctx) => {
    const vacancyId = ctx.params.vacancy;
    if (!vacancyId || !/^[0-9a-f-]{36}$/i.test(vacancyId)) {
      throw new Error("Geef een vacature mee: npm run job -- t2-match --vacancy=<id>");
    }
    const keepAboveParam = ctx.params["keep-above"];
    const summary = await runMatching(ctx.db, vacancyId, {
      topN: intParam(ctx.params.top, 25, 1, 100),
      batchSize: intParam(ctx.params.batch, 5, 1, 10),
      keepAbove: keepAboveParam === "none" ? null : intParam(keepAboveParam, 50, 0, 100),
      log: ctx.log,
    });
    ctx.countIn(summary.poolSize);
    ctx.countOut(summary.stored);
    ctx.meta.vacancy_id = vacancyId;
    ctx.meta.prefiltered = summary.prefiltered;
    ctx.meta.scored = summary.scored;
    ctx.meta.strong = summary.strong;
    ctx.meta.search_brief = summary.searchBrief;
    ctx.log(`${summary.scored} gescoord, ${summary.stored} opgeslagen, ${summary.strong} met score 70 of hoger.`);
  },
});
