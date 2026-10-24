"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { formValues, type ActionState } from "@/lib/action-state";
import { JOB_REQUIRED_PARAMS } from "@/lib/data/jobs";
import { chains, jobs } from "@/jobs/registry";
import { runByName } from "@/jobs/run";

const paramsSchema = z.object({
  vacancy: z.guid({ error: "Kies een vacature." }).optional(),
  limit: z.coerce
    .number({ error: "Vul een getal in." })
    .int("Vul een heel getal in.")
    .min(1, "Vul 1 of meer in.")
    .max(5000, "Gebruik maximaal 5000.")
    .optional(),
});

function firstLine(text: string | undefined) {
  return text?.split("\n")[0]?.trim() || "onbekende fout";
}

export async function runJobAction(name: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireStaff();
  if (!jobs[name] && !chains[name]) return { error: `Onbekende job: ${name}` };
  if (!process.env.SUPABASE_SECRET_KEY) {
    return { error: "SUPABASE_SECRET_KEY ontbreekt op de server. Jobs schrijven met de service role en kunnen nu niet draaien." };
  }

  const parsed = paramsSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Controleer de invoer." };

  const required = JOB_REQUIRED_PARAMS[name];
  if (required && !parsed.data[required.name as keyof typeof parsed.data]) {
    return { error: `Kies eerst: ${required.label.toLowerCase()}.` };
  }

  const params: Record<string, string> = {};
  if (parsed.data.vacancy) params.vacancy = parsed.data.vacancy;
  if (parsed.data.limit) params.limit = String(parsed.data.limit);

  try {
    const { results } = await runByName(name, { triggeredBy: `user:${user.id}`, params });
    revalidatePath("/dashboard/jobs");
    const failed = results.filter((r) => r.result.status === "failed");
    const summary = results
      .map((r) =>
        r.result.status === "success"
          ? `${r.job}: gelukt, ${r.result.recordsIn} in, ${r.result.recordsOut} uit`
          : `${r.job}: mislukt, ${firstLine(r.result.error)}`,
      )
      .join(". ");
    if (failed.length > 0) return { error: `${summary}.` };
    return { ok: true, message: `${summary}.` };
  } catch (error) {
    revalidatePath("/dashboard/jobs");
    return { error: error instanceof Error ? firstLine(error.message) : "De job kon niet starten." };
  }
}
