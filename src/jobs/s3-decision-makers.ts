import { defineJob, forEachSafe, type JobContext } from "@/lib/gtm/jobs";
import { ALL_DECISION_MAKER_TITLES, pickDecisionMakers } from "@/lib/gtm/signals";
import { upsertCompany, upsertContact } from "@/lib/gtm/upsert";
import {
  buildPeopleSearchInput,
  hasApify,
  mapPerson,
  requireActor,
  runActorSync,
} from "@/lib/integrations/apify";

/**
 * S3: two decision makers per GO company (briefing section 3, tiers 1 to 3)
 * via the Apify people actor, by company domain and/or LinkedIn page.
 *
 * A company that was searched before gets "apify_people" in companies.sources
 * and is skipped next time, so companies where the actor finds nobody do not
 * cost a run every week. --retry=true searches them again.
 *
 * Params: --limit (companies per run, default 50), --retry.
 */

const TARGET_CONTACTS = 2;
const SOURCE = "apify_people";

function intParam(ctx: JobContext, name: string, fallback: number, max: number) {
  const value = Number.parseInt(ctx.params[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

export const s3DecisionMakers = defineJob({
  name: "s3-decision-makers",
  description: "S3: twee beslissers per GO-bedrijf zoeken via Apify",
  run: async (ctx) => {
    if (!hasApify()) throw new Error("APIFY_TOKEN ontbreekt. Zet deze in de omgevingsvariabelen.");
    const actor = requireActor("APIFY_PEOPLE_ACTOR");
    const limit = intParam(ctx, "limit", 50, 500);
    const retry = ctx.params.retry === "true";

    let query = ctx.db
      .from("companies")
      .select("id, name, domain, linkedin_url, sources, contacts(linkedin_url)")
      .eq("icp_decision", "GO")
      .order("qualified_at", { ascending: false, nullsFirst: false })
      .limit(limit * 5);
    if (!retry) query = query.not("sources", "cs", `{${SOURCE}}`);
    const { data, error } = await query;
    if (error) throw error;

    const companies = data
      .map((company) => ({ ...company, contactLinkedin: (company.contacts ?? []).map((c) => c.linkedin_url) }))
      .filter((company) => company.contactLinkedin.length < TARGET_CONTACTS)
      .slice(0, limit);
    ctx.countIn(companies.length);
    ctx.log(`${companies.length} GO-bedrijven met minder dan ${TARGET_CONTACTS} contacten`);

    let created = 0;
    let noneFound = 0;

    await forEachSafe(ctx, companies, (company) => company.domain, async (company) => {
      const needed = TARGET_CONTACTS - company.contactLinkedin.length;
      const items = await runActorSync(
        actor,
        buildPeopleSearchInput({
          domain: company.domain,
          companyLinkedinUrl: company.linkedin_url,
          titles: ALL_DECISION_MAKER_TITLES,
          limit: 25,
        }),
        { maxItems: 25, timeoutSecs: 120 },
      );
      const picked = pickDecisionMakers(items.map((item) => mapPerson(item)), {
        count: needed,
        domain: company.domain,
        existingLinkedin: company.contactLinkedin,
      });
      if (picked.length === 0) noneFound += 1;

      for (const person of picked) {
        const contact = await upsertContact(
          ctx.db,
          {
            company_id: company.id,
            first_name: person.firstName,
            last_name: person.lastName,
            title: person.title,
            tier: person.tier,
            linkedin_url: person.linkedinUrl,
          },
          SOURCE,
        );
        // Only move new contacts forward; never pull an existing contact back.
        const { error: statusError } = await ctx.db
          .from("contacts")
          .update({ status: "gekwalificeerd" })
          .eq("id", contact.id)
          .eq("status", "nieuw");
        if (statusError) throw statusError;
        if (contact.created) created += 1;
        ctx.countOut();
      }

      // Mark the company as searched (sources), through the upsert helper.
      await upsertCompany(ctx.db, { domain: company.domain }, SOURCE);
    });

    Object.assign(ctx.meta, { contacts_created: created, companies_without_match: noneFound });
    ctx.log(`${created} nieuwe beslissers, ${noneFound} bedrijven zonder passende beslisser`);
  },
});
