import type { Json } from "@/lib/database.types";
import { defineJob, forEachSafe } from "@/lib/gtm/jobs";
import { pushContactToCrm, requireOnePage } from "@/lib/integrations/onepage";

/**
 * S9 push: contacts that earned a place in OnePageCRM (hard rule 8).
 * Triggers: a positive reply, a booked meeting, or a manual mark (the latest
 * activity is a note starting with "Naar CRM"). The sales UI pushes directly
 * with pushContactToCrm; this job is the daily safety net.
 *
 * Params: --limit=100 (contacts per run), --days=60 (how far back to look).
 */

const triggerLabels: Record<string, string> = {
  reply_positief: "positieve reply",
  afspraak: "afspraak geboekt",
  afspraak_goedgekeurd: "afspraak goedgekeurd",
};

export const s9OnepagePush = defineJob({
  name: "s9-onepage-push",
  description: "S9: gekwalificeerde contacten naar OnePageCRM",
  run: async (ctx) => {
    requireOnePage();
    const limit = Number(ctx.params.limit) || 100;
    const days = Number(ctx.params.days) || 60;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    // 1. Positive replies and booked meetings without onepage_id, newest first.
    const { data: triggered, error } = await ctx.db
      .from("activities")
      .select("contact_id, outcome, date, contact:contacts!inner(id, onepage_id, status, company:companies!inner(icp_decision))")
      .in("outcome", Object.keys(triggerLabels) as ("reply_positief" | "afspraak" | "afspraak_goedgekeurd")[])
      .not("contact_id", "is", null)
      .is("contact.onepage_id", null)
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(limit * 3);
    if (error) throw error;

    // 2. Manual marks: a note starting with "Naar CRM" that is still the latest activity.
    const { data: marks, error: markError } = await ctx.db
      .from("activities")
      .select("id, contact_id, notes, date, contact:contacts!inner(id, onepage_id, status, company:companies!inner(icp_decision))")
      .eq("outcome", "notitie")
      .ilike("notes", "Naar CRM%")
      .not("contact_id", "is", null)
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(limit);
    if (markError) throw markError;

    const queue = new Map<string, { reason: string; qualified: boolean }>();
    const qualified = (c: { status: string; company: { icp_decision: string | null } }) =>
      c.company.icp_decision === "GO" && c.status !== "nieuw" && c.status !== "uitgesloten";

    for (const mark of marks ?? []) {
      if (!mark.contact_id || queue.has(mark.contact_id)) continue;
      const { data: latest } = await ctx.db
        .from("activities")
        .select("id")
        .eq("contact_id", mark.contact_id)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest?.id !== mark.id) continue;
      const note = mark.notes?.replace(/^Naar CRM[:\s]*/i, "").trim();
      queue.set(mark.contact_id, { reason: note || "handmatig gemarkeerd", qualified: qualified(mark.contact) });
    }
    for (const row of triggered ?? []) {
      if (!row.contact_id || queue.has(row.contact_id)) continue;
      queue.set(row.contact_id, { reason: triggerLabels[row.outcome] ?? row.outcome, qualified: qualified(row.contact) });
    }

    const items = [...queue.entries()].slice(0, limit);
    ctx.countIn(items.length);
    const skipped = items.filter(([, item]) => !item.qualified).map(([id]) => id);
    if (skipped.length) ctx.log(`${skipped.length} contacten overgeslagen: bedrijf niet GO of contact nog niet gekwalificeerd (regel 8).`);

    const pushed: string[] = [];
    await forEachSafe(
      ctx,
      items.filter(([, item]) => item.qualified),
      ([id]) => `contact ${id}`,
      async ([contactId, { reason }]) => {
        const { onepageId } = await pushContactToCrm(ctx.db, contactId, { reason });
        pushed.push(onepageId);
        ctx.countOut();
      },
    );

    ctx.meta.pushed = pushed.length;
    ctx.meta.skipped_not_qualified = skipped.length;
    ctx.meta.skipped_contact_ids = skipped.slice(0, 50) as unknown as Json;
    ctx.log(`${pushed.length} contacten naar OnePageCRM.`);
  },
});
