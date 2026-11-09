import "server-only";
import type { Job } from "@/lib/gtm/jobs";
import { s1Signals } from "./s1-signals";
import { s2Qualify } from "./s2-qualify";
import { s3DecisionMakers } from "./s3-decision-makers";
import { s4EmailEnrich } from "./s4-email-enrich";
import { s8InstantlySync } from "./s8-instantly-sync";
import { s8WebpartnersImport } from "./s8-webpartners-import";
import { s10WeeklyReport } from "./s10-weekly-report";
import { screeningScore } from "./screening-score";
import { t2Match } from "./t2-match";
import { interviewReminders } from "./interview-reminders";
import { clickupImport, workDaily, workNotify } from "./work";
import { formsReminders } from "./forms-reminders";
import { academyAtsSync, academyReminders, academyRetention } from "./academy-ats";

/**
 * Every job, by name. Run with `npm run job -- <name>` or POST /api/jobs/<name>.
 * The S1 to S4 and S8 jobs are fallbacks for Claude's tasks (fallbackJobs).
 * S6 (call list to a Web Partners sheet) and S7 (mail campaigns in Instantly)
 * are gone: call lists are saved views worked on the call screen, sequences
 * replace the campaigns, and Claude prepares the mail and LinkedIn steps in
 * Instantly and Seleqt (docs/claude-jobs.md).
 */
export const jobs: Record<string, Job> = Object.fromEntries(
  [
  s1Signals,
  s2Qualify,
  s3DecisionMakers,
  s4EmailEnrich,
  s8InstantlySync,
  s8WebpartnersImport,
  s10WeeklyReport,
  t2Match,
  interviewReminders,
  screeningScore,
  workNotify,
  workDaily,
  clickupImport,
  formsReminders,
  academyAtsSync,
  academyReminders,
  academyRetention,
  ].map((job) => [job.name, job]),
);

/**
 * Portal jobs that Claude's scheduled tasks replaced (section 2.14: the
 * portal has no external links of its own, Claude is the engine). They are
 * on no schedule any more and only run by hand, from Jobs or with
 * `npm run job`, as a fallback when a Claude task cannot run. The API
 * route refuses them from a scheduler (CRON_SECRET).
 */
export const fallbackJobs: Record<string, { claudeTask: string; task: string }> = {
  "s1-signals": { claudeTask: "claude-companies", task: "New companies and vacancies from Apify and Prospeo" },
  "s2-qualify": { claudeTask: "claude-icp", task: "ICP verdict, prio and opening line" },
  "s3-decision-makers": { claudeTask: "claude-companies", task: "New companies and vacancies from Apify and Prospeo" },
  "s4-email-enrich": { claudeTask: "claude-companies", task: "New companies and vacancies from Apify and Prospeo" },
  "s8-instantly-sync": { claudeTask: "claude-replies", task: "Replies from Instantly and Seleqt" },
  "s8-webpartners-import": { claudeTask: "claude-calcom", task: "Cal.com bookings to Meetings" },
};

export type Chain = {
  description: string;
  jobs: string[];
  stopOnFailure: boolean;
  /** False for a chain of fallback jobs: by hand only, never on a schedule. */
  scheduled: boolean;
};

/**
 * Chains run in order. A chain stops at the first failed job, because the
 * next step depends on its output. Only scheduled chains are in the
 * GitHub Actions schedule (.github/workflows/gtm-jobs.yml).
 */
export const chains: Record<string, Chain> = {
  maandag: {
    description:
      "Fallback for the Claude tasks claude-companies and claude-icp: signals, qualification, decision makers and e-mail addresses (S1 to S4). By hand only.",
    jobs: ["s1-signals", "s2-qualify", "s3-decision-makers", "s4-email-enrich"],
    stopOnFailure: true,
    scheduled: false,
  },
  dagelijks: {
    description:
      "Fallback for the Claude tasks claude-replies and claude-calcom: outcomes back from Instantly and Web Partners (S8). By hand only.",
    jobs: ["s8-instantly-sync", "s8-webpartners-import"],
    stopOnFailure: false,
    scheduled: false,
  },
  vrijdag: {
    description: "Friday 16:00: weekly report (S10)",
    jobs: ["s10-weekly-report"],
    stopOnFailure: false,
    scheduled: true,
  },
};

/** Whether a job or chain is a fallback that only runs by hand. */
export function isFallback(name: string): boolean {
  if (fallbackJobs[name]) return true;
  const chain = chains[name];
  return Boolean(chain && !chain.scheduled);
}
