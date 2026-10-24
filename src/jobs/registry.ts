import "server-only";
import type { Job } from "@/lib/gtm/jobs";
import { s1Signals } from "./s1-signals";
import { s2Qualify } from "./s2-qualify";
import { s3DecisionMakers } from "./s3-decision-makers";
import { s4EmailEnrich } from "./s4-email-enrich";
import { s6CallList } from "./s6-call-list";
import { s7MailCampaign } from "./s7-mail-campaign";
import { s8InstantlySync } from "./s8-instantly-sync";
import { s8WebpartnersImport } from "./s8-webpartners-import";
import { s9OnepagePush } from "./s9-onepage-push";
import { s9OnepagePull } from "./s9-onepage-pull";
import { s10WeeklyReport } from "./s10-weekly-report";
import { t2Match } from "./t2-match";

/** Every job, by name. Run with `npm run job -- <name>` or POST /api/jobs/<name>. */
export const jobs: Record<string, Job> = Object.fromEntries(
  [
  s1Signals,
  s2Qualify,
  s3DecisionMakers,
  s4EmailEnrich,
  s6CallList,
  s7MailCampaign,
  s8InstantlySync,
  s8WebpartnersImport,
  s9OnepagePush,
  s9OnepagePull,
  s10WeeklyReport,
  t2Match,
  ].map((job) => [job.name, job]),
);

/**
 * Chains run in order on a schedule. A chain stops at the first failed job,
 * because the next step depends on its output.
 */
export const chains: Record<string, { description: string; jobs: string[]; stopOnFailure: boolean }> = {
  maandag: {
    description: "Maandag 06:00: signalen, kwalificatie, beslissers en mailadressen (S1 tot en met S4)",
    jobs: ["s1-signals", "s2-qualify", "s3-decision-makers", "s4-email-enrich"],
    stopOnFailure: true,
  },
  dagelijks: {
    description: "Elke ochtend: uitkomsten terug uit Instantly, Web Partners en OnePageCRM (S8, S9)",
    jobs: ["s8-instantly-sync", "s8-webpartners-import", "s9-onepage-push", "s9-onepage-pull"],
    stopOnFailure: false,
  },
  vrijdag: {
    description: "Vrijdag: weekrapport (S10)",
    jobs: ["s10-weekly-report"],
    stopOnFailure: false,
  },
};
