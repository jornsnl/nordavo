"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { formValues, GENERIC_ERROR, type ActionState } from "@/lib/action-state";
import { exportCallList, parseListFilter, pushMailCampaigns } from "@/lib/gtm/lists";
import { exportMaxList, importMaxCsv, type MaxImportResult } from "@/lib/gtm/max";
import { hasGoogleSheets } from "@/lib/integrations/google-sheets";
import { hasInstantly } from "@/lib/integrations/instantly";
import { createClient } from "@/lib/supabase/server";

export type ExportActionState = ActionState & {
  csv?: string;
  filename?: string;
  url?: string;
  /** Changes on every successful export, so the client downloads each file once. */
  token?: string;
};

export type MaxImportState = ActionState & { result?: MaxImportResult };

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return GENERIC_ERROR;
}

const deliverSchema = z.enum(["sheet", "csv"]);

export async function exportCallListAction(_prev: ExportActionState, formData: FormData): Promise<ExportActionState> {
  const user = await requireStaff();
  const values = formValues(formData);
  const deliver = deliverSchema.safeParse(values.deliver);
  if (!deliver.success) return { error: GENERIC_ERROR };
  if (deliver.data === "sheet" && !hasGoogleSheets()) {
    return { error: "Google Sheets is niet ingesteld. Download de bellijst als CSV." };
  }
  const filter = parseListFilter(values);

  try {
    const supabase = await createClient();
    const result = await exportCallList(supabase, { filter, deliver: deliver.data, createdBy: user.id });
    revalidatePath("/dashboard/lijsten");
    if (result.count === 0) {
      return { error: "Er staat niemand op de bellijst met dit filter. Er is niets geëxporteerd." };
    }
    const dropped = result.dropped > 0 ? ` ${result.dropped} contacten vielen af bij de laatste controle.` : "";
    if (deliver.data === "sheet") {
      return {
        ok: true,
        message: `Bellijst met ${result.count} contacten staat klaar in Google Sheets en is gedeeld met Web Partners.${dropped}`,
        url: result.destination ?? undefined,
        token: result.exportId ?? undefined,
      };
    }
    return {
      ok: true,
      message: `Bellijst met ${result.count} contacten is gemaakt. De download start vanzelf.${dropped}`,
      csv: result.csv ?? undefined,
      filename: result.destination?.replace(/^csv:/, "") ?? "nordavo-bellijst.csv",
      token: result.exportId ?? undefined,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function exportMaxAction(_prev: ExportActionState, formData: FormData): Promise<ExportActionState> {
  const user = await requireStaff();
  const filter = parseListFilter(formValues(formData));
  try {
    const supabase = await createClient();
    const result = await exportMaxList(supabase, { filter, createdBy: user.id });
    revalidatePath("/dashboard/lijsten");
    if (result.count === 0 || !result.csv) {
      return { error: "Geen contacten zonder telefoonnummer met dit filter. Er is niets geëxporteerd." };
    }
    return {
      ok: true,
      message: `CSV voor Max met ${result.count} contacten is gemaakt. De download start vanzelf.`,
      csv: result.csv,
      filename: result.filename,
      token: result.exportId ?? undefined,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function pushMailCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireStaff();
  if (!hasInstantly()) return { error: "Instantly is niet ingesteld: INSTANTLY_API_KEY ontbreekt." };
  const filter = parseListFilter(formValues(formData), 50);
  // Claude writes opening lines inside this request: keep a run small.
  filter.limit = Math.min(filter.limit, 200);

  try {
    const supabase = await createClient();
    const result = await pushMailCampaigns(supabase, { filter, createdBy: user.id });
    revalidatePath("/dashboard/lijsten");
    revalidatePath("/dashboard/campagnes");
    const pushed = result.campaigns.reduce((sum, c) => sum + c.pushed, 0);
    if (result.candidates === 0) return { error: "Er staat niemand op de maillijst met dit filter." };
    if (pushed === 0) {
      return { error: "Er is niemand toegevoegd aan Instantly. Bekijk of er openingszinnen gemaakt konden worden." };
    }
    const perCampaign = result.campaigns.map((c) => `${c.name}: ${c.pushed}`).join("; ");
    const skipped = result.campaigns.reduce((sum, c) => sum + c.skipped + c.failed, 0) + result.withoutSignal;
    return {
      ok: true,
      message: `${pushed} contacten toegevoegd aan Instantly (${perCampaign}).${skipped > 0 ? ` ${skipped} overgeslagen.` : ""}`,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function importMaxAction(_prev: MaxImportState, formData: FormData): Promise<MaxImportState> {
  await requireStaff();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Kies het CSV bestand van Max.", fieldErrors: { file: "Kies een bestand." } };
  if (file.size > MAX_FILE_BYTES) return { error: "Het bestand is groter dan 5 MB.", fieldErrors: { file: "Maximaal 5 MB." } };
  if (!/\.csv$/i.test(file.name) && !file.type.includes("csv") && !file.type.startsWith("text/")) {
    return { error: "Upload een CSV bestand.", fieldErrors: { file: "Alleen CSV." } };
  }

  try {
    const supabase = await createClient();
    const result = await importMaxCsv(supabase, await file.text());
    revalidatePath("/dashboard/lijsten");
    return {
      ok: true,
      message: `${result.updated} telefoonnummers opgeslagen. ${result.matched} van ${result.rows} regels gekoppeld, ${result.unmatched} niet gevonden.`,
      result,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
