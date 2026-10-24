import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeHtml, sendMail } from "@/lib/notify/mail";

/**
 * Every scheduled or manual job runs through runJob (hard rule 7): it gets a
 * row in job_runs with counts and errors, and Julius gets a mail on failure.
 * Jobs write with the service role, so they bypass RLS by design.
 */

export type JobDb = SupabaseClient<Database>;

export type JobContext = {
  db: JobDb;
  /** Free-form parameters from the CLI (--key=value) or the API route body. */
  params: Record<string, string>;
  triggeredBy: string;
  log: (message: string) => void;
  /** Count records read (in) and written (out) for job_runs. */
  countIn: (n?: number) => void;
  countOut: (n?: number) => void;
  /** Extra details stored in job_runs.meta. */
  meta: Record<string, Json>;
};

export type Job = {
  name: string;
  description: string;
  run: (ctx: JobContext) => Promise<void>;
};

export function defineJob(job: Job): Job {
  return job;
}

export type JobResult = {
  runId: string | null;
  status: "success" | "failed";
  recordsIn: number;
  recordsOut: number;
  error?: string;
  logs: string[];
};

export function requireJobDb(): JobDb {
  const db = createAdminClient();
  if (!db) throw new Error("SUPABASE_SECRET_KEY ontbreekt: jobs schrijven met de service role.");
  return db;
}

export async function runJob(
  job: Job,
  { params = {}, triggeredBy = "schedule", db = requireJobDb() }: { params?: Record<string, string>; triggeredBy?: string; db?: JobDb } = {},
): Promise<JobResult> {
  const logs: string[] = [];
  let recordsIn = 0;
  let recordsOut = 0;
  const meta: Record<string, Json> = {};

  const { data: run } = await db
    .from("job_runs")
    .insert({ job_name: job.name, triggered_by: triggeredBy, meta: { params } })
    .select("id")
    .single();
  const runId = run?.id ?? null;

  const ctx: JobContext = {
    db,
    params,
    triggeredBy,
    meta,
    log: (message) => {
      const line = `[${job.name}] ${message}`;
      logs.push(line);
      console.log(line);
    },
    countIn: (n = 1) => {
      recordsIn += n;
    },
    countOut: (n = 1) => {
      recordsOut += n;
    },
  };

  try {
    await job.run(ctx);
    if (runId) {
      await db
        .from("job_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          records_in: recordsIn,
          records_out: recordsOut,
          meta: { params, ...meta, log: logs.slice(-50) },
        })
        .eq("id", runId);
    }
    return { runId, status: "success", recordsIn, recordsOut, logs };
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    console.error(`[${job.name}] mislukt:`, error);
    if (runId) {
      await db
        .from("job_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          records_in: recordsIn,
          records_out: recordsOut,
          error: message.slice(0, 4000),
          meta: { params, ...meta, log: logs.slice(-50) },
        })
        .eq("id", runId);
    }
    await sendMail({
      subject: `Nordavo job mislukt: ${job.name}`,
      html: `<p>De job <strong>${escapeHtml(job.name)}</strong> is mislukt.</p>
<pre style="white-space:pre-wrap">${escapeHtml(message.slice(0, 4000))}</pre>
<p>Verwerkt: ${recordsIn} in, ${recordsOut} uit. Bekijk de details onder Beheer, Jobs.</p>`,
    }).catch(() => false);
    return { runId, status: "failed", recordsIn, recordsOut, error: message, logs };
  }
}

/** Process items one by one so one bad record never stops the whole job. */
export async function forEachSafe<T>(
  ctx: JobContext,
  items: T[],
  label: (item: T) => string,
  fn: (item: T) => Promise<void>,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await fn(item);
      ok += 1;
    } catch (error) {
      failed += 1;
      ctx.log(`Fout bij ${label(item)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed > 0) ctx.meta.failed_items = failed;
  return { ok, failed };
}
