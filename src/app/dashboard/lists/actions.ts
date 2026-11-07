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
    return { error: "Google Sheets is not set up. Download the call list as a CSV." };
  }
  const filter = parseListFilter(values);

  try {
    const supabase = await createClient();
    const result = await exportCallList(supabase, { filter, deliver: deliver.data, createdBy: user.id });
    revalidatePath("/dashboard/lists");
    if (result.count === 0) {
      return { error: "Nobody is on the call list with this filter. Nothing was exported." };
    }
    const dropped = result.dropped > 0 ? ` ${result.dropped} ${result.dropped === 1 ? "contact was" : "contacts were"} dropped in the final check.` : "";
    if (deliver.data === "sheet") {
      return {
        ok: true,
        message: `Call list with ${result.count} ${result.count === 1 ? "contact" : "contacts"} is ready in Google Sheets and shared with Web Partners.${dropped}`,
        url: result.destination ?? undefined,
        token: result.exportId ?? undefined,
      };
    }
    return {
      ok: true,
      message: `Call list with ${result.count} ${result.count === 1 ? "contact" : "contacts"} created. The download starts automatically.${dropped}`,
      csv: result.csv ?? undefined,
      filename: result.destination?.replace(/^csv:/, "") ?? "nordavo-call-list.csv",
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
    revalidatePath("/dashboard/lists");
    if (result.count === 0 || !result.csv) {
      return { error: "No contacts without a phone number match this filter. Nothing was exported." };
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

export async function pushMailCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireStaff();
  if (!hasInstantly()) return { error: "Instantly is not set up: INSTANTLY_API_KEY is missing." };
  const filter = parseListFilter(formValues(formData), 50);
  // Claude writes opening lines inside this request: keep a run small.
  filter.limit = Math.min(filter.limit, 200);

  try {
    const supabase = await createClient();
    const result = await pushMailCampaigns(supabase, { filter, createdBy: user.id });
    revalidatePath("/dashboard/lists");
    revalidatePath("/dashboard/campaigns");
    const pushed = result.campaigns.reduce((sum, c) => sum + c.pushed, 0);
    if (result.candidates === 0) return { error: "Nobody is on the mailing list with this filter." };
    if (pushed === 0) {
      return { error: "Nobody was added to Instantly. Check whether opening lines could be generated." };
    }
    const perCampaign = result.campaigns.map((c) => `${c.name}: ${c.pushed}`).join("; ");
    const skipped = result.campaigns.reduce((sum, c) => sum + c.skipped + c.failed, 0) + result.withoutSignal;
    return {
      ok: true,
      message: `${pushed} ${pushed === 1 ? "contact" : "contacts"} added to Instantly (${perCampaign}).${skipped > 0 ? ` ${skipped} skipped.` : ""}`,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function importMaxAction(_prev: MaxImportState, formData: FormData): Promise<MaxImportState> {
  await requireStaff();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the CSV file from Max.", fieldErrors: { file: "Choose a file." } };
  if (file.size > MAX_FILE_BYTES) return { error: "The file is larger than 5 MB.", fieldErrors: { file: "At most 5 MB." } };
  if (!/\.csv$/i.test(file.name) && !file.type.includes("csv") && !file.type.startsWith("text/")) {
    return { error: "Upload a CSV file.", fieldErrors: { file: "CSV only." } };
  }

  try {
    const supabase = await createClient();
    const result = await importMaxCsv(supabase, await file.text());
    revalidatePath("/dashboard/lists");
    return {
      ok: true,
      message: `${result.updated} phone ${result.updated === 1 ? "number" : "numbers"} saved. ${result.matched} of ${result.rows} rows matched, ${result.unmatched} not found.`,
      result,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
