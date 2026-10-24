import "server-only";
import { requireStaff } from "@/lib/auth";
import type { JobStatus } from "@/lib/database.types";
import { jobStatuses } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

/**
 * Environment variables each job needs (names from .env.example). Only the
 * names are ever sent to the page, never the values.
 */
const JOB_ENV: Record<string, { required: string[]; optional?: string[] }> = {
  "s1-signals": { required: ["APIFY_TOKEN", "APIFY_LINKEDIN_JOBS_ACTOR", "APIFY_INDEED_JOBS_ACTOR"] },
  "s2-qualify": { required: ["ANTHROPIC_API_KEY"] },
  "s3-decision-makers": { required: ["APIFY_TOKEN", "APIFY_PEOPLE_ACTOR"] },
  "s4-email-enrich": { required: ["PROSPEO_API_KEY"] },
  "s6-call-list": { required: ["GOOGLE_SERVICE_ACCOUNT_JSON"], optional: ["WEBPARTNERS_SHARE_WITH"] },
  "s7-mail-campaign": { required: ["INSTANTLY_API_KEY", "ANTHROPIC_API_KEY"] },
  "s8-instantly-sync": { required: ["INSTANTLY_API_KEY"] },
  "s8-webpartners-import": { required: ["GOOGLE_SERVICE_ACCOUNT_JSON", "WEBPARTNERS_APPOINTMENTS_SHEET_ID"] },
  "s9-onepage-push": { required: ["ONEPAGE_USER_ID", "ONEPAGE_API_KEY"] },
  "s9-onepage-pull": { required: ["ONEPAGE_USER_ID", "ONEPAGE_API_KEY"] },
  "s10-weekly-report": { required: ["RESEND_API_KEY", "REPORT_EMAIL_TO"] },
  "t2-match": {
    required: ["AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "AIRTABLE_CANDIDATES_TABLE", "ANTHROPIC_API_KEY"],
  },
};

/** Jobs that cannot run without a parameter. */
export const JOB_REQUIRED_PARAMS: Record<string, { name: string; label: string }> = {
  "t2-match": { name: "vacancy", label: "Vacature" },
};

function isSet(name: string) {
  return Boolean(process.env[name]?.trim());
}

export function missingEnvFor(jobName: string): { required: string[]; optional: string[] } {
  const env = JOB_ENV[jobName];
  if (!env) return { required: [], optional: [] };
  return {
    required: env.required.filter((n) => !isSet(n)),
    optional: (env.optional ?? []).filter((n) => !isSet(n)),
  };
}

export function hasJobDb() {
  return isSet("SUPABASE_SECRET_KEY");
}

/** Failure mails and the weekly report go through Resend. */
export function hasMail() {
  return isSet("RESEND_API_KEY");
}

export function isJobStatus(value: unknown): value is JobStatus {
  return jobStatuses.some((s) => s.value === value);
}

export type JobRunItem = {
  id: string;
  jobName: string;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  recordsIn: number;
  recordsOut: number;
  errorFirstLine: string | null;
  error: string | null;
  triggeredBy: string;
  log: string[];
};

function logFrom(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const log = (meta as Record<string, unknown>).log;
  return Array.isArray(log) ? log.filter((l): l is string => typeof l === "string") : [];
}

const RUN_COLUMNS =
  "id, job_name, status, started_at, finished_at, records_in, records_out, error, meta, triggered_by" as const;

function toRun(r: {
  id: string;
  job_name: string;
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  records_in: number;
  records_out: number;
  error: string | null;
  meta: unknown;
  triggered_by: string;
}): JobRunItem {
  return {
    id: r.id,
    jobName: r.job_name,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.finished_at ? new Date(r.finished_at).getTime() - new Date(r.started_at).getTime() : null,
    recordsIn: r.records_in,
    recordsOut: r.records_out,
    errorFirstLine: r.error?.split("\n")[0]?.trim() || null,
    error: r.error,
    triggeredBy: r.triggered_by,
    log: logFrom(r.meta),
  };
}

export async function listJobRuns({
  jobName,
  status,
  limit = 50,
}: {
  jobName?: string;
  status?: JobStatus;
  limit?: number;
}): Promise<JobRunItem[]> {
  await requireStaff();
  const supabase = await createClient();
  let query = supabase
    .from("job_runs")
    .select(RUN_COLUMNS)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (jobName) query = query.eq("job_name", jobName);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(`Jobhistorie laden mislukt: ${error.message}`);
  return data.map(toRun);
}

/** The latest run per job name. */
export async function getLastRuns(jobNames: string[]): Promise<Record<string, JobRunItem | undefined>> {
  await requireStaff();
  const supabase = await createClient();
  const results = await Promise.all(
    jobNames.map(async (name) => {
      const { data, error } = await supabase
        .from("job_runs")
        .select(RUN_COLUMNS)
        .eq("job_name", name)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Jobstatus laden mislukt: ${error.message}`);
      return [name, data] as const;
    }),
  );
  const out: Record<string, JobRunItem | undefined> = {};
  for (const [name, r] of results) {
    out[name] = r ? toRun(r) : undefined;
  }
  return out;
}

/** Open vacancies as options for t2-match. */
export async function listVacancyOptions(): Promise<{ id: string; label: string }[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancies")
    .select("id, title, client:clients(name), company:companies(name)")
    .in("status", ["open", "on_hold"])
    .order("opened_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Vacatures laden mislukt: ${error.message}`);
  return data.map((v) => ({
    id: v.id,
    label: [v.title, v.client?.name ?? v.company?.name].filter(Boolean).join(", "),
  }));
}
