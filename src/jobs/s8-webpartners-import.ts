import type { Json, TablesInsert } from "@/lib/database.types";
import { defineJob, forEachSafe } from "@/lib/gtm/jobs";
import { splitName } from "@/lib/gtm/normalize";
import { upsertContact } from "@/lib/gtm/upsert";
import { matchWebPartnersRow, parseWebPartnersRows, type WebPartnersRow } from "@/lib/gtm/webpartners";
import { hasGoogleSheets, readSheet } from "@/lib/integrations/google-sheets";
import { amsterdamDate, promoteContactStatus } from "@/lib/integrations/onepage";

/**
 * S8: import the Web Partners appointments sheet into activities (daily).
 * Idempotent: one activity per sheet row (external_id is a hash of the row's
 * identity). When Nordavo later marks a row goedgekeurd or afgekeurd, the
 * same activity gets the new outcome instead of a second one.
 *
 * Params: --range=A1:Z (sheet range), --limit=500 (rows per run).
 */
export const s8WebpartnersImport = defineJob({
  name: "s8-webpartners-import",
  description: "S8: afsprakensheet van Web Partners importeren",
  run: async (ctx) => {
    const sheetId = process.env.WEBPARTNERS_APPOINTMENTS_SHEET_ID;
    if (!sheetId) throw new Error("WEBPARTNERS_APPOINTMENTS_SHEET_ID ontbreekt: geen afsprakensheet om te importeren.");
    if (!hasGoogleSheets()) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ontbreekt: kan de sheet van Web Partners niet lezen.");

    const range = ctx.params.range || "A1:Z";
    const limit = Number(ctx.params.limit) || 500;
    const sheet = await readSheet(sheetId, range);
    const { rows, missingHeaders } = parseWebPartnersRows(sheet);
    if (missingHeaders.length === 3) {
      throw new Error("Afsprakensheet niet herkend: geen kolom bedrijf, naam of telefoon gevonden in de eerste rij.");
    }
    if (missingHeaders.length > 0) ctx.log(`Kolommen niet gevonden: ${missingHeaders.join(", ")}`);

    const batch = rows.slice(0, limit);
    ctx.countIn(batch.length);
    ctx.log(`${rows.length} afspraken in de sheet, ${batch.length} in deze run.`);

    const today = amsterdamDate();
    let created = 0;
    let updated = 0;
    const unmatched: { rij: number; bedrijf: string | null; naam: string | null; telefoon: string | null }[] = [];

    await forEachSafe(ctx, batch, (row) => `rij ${row.rowNumber}`, async (row) => {
      const { data: existing, error: findError } = await ctx.db
        .from("activities")
        .select("id, outcome")
        .eq("external_id", row.externalId)
        .maybeSingle();
      if (findError) throw findError;
      if (existing) {
        if (existing.outcome !== row.outcome) {
          const { error } = await ctx.db
            .from("activities")
            .update({ outcome: row.outcome, notes: notesFor(row) })
            .eq("id", existing.id);
          if (error) throw error;
          updated += 1;
          ctx.countOut();
        }
        return;
      }

      const match = await matchWebPartnersRow(ctx.db, row);
      if (match.kind === "none") {
        unmatched.push({ rij: row.rowNumber, bedrijf: row.company, naam: row.name, telefoon: row.phone });
        return;
      }

      let contactId: string | null = match.kind === "contact" ? match.contactId : null;
      if (!contactId && row.name) {
        const { first, last } = splitName(row.name);
        contactId = (
          await upsertContact(
            ctx.db,
            { company_id: match.companyId, first_name: first, last_name: last, phone: row.phone, email: row.email },
            "webpartners",
          )
        ).id;
      }

      const activity: TablesInsert<"activities"> = {
        contact_id: contactId,
        company_id: match.companyId,
        channel: "bellen",
        outcome: row.outcome,
        notes: notesFor(row),
        // The sheet date is the appointment; a future date means the call was today.
        date: row.date && row.date < today ? `${row.date}T12:00:00Z` : new Date().toISOString(),
        next_action: row.outcome === "afspraak" && row.date && row.date >= today ? "Salesgesprek" : null,
        next_action_date: row.outcome === "afspraak" && row.date && row.date >= today ? row.date : null,
        source: "webpartners",
        external_id: row.externalId,
      };
      const { error } = await ctx.db.from("activities").upsert(activity, { onConflict: "external_id", ignoreDuplicates: true });
      if (error) throw error;
      if (contactId && row.outcome !== "afspraak_afgekeurd") await promoteContactStatus(ctx.db, contactId, "afspraak");
      created += 1;
      ctx.countOut();
    });

    ctx.meta.rows = rows.length;
    ctx.meta.created = created;
    ctx.meta.updated = updated;
    ctx.meta.unmatched_count = unmatched.length;
    ctx.meta.unmatched = unmatched.slice(0, 100) as unknown as Json;
    ctx.log(`${created} nieuw, ${updated} bijgewerkt, ${unmatched.length} niet gekoppeld.`);
  },
});

function notesFor(row: WebPartnersRow) {
  const parts = [row.reason ?? "Afspraak via Web Partners"];
  if (row.date) parts.push(`Afspraak op ${row.date}`);
  if (row.approval) parts.push(`Na de call ${row.approval}`);
  return parts.join(". ");
}
