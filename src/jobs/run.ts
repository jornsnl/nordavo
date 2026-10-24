import "server-only";
import { runJob, type JobResult } from "@/lib/gtm/jobs";
import { chains, jobs } from "./registry";

/** Run one job or a chain by name. Shared by the CLI and the API route. */
export async function runByName(
  name: string,
  options: { params?: Record<string, string>; triggeredBy?: string } = {},
): Promise<{ name: string; results: { job: string; result: JobResult }[] }> {
  const chain = chains[name];
  const names = chain ? chain.jobs : [name];
  const results: { job: string; result: JobResult }[] = [];

  for (const jobName of names) {
    const job = jobs[jobName];
    if (!job) throw new Error(`Onbekende job: ${jobName}`);
    const result = await runJob(job, options);
    results.push({ job: jobName, result });
    if (result.status === "failed" && chain?.stopOnFailure) break;
  }
  return { name, results };
}
