import type { Json, TablesInsert } from "@/lib/database.types";
import { defineJob, forEachSafe } from "@/lib/gtm/jobs";
import {
  dealStageMap,
  listRecentChanges,
  mapCompletedAction,
  mapDealChange,
  promoteContactStatus,
  requireOnePage,
  type CrmChange,
} from "@/lib/integrations/onepage";

/**
 * S9 pull: outcomes from OnePageCRM back into activities (daily).
 * Deal stage changes and won/lost become activities (gesprek_gehad, afspraak,
 * gewonnen, verloren, or a note for later stages), completed actions become
 * a note or gesprek_gehad. Contact status follows (kans, klant, verloren) and
 * a won deal makes the company klant.
 *
 * Idempotent: external_id is the OnePage id plus timestamp, and each deal
 * state is logged once (checked on the state prefix of external_id).
 *
 * Params: --since=<ISO date> (default: start of the last successful run, else 7 days).
 */
export const s9OnepagePull = defineJob({
  name: "s9-onepage-pull",
  description: "S9: uitkomsten uit OnePageCRM terughalen",
  run: async (ctx) => {
    requireOnePage();

    let since: Date;
    if (ctx.params.since) {
      since = new Date(ctx.params.since);
      if (Number.isNaN(since.getTime())) throw new Error(`Ongeldige datum voor --since: ${ctx.params.since}`);
    } else {
      const { data: lastRun, error } = await ctx.db
        .from("job_runs")
        .select("started_at")
        .eq("job_name", "s9-onepage-pull")
        .eq("status", "success")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      // Overlap by an hour: changes saved during the last run are not missed.
      since = lastRun ? new Date(new Date(lastRun.started_at).getTime() - 3_600_000) : new Date(Date.now() - 7 * 86_400_000);
    }
    ctx.log(`Wijzigingen sinds ${since.toISOString()}.`);

    const map = dealStageMap();
    const { deals, actions } = await listRecentChanges(since);
    const changes = [
      ...deals.map((d) => mapDealChange(d, map)),
      ...actions.map((a) => mapCompletedAction(a)),
    ].filter((c): c is CrmChange => c !== null);
    ctx.countIn(deals.length + actions.length);

    // Our contacts by onepage_id, in one query.
    const onepageIds = [...new Set(changes.map((c) => c.onepageContactId))];
    const contacts = new Map<string, { id: string; company_id: string }>();
    for (let i = 0; i < onepageIds.length; i += 200) {
      const { data, error } = await ctx.db
        .from("contacts")
        .select("id, company_id, onepage_id")
        .in("onepage_id", onepageIds.slice(i, i + 200));
      if (error) throw error;
      for (const c of data ?? []) if (c.onepage_id) contacts.set(c.onepage_id, { id: c.id, company_id: c.company_id });
    }

    let logged = 0;
    let unknown = 0;
    // Oldest first, so statuses end in the latest state.
    changes.sort((a, b) => a.date.localeCompare(b.date));

    await forEachSafe(ctx, changes, (c) => c.stateKey, async (change) => {
      const contact = contacts.get(change.onepageContactId);
      if (!contact) {
        unknown += 1;
        return;
      }

      const { data: seen, error: seenError } = await ctx.db
        .from("activities")
        .select("id")
        .like("external_id", `${change.stateKey}:%`)
        .limit(1);
      if (seenError) throw seenError;
      if (seen && seen.length > 0) return;

      let outcome = change.outcome;
      let notes = change.notes;
      if (outcome === "afspraak") {
        // The meeting itself usually came in already via Cal.com or Web Partners; do not count it twice.
        const { data: meeting } = await ctx.db
          .from("activities")
          .select("id")
          .eq("contact_id", contact.id)
          .in("outcome", ["afspraak", "afspraak_goedgekeurd"])
          .gte("date", new Date(new Date(change.date).getTime() - 60 * 86_400_000).toISOString())
          .limit(1);
        if (meeting && meeting.length > 0) {
          outcome = "notitie";
          notes = `${notes} (afspraak stond al geregistreerd)`;
        }
      }

      const row: TablesInsert<"activities"> = {
        contact_id: contact.id,
        company_id: contact.company_id,
        channel: "meeting",
        outcome,
        notes,
        date: change.date,
        source: "onepage",
        external_id: change.externalId,
      };
      const { error } = await ctx.db.from("activities").upsert(row, { onConflict: "external_id", ignoreDuplicates: true });
      if (error) throw error;

      if (change.contactStatus) await promoteContactStatus(ctx.db, contact.id, change.contactStatus);
      if (change.companyWon) {
        const { error: companyError } = await ctx.db.from("companies").update({ status: "klant" }).eq("id", contact.company_id);
        if (companyError) throw companyError;
      }
      logged += 1;
      ctx.countOut();
    });

    ctx.meta.since = since.toISOString();
    ctx.meta.deals = deals.length;
    ctx.meta.completed_actions = actions.length;
    ctx.meta.logged = logged;
    ctx.meta.unknown_contacts = unknown as Json;
    ctx.log(`${logged} activiteiten vastgelegd, ${unknown} wijzigingen bij contacten die niet uit Supabase komen.`);
  },
});
