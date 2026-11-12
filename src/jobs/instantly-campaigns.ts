import { defineJob } from "@/lib/gtm/jobs";
import type { Json } from "@/lib/database.types";
import { campaignStatusFor, fetchCampaignLeads, hasInstantly, listCampaigns } from "@/lib/integrations/instantly";

/**
 * The running campaigns in Instantly with their leads and who replied
 * (feedback Julius, 4f7fd90a), as a fallback for Claude's task
 * claude-campaigns (docs/claude-jobs.md):
 *   npm run job -- s8-instantly-campaigns [--max_pages=20] [--all=1]
 * Every Instantly campaign becomes a campaign in the portal (provider
 * instantly, its id as external_id). Leads are matched on the mail address
 * of a contact and registered through sales_register_campaign_members, so
 * the occupancy rules apply: a lead in another running campaign is
 * reported, not added twice. Drafts and finished campaigns are skipped
 * unless --all=1.
 */
export const instantlyCampaigns = defineJob({
  name: "s8-instantly-campaigns",
  description: "Campaigns in Instantly with their leads and replies, into Sequences, Campaigns",
  run: async (ctx) => {
    if (!hasInstantly()) throw new Error("INSTANTLY_API_KEY is missing. Set the Instantly API key in the environment.");
    const db = ctx.db;
    const maxPages = Math.max(1, Math.min(200, Number(ctx.params.max_pages) || 20));
    const all = ctx.params.all === "1";

    const campaigns = await listCampaigns();
    ctx.countIn(campaigns.length);
    const totals = { campaigns: 0, added: 0, updated: 0, unknown: 0, refused: 0 };

    for (const c of campaigns) {
      const status = campaignStatusFor(c.status);
      if (!all && (status === "draft" || status === "finished")) {
        // Still mark a known campaign as finished.
        if (status === "finished") await db.from("campaigns").update({ status }).eq("external_id", c.id).neq("status", "finished");
        continue;
      }
      const { data: existing, error: findError } = await db.from("campaigns").select("id").eq("external_id", c.id).maybeSingle();
      if (findError) throw new Error(findError.message);
      let id = existing?.id;
      if (id) {
        const { error } = await db.from("campaigns").update({ name: c.name, status, provider: "instantly" }).eq("id", id);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await db
          .from("campaigns")
          .insert({ name: c.name, channel: "mail", provider: "instantly", external_id: c.id, status, started_at: new Date().toISOString() })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        id = data.id;
      }
      totals.campaigns += 1;

      const leads = await fetchCampaignLeads(c.id, maxPages);
      for (let i = 0; i < leads.length; i += 500) {
        const members = leads.slice(i, i + 500).map((l) => ({
          email: l.email,
          status: l.status,
          replied_at: l.repliedAt,
          reply_outcome: l.replyOutcome,
          external_id: `instantly:${l.id}`,
        }));
        const { data, error } = await db.rpc("sales_register_campaign_members", {
          p_campaign: id,
          p_members: members as Json,
          p_source: "instantly",
        });
        if (error) throw new Error(`Campaign ${c.name}: ${error.message}`);
        totals.added += data?.added ?? 0;
        totals.updated += data?.updated ?? 0;
        totals.unknown += data?.unknown?.length ?? 0;
        totals.refused += data?.refused?.length ?? 0;
      }
      ctx.countOut();
      ctx.log(`${c.name}: ${leads.length} leads.`);
    }
    Object.assign(ctx.meta, totals);
    ctx.log(
      `${totals.campaigns} campaigns, ${totals.added} members added, ${totals.updated} updated, ${totals.unknown} mail addresses unknown, ${totals.refused} already in another campaign.`,
    );
  },
});
