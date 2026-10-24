import { defineJob } from "@/lib/gtm/jobs";
import { filterToJson, parseListFilter, pushMailCampaigns } from "@/lib/gtm/lists";
import { hasInstantly } from "@/lib/integrations/instantly";

/**
 * S7: fill the Instantly campaigns, one per signal type.
 *   npm run job -- s7-mail-campaign --signal=lang_open --limit=50 [--segment=saas] [--variant=v2]
 * Default limit is 100 contacts per run, so the first runs stay small.
 */
export const s7MailCampaign = defineJob({
  name: "s7-mail-campaign",
  description: "S7: mailcampagnes in Instantly vullen, één per signaaltype",
  run: async (ctx) => {
    if (!hasInstantly()) throw new Error("INSTANTLY_API_KEY ontbreekt. Zet de API key van Instantly in de omgeving.");
    const filter = parseListFilter(ctx.params, 100);
    const variant = (ctx.params.variant ?? "v1").trim().slice(0, 40) || "v1";
    ctx.meta.filter = filterToJson(filter, { variant });

    const result = await pushMailCampaigns(ctx.db, { filter, variant, log: ctx.log });
    ctx.countIn(result.candidates);
    let failed = 0;
    for (const campaign of result.campaigns) {
      ctx.countOut(campaign.pushed);
      failed += campaign.failed;
    }
    ctx.meta.campaigns = result.campaigns.map((c) => ({ name: c.name, pushed: c.pushed, skipped: c.skipped, failed: c.failed }));
    ctx.meta.without_signal = result.withoutSignal;
    if (failed > 0) ctx.meta.failed_items = failed;
  },
});
