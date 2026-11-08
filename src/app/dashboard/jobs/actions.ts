"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { formValues, type ActionState } from "@/lib/action-state";
import { JOB_REQUIRED_PARAMS } from "@/lib/data/jobs";
import { chains, jobs } from "@/jobs/registry";
import { runByName } from "@/jobs/run";
import { jobModule } from "@/lib/modules";

const paramsSchema = z.object({
  vacancy: z.guid({ error: "Choose a vacancy." }).optional(),
  limit: z.coerce
    .number({ error: "Enter a number." })
    .int("Enter a whole number.")
    .min(1, "Enter 1 or more.")
    .max(5000, "Use at most 5000.")
    .optional(),
});

function firstLine(text: string | undefined) {
  return text?.split("\n")[0]?.trim() || "unknown error";
}

export async function runJobAction(name: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireStaff();
  if (!jobs[name] && !chains[name]) return { error: `Unknown job: ${name}` };
  // Jobs write with the service role, so check the modules here (2.5).
  const allowed = (job: string) => {
    const module = jobModule(job);
    return module === null || user.modules.includes(module);
  };
  if (!(chains[name] ? chains[name].jobs : [name]).every(allowed)) {
    return { error: "This job belongs to a module you do not have. Ask an admin under Settings, Users." };
  }
  if (!process.env.SUPABASE_SECRET_KEY) {
    return { error: "SUPABASE_SECRET_KEY is missing on the server. Jobs write with the service role and cannot run right now." };
  }

  const parsed = paramsSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your input." };

  const required = JOB_REQUIRED_PARAMS[name];
  if (required && !parsed.data[required.name as keyof typeof parsed.data]) {
    return { error: `Choose this first: ${required.label.toLowerCase()}.` };
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
          ? `${r.job}: succeeded, ${r.result.recordsIn} in, ${r.result.recordsOut} out`
          : `${r.job}: failed, ${firstLine(r.result.error)}`,
      )
      .join(". ");
    if (failed.length > 0) return { error: `${summary}.` };
    return { ok: true, message: `${summary}.` };
  } catch (error) {
    revalidatePath("/dashboard/jobs");
    return { error: error instanceof Error ? firstLine(error.message) : "The job could not start." };
  }
}
