"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { importLeadRows, type LeadImportMapping, type LeadImportResult } from "@/lib/gtm/import";
import { createClient } from "@/lib/supabase/server";

// Matches the chunk size in the import wizard.
const IMPORT_CHUNK_SIZE = 500;

const column = z.string().min(1).max(200).optional();

const mappingSchema = z.object({
  domain: z.string({ error: "Kies de kolom met het domein." }).min(1, "Kies de kolom met het domein.").max(200),
  company_name: column,
  legal_form: column,
  employees: column,
  sector: column,
  city: column,
  company_linkedin: column,
  full_name: column,
  first_name: column,
  last_name: column,
  title: column,
  person_linkedin: column,
  email: column,
  phone: column,
  last_contacted_at: column,
  contact_channel: column,
  contact_outcome: column,
}) satisfies z.ZodType<LeadImportMapping>;

const inputSchema = z.object({
  rows: z
    .array(z.record(z.string().max(200), z.string().max(5000)))
    .min(1, "Geen rijen om te importeren.")
    .max(IMPORT_CHUNK_SIZE, `Stuur maximaal ${IMPORT_CHUNK_SIZE} rijen per keer.`),
  mapping: mappingSchema,
  source: z.string().trim().min(1, "Geef de bron een naam.").max(200, "Gebruik maximaal 200 tekens."),
  /** Number of data rows in the file before this chunk. */
  offset: z.number().int().min(0),
});

export type ImportChunkInput = z.input<typeof inputSchema>;

export type ImportChunkResult = { ok: true; result: LeadImportResult } | { ok: false; error: string };

/**
 * Import one chunk of CSV rows with the user's client: staff RLS allows the
 * writes. Skipped row numbers are shifted by the chunk offset so they match
 * the rows in the whole file.
 */
export async function importChunkAction(input: ImportChunkInput): Promise<ImportChunkResult> {
  await requireStaff();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "De import is niet geldig." };
  }
  const { rows, mapping, source, offset } = parsed.data;

  try {
    const supabase = await createClient();
    const result = await importLeadRows(supabase, rows, mapping, source);
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/contacten");
    return {
      ok: true,
      result: { ...result, skipped: result.skipped.map((s) => ({ ...s, row: s.row + offset })) },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : "Er ging iets mis bij het importeren.",
    };
  }
}
