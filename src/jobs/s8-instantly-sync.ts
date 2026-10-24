import { defineJob, forEachSafe } from "@/lib/gtm/jobs";
import { chunk } from "@/lib/gtm/lists";
import { activityOutcomeFor, fetchEvents, hasInstantly, type InstantlyEvent } from "@/lib/integrations/instantly";

/**
 * S8 (Instantly side): replies, bounces and unsubscribes back into activities.
 *   npm run job -- s8-instantly-sync [--since=2026-10-01T00:00:00Z] [--max_pages=50]
 * Since the last successful run (minus an hour of overlap; external_id keeps
 * it idempotent), else the last 14 days. The database trigger sends
 * "afgemeld" to suppression, marks a bounce invalid and updates
 * last_contacted_at. Unsubscribes from unknown emails go to suppression here.
 */

const OVERLAP_MS = 60 * 60 * 1000;
const FIRST_RUN_DAYS = 14;

export const s8InstantlySync = defineJob({
  name: "s8-instantly-sync",
  description: "S8: replies, bounces en afmeldingen uit Instantly ophalen",
  run: async (ctx) => {
    if (!hasInstantly()) throw new Error("INSTANTLY_API_KEY ontbreekt. Zet de API key van Instantly in de omgeving.");
    const db = ctx.db;

    let since = ctx.params.since && !Number.isNaN(Date.parse(ctx.params.since)) ? new Date(ctx.params.since).toISOString() : null;
    if (!since) {
      const { data: last } = await db
        .from("job_runs")
        .select("started_at")
        .eq("job_name", "s8-instantly-sync")
        .eq("status", "success")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      since = last
        ? new Date(new Date(last.started_at).getTime() - OVERLAP_MS).toISOString()
        : new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000).toISOString();
    }
    ctx.meta.since = since;
    const maxPages = Math.max(1, Math.min(500, Number(ctx.params.max_pages) || 50));

    const events = await fetchEvents(since, maxPages);
    ctx.countIn(events.length);
    ctx.log(`${events.length} events sinds ${since}.`);
    if (events.length === 0) return;

    // Contacts by email (stored lowercase by the contacts trigger).
    const contacts = new Map<string, { id: string; company_id: string; status: string }>();
    for (const emails of chunk([...new Set(events.map((e) => e.email))], 100)) {
      const { data, error } = await db.from("contacts").select("id, company_id, email, status").in("email", emails);
      if (error) throw new Error(`Contacten zoeken mislukt: ${error.message}`);
      for (const c of data) if (c.email && !contacts.has(c.email)) contacts.set(c.email, c);
    }

    // Our campaigns by Instantly id.
    const campaigns = new Map<string, string>();
    const campaignIds = [...new Set(events.map((e) => e.campaignId).filter((id): id is string => Boolean(id)))];
    for (const ids of chunk(campaignIds, 100)) {
      const { data, error } = await db.from("campaigns").select("id, external_id").in("external_id", ids);
      if (error) throw new Error(`Campagnes zoeken mislukt: ${error.message}`);
      for (const c of data) if (c.external_id) campaigns.set(c.external_id, c.id);
    }

    const counts = { activities: 0, unknown: 0, suppressedUnknown: 0 };
    await forEachSafe(ctx, events, (e: InstantlyEvent) => `${e.type} ${e.id}`, async (event) => {
      const contact = contacts.get(event.email);
      if (!contact) {
        counts.unknown += 1;
        if (event.type !== "unsubscribe") return;
        const { data: existing, error: findError } = await db.from("suppression").select("id").eq("email", event.email).limit(1);
        if (findError) throw findError;
        if (existing.length > 0) return;
        const { error } = await db.from("suppression").insert({
          email: event.email,
          reason: "afgemeld",
          scope: "alle_kanalen",
          notes: `Afgemeld via Instantly (${event.id}), geen bekend contact.`,
        });
        if (error) throw error;
        counts.suppressedUnknown += 1;
        ctx.countOut();
        return;
      }

      const outcome = activityOutcomeFor(event);
      const { data: inserted, error } = await db
        .from("activities")
        .upsert(
          {
            contact_id: contact.id,
            company_id: contact.company_id,
            channel: "mail",
            campaign_id: event.campaignId ? (campaigns.get(event.campaignId) ?? null) : null,
            date: event.timestamp,
            outcome,
            source: "instantly",
            external_id: `instantly:${event.type === "reply" ? `reply:${event.id}` : event.id}`,
            notes: event.subject ? `Onderwerp: ${event.subject.slice(0, 200)}` : null,
          },
          { onConflict: "external_id", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw error;
      if (inserted.length === 0) return; // Already synced.
      counts.activities += 1;
      ctx.countOut();

      if (event.type === "reply" && ["nieuw", "gekwalificeerd", "verrijkt", "op_bellijst", "in_mailcampagne"].includes(contact.status)) {
        await db.from("contacts").update({ status: "bereikt" }).eq("id", contact.id);
        contact.status = "bereikt";
      }
    });

    ctx.meta.activities = counts.activities;
    ctx.meta.unknown_emails = counts.unknown;
    ctx.meta.suppressed_unknown = counts.suppressedUnknown;
    ctx.log(`${counts.activities} activiteiten, ${counts.unknown} onbekende mailadressen, ${counts.suppressedUnknown} afmeldingen zonder contact uitgesloten.`);
  },
});
