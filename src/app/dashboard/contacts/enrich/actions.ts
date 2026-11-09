"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_ERROR, type ActionState } from "@/lib/action-state";
import { requireModule } from "@/lib/auth";
import { exportEnrichList, importMaxCsv, type MaxImportResult } from "@/lib/gtm/max";
import { createClient } from "@/lib/supabase/server";

export type ExportActionState = ActionState & {
  csv?: string;
  filename?: string;
  /** Changes on every successful export, so the client downloads each file once. */
  token?: string;
};

export type MaxImportState = ActionState & { result?: MaxImportResult; readyCompanies?: number };

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return GENERIC_ERROR;
}

/** The CSV for Max of every contact in Enrich (and of companies in Enrich). */
export async function exportEnrichAction(): Promise<ExportActionState> {
  const user = await requireModule("sales");
  try {
    const supabase = await createClient();
    const result = await exportEnrichList(supabase, { createdBy: user.id });
    revalidatePath("/dashboard/contacts/enrich");
    if (result.count === 0 || !result.csv) {
      return { error: "Nobody in Enrich has a LinkedIn URL and no phone number. Nothing was exported." };
    }
    return {
      ok: true,
      message: `CSV for Max with ${result.count} ${result.count === 1 ? "contact" : "contacts"} created. The download starts automatically.`,
      csv: result.csv,
      filename: result.filename,
      token: result.exportId ?? undefined,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Max's CSV back: numbers are saved on contacts without one and those
 * contacts go to Enriched. A company in Enrich that now has a number goes
 * back to Ready (through sales_update, so it is in the activity log).
 */
export async function importEnrichAction(_prev: MaxImportState, formData: FormData): Promise<MaxImportState> {
  await requireModule("sales");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the CSV file from Max.", fieldErrors: { file: "Choose a file." } };
  if (file.size > MAX_FILE_BYTES) return { error: "The file is larger than 5 MB.", fieldErrors: { file: "At most 5 MB." } };
  if (!/\.csv$/i.test(file.name) && !file.type.includes("csv") && !file.type.startsWith("text/")) {
    return { error: "Upload a CSV file.", fieldErrors: { file: "CSV only." } };
  }

  try {
    const supabase = await createClient();
    const result = await importMaxCsv(supabase, await file.text());
    let readyCompanies = 0;
    if (result.companyIds.length > 0) {
      const { data: inEnrich } = await supabase
        .from("companies")
        .select("id")
        .in("id", result.companyIds)
        .eq("lead_status", "enrich");
      const ids = (inEnrich ?? []).map((c) => c.id);
      if (ids.length > 0) {
        const { data, error } = await supabase.rpc("sales_update", {
          p_entity: "company",
          p_ids: ids,
          p_fields: { lead_status: "ready" },
          p_source: "import",
        });
        if (error) throw new Error(error.message);
        readyCompanies = data ?? 0;
      }
    }
    revalidatePath("/dashboard/contacts/enrich");
    revalidatePath("/dashboard/contacts");
    return {
      ok: true,
      message: `${result.updated} phone ${result.updated === 1 ? "number" : "numbers"} saved. ${result.matched} of ${result.rows} rows matched, ${result.unmatched} not found.${
        readyCompanies > 0 ? ` ${readyCompanies} ${readyCompanies === 1 ? "company is" : "companies are"} Ready again.` : ""
      }`,
      result,
      readyCompanies,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
