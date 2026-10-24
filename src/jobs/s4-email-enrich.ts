import { defineJob, forEachSafe, type JobContext } from "@/lib/gtm/jobs";
import { upsertContact } from "@/lib/gtm/upsert";
import { findEmail, hasProspeo, verifyEmail } from "@/lib/integrations/prospeo";

/**
 * S4: find and verify email addresses with Prospeo for contacts without an
 * email at GO companies. The email is saved through upsertContact (source
 * "prospeo" and the date are kept, rule 3); a valid address moves the contact
 * to verrijkt.
 *
 * A contact Prospeo has seen gets "prospeo" in contacts.sources and is not
 * searched again; --retry=true searches them again.
 *
 * Params: --limit (contacts per run, default 100), --retry, --delay (ms
 * between calls, default 1200).
 */

const SOURCE = "prospeo";

function intParam(ctx: JobContext, name: string, fallback: number, max: number) {
  const value = Number.parseInt(ctx.params[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const s4EmailEnrich = defineJob({
  name: "s4-email-enrich",
  description: "S4: mailadressen zoeken en verifiëren via Prospeo",
  run: async (ctx) => {
    if (!hasProspeo()) throw new Error("PROSPEO_API_KEY ontbreekt. Zet deze in de omgevingsvariabelen.");
    const limit = intParam(ctx, "limit", 100, 1000);
    const delay = intParam(ctx, "delay", 1200, 60_000);
    const retry = ctx.params.retry === "true";

    let query = ctx.db
      .from("contacts")
      .select("id, company_id, first_name, last_name, linkedin_url, status, sources, company:companies!inner(domain, icp_decision)")
      .is("email", null)
      .eq("company.icp_decision", "GO")
      .not("status", "in", "(uitgesloten,verloren,klant)")
      .order("tier", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (!retry) query = query.not("sources", "cs", `{${SOURCE}}`);
    const { data: contacts, error } = await query;
    if (error) throw error;
    ctx.countIn(contacts.length);
    ctx.log(`${contacts.length} contacten zonder mailadres bij GO-bedrijven`);

    const counts = { valid: 0, catch_all: 0, invalid: 0, unknown: 0, not_found: 0, skipped: 0 };
    let first = true;

    await forEachSafe(ctx, contacts, (contact) => `${contact.first_name ?? ""} ${contact.last_name ?? ""} (${contact.company.domain})`, async (contact) => {
      const hasNames = Boolean(contact.first_name && contact.last_name);
      if (!contact.linkedin_url && !hasNames) {
        // upsertContact could not find this contact back without LinkedIn or a full name.
        counts.skipped += 1;
        return;
      }
      if (!first) await sleep(delay);
      first = false;

      const identity = {
        company_id: contact.company_id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        linkedin_url: contact.linkedin_url,
      };

      const found = await findEmail({
        firstName: contact.first_name,
        lastName: contact.last_name,
        companyDomain: contact.company.domain,
        linkedinUrl: contact.linkedin_url,
      });

      if (!found) {
        counts.not_found += 1;
        // Records that Prospeo has seen this contact (sources), nothing else changes.
        await upsertContact(ctx.db, identity, SOURCE);
        return;
      }

      let status = found.status;
      if (status === "unknown") {
        await sleep(delay);
        status = await verifyEmail(found.email);
      }

      let savedId = contact.id;
      if (contact.linkedin_url) {
        const saved = await upsertContact(ctx.db, { ...identity, email: found.email, email_status: status }, SOURCE);
        if (saved.id !== contact.id) ctx.log(`Let op: mailadres van ${contact.id} kwam bij contact ${saved.id} terecht`);
        savedId = saved.id;
      } else {
        // Without a LinkedIn URL, upsertContact looks a person up by email and
        // would create a second record. Fill the gap on this contact instead,
        // with the same source and date fields upsertContact writes (rule 3).
        const sources = contact.sources.includes(SOURCE) ? contact.sources : [...contact.sources, SOURCE];
        const { error: updateError } = await ctx.db
          .from("contacts")
          .update({
            email: found.email,
            email_source: SOURCE,
            email_found_at: new Date().toISOString(),
            email_status: status,
            sources,
          })
          .eq("id", contact.id)
          .is("email", null);
        if (updateError) throw updateError;
      }
      counts[status] += 1;
      ctx.countOut();

      if (status === "valid") {
        const { error: statusError } = await ctx.db
          .from("contacts")
          .update({ status: "verrijkt" })
          .eq("id", savedId)
          .in("status", ["nieuw", "gekwalificeerd"]);
        if (statusError) throw statusError;
      }
    });

    Object.assign(ctx.meta, counts);
    ctx.log(
      `Gevonden: ${counts.valid} geldig, ${counts.catch_all} catch-all, ${counts.invalid} ongeldig, ${counts.unknown} onbekend; ` +
        `${counts.not_found} niet gevonden, ${counts.skipped} overgeslagen`,
    );
  },
});
