import { defineJob, forEachSafe, type JobContext } from "@/lib/gtm/jobs";
import { normalizeLinkedin } from "@/lib/gtm/normalize";
import {
  countDistinctTechRoles,
  isLongOpen,
  isTechRole,
  mentionsRemoteOrExternal,
  MULTIPLE_ROLES_MIN,
  MULTIPLE_ROLES_WINDOW_DAYS,
} from "@/lib/gtm/signals";
import { upsertCompany, upsertSignal } from "@/lib/gtm/upsert";
import {
  buildIndeedJobsInput,
  buildLinkedinJobsInput,
  hasApify,
  mapIndeedJob,
  mapLinkedinJob,
  requireActor,
  runActorSync,
  type ScrapedJob,
} from "@/lib/integrations/apify";

/**
 * S1: Dutch developer and data vacancies from LinkedIn and Indeed (Apify).
 * Match on domain: new company or extra signal; the same vacancy seen again
 * only updates last_seen_at (upsertSignal). Extra signal types per company:
 * lang_open (> 60 days open), meerdere_rollen (2+ distinct tech roles in the
 * last 60 days) and remote_extern (text mentions remote or an external team).
 *
 * Params: --limit (max items per actor, default 200), --days (posted within,
 * default 7).
 */

function intParam(ctx: JobContext, name: string, fallback: number, max: number) {
  const value = Number.parseInt(ctx.params[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

/** What we keep of a job in signals.raw_json (S2 reads title and description from it). */
function rawJson(job: ScrapedJob) {
  return {
    source: job.source,
    title: job.title,
    company_name: job.companyName,
    company_website: job.companyWebsite,
    company_linkedin_url: job.companyLinkedinUrl,
    location: job.location,
    posted_at: job.postedAt,
    job_url: job.jobUrl,
    employees: job.employees,
    description: job.description?.slice(0, 20_000) ?? null,
  };
}

type Resolved = { job: ScrapedJob; domain: string };

export const s1Signals = defineJob({
  name: "s1-signals",
  description: "S1: vacatures ophalen via Apify (LinkedIn, Indeed) en als signalen opslaan",
  run: async (ctx) => {
    const limit = intParam(ctx, "limit", 200, 2000);
    const days = intParam(ctx, "days", 7, 60);
    // Fail early and clearly when configuration is missing (no half runs).
    if (!hasApify()) throw new Error("APIFY_TOKEN ontbreekt. Zet deze in de omgevingsvariabelen.");
    const linkedinActor = requireActor("APIFY_LINKEDIN_JOBS_ACTOR");
    const indeedActor = requireActor("APIFY_INDEED_JOBS_ACTOR");

    const now = new Date();
    const jobs: ScrapedJob[] = [];

    ctx.log(`LinkedIn: ${linkedinActor}, max ${limit} vacatures van de laatste ${days} dagen`);
    const linkedinItems = await runActorSync(linkedinActor, buildLinkedinJobsInput({ days, limit }), { maxItems: limit });
    jobs.push(...linkedinItems.map((item) => mapLinkedinJob(item, now)));

    ctx.log(`Indeed: ${indeedActor}, max ${limit} vacatures`);
    const indeedItems = await runActorSync(indeedActor, buildIndeedJobsInput({ days, limit }), { maxItems: limit });
    jobs.push(...indeedItems.map((item) => mapIndeedJob(item, now)));

    ctx.countIn(jobs.length);
    ctx.meta.scraped_linkedin = linkedinItems.length;
    ctx.meta.scraped_indeed = indeedItems.length;

    // Keep tech roles only; resolve the company domain (or a known company via LinkedIn).
    const techJobs = jobs.filter((job) => isTechRole(job.title));
    ctx.meta.skipped_not_tech = jobs.length - techJobs.length;

    const resolved: Resolved[] = [];
    let noDomain = 0;
    const linkedinToDomain = new Map<string, string | null>();
    for (const job of techJobs) {
      let domain = job.companyDomain;
      if (!domain && job.companyLinkedinUrl) {
        const key = normalizeLinkedin(job.companyLinkedinUrl)!;
        if (!linkedinToDomain.has(key)) {
          const { data } = await ctx.db.from("companies").select("domain").eq("linkedin_url", key).limit(1).maybeSingle();
          linkedinToDomain.set(key, data?.domain ?? null);
        }
        domain = linkedinToDomain.get(key) ?? null;
      }
      if (!domain) {
        noDomain += 1;
        continue;
      }
      resolved.push({ job, domain });
    }
    ctx.meta.skipped_no_domain = noDomain;
    if (noDomain > 0) ctx.log(`${noDomain} vacatures overgeslagen: geen bedrijfsdomein te vinden`);

    // Pass 1: company + vacature signal (+ remote_extern) per job.
    const companies = new Map<string, string>(); // domain -> company id
    let companiesCreated = 0;
    let signalsCreated = 0;
    let remoteSignals = 0;

    await forEachSafe(ctx, resolved, ({ job, domain }) => `${domain}: ${job.title}`, async ({ job, domain }) => {
      const company = await upsertCompany(
        ctx.db,
        {
          domain,
          name: job.companyName,
          website: job.companyWebsite,
          linkedin_url: normalizeLinkedin(job.companyLinkedinUrl),
          employees: job.employees,
        },
        job.source === "linkedin" ? "apify_linkedin" : "apify_indeed",
      );
      if (company.created) companiesCreated += 1;
      companies.set(domain, company.id);

      const signal = await upsertSignal(ctx.db, {
        company_id: company.id,
        company_domain: domain,
        type: "vacature",
        title: job.title,
        source: job.source,
        source_url: job.jobUrl,
        raw_json: rawJson(job),
      });
      if (signal.created) signalsCreated += 1;
      ctx.countOut();

      if (mentionsRemoteOrExternal(`${job.title ?? ""}\n${job.description ?? ""}`)) {
        // No source_url: the dedupe key then is source + domain + this title, separate from the vacature itself.
        const extra = await upsertSignal(ctx.db, {
          company_id: company.id,
          company_domain: domain,
          type: "remote_extern",
          title: `Remote of extern team: ${job.title ?? "vacature"}`,
          source: job.source,
          raw_json: { job_url: job.jobUrl, vacancy_title: job.title },
        });
        if (extra.created) remoteSignals += 1;
      }
    });

    // Pass 2: per company, lang_open and meerdere_rollen from all recent vacature signals.
    let longOpenSignals = 0;
    let multipleRoleSignals = 0;
    const windowStart = new Date(now.getTime() - MULTIPLE_ROLES_WINDOW_DAYS * 86_400_000).toISOString();

    await forEachSafe(ctx, [...companies.entries()], ([domain]) => domain, async ([domain, companyId]) => {
      const { data: vacancies, error } = await ctx.db
        .from("signals")
        .select("title, source, source_url, first_seen_at, raw_json")
        .eq("company_id", companyId)
        .eq("type", "vacature")
        .gte("last_seen_at", windowStart);
      if (error) throw error;

      for (const vacancy of vacancies ?? []) {
        const raw = (vacancy.raw_json ?? {}) as { posted_at?: string | null; job_url?: string | null };
        if (!isLongOpen({ postedAt: raw.posted_at, firstSeenAt: vacancy.first_seen_at }, now)) continue;
        const extra = await upsertSignal(ctx.db, {
          company_id: companyId,
          company_domain: domain,
          type: "lang_open",
          title: `Lang open: ${vacancy.title ?? "vacature"}`,
          source: vacancy.source,
          raw_json: { job_url: raw.job_url ?? vacancy.source_url, posted_at: raw.posted_at ?? null, first_seen_at: vacancy.first_seen_at },
        });
        if (extra.created) longOpenSignals += 1;
      }

      const titles = (vacancies ?? []).map((vacancy) => vacancy.title);
      const roles = countDistinctTechRoles(titles);
      if (roles >= MULTIPLE_ROLES_MIN) {
        // One stable signal per company (fixed title, no URL); seen again only updates last_seen_at.
        const extra = await upsertSignal(ctx.db, {
          company_id: companyId,
          company_domain: domain,
          type: "meerdere_rollen",
          title: "Meerdere techrollen open",
          source: "overig",
          raw_json: { roles, titles: [...new Set(titles.filter(Boolean))].slice(0, 20) },
        });
        if (extra.created) multipleRoleSignals += 1;
      }
    });

    Object.assign(ctx.meta, {
      tech_jobs: techJobs.length,
      companies_touched: companies.size,
      companies_created: companiesCreated,
      vacature_signals_created: signalsCreated,
      remote_extern_created: remoteSignals,
      lang_open_created: longOpenSignals,
      meerdere_rollen_created: multipleRoleSignals,
    });
    ctx.log(
      `${techJobs.length} techvacatures, ${companies.size} bedrijven (${companiesCreated} nieuw), ${signalsCreated} nieuwe vacaturesignalen, ` +
        `extra: ${longOpenSignals} lang open, ${multipleRoleSignals} meerdere rollen, ${remoteSignals} remote of extern`,
    );
  },
});
