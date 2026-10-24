import Anthropic from "@anthropic-ai/sdk";
import { askJson, ClaudeRefusalError, hasClaude } from "@/lib/ai/claude";
import { checkOpeningLine } from "@/lib/ai/prompts/opening-line";
import {
  enforceRules,
  QUALIFY_SYSTEM,
  qualifyInput,
  qualifySchema,
  ruleBasedDecision,
  type QualifyOutput,
  type QualifyVacancy,
} from "@/lib/ai/prompts/qualify";
import { defineJob, forEachSafe, type JobContext } from "@/lib/gtm/jobs";

/**
 * S2: every company without icp_decision goes to Claude with its company data
 * and most recent vacancies (title and text from signals.raw_json). The answer
 * (briefing section 11) is stored on the company; GO companies become actief.
 * A refusal or an unparseable answer marks the company REVIEW with the reason
 * (rule 9: in doubt, Julius looks himself). API and network errors leave the
 * company untouched so the next run retries it.
 *
 * Params: --limit (default 100).
 */

const VACANCIES_PER_COMPANY = 3;

function intParam(ctx: JobContext, name: string, fallback: number, max: number) {
  const value = Number.parseInt(ctx.params[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

type RawVacancy = {
  title?: string | null;
  description?: string | null;
  posted_at?: string | null;
  location?: string | null;
};

export const s2Qualify = defineJob({
  name: "s2-qualify",
  description: "S2: bedrijven zonder ICP-besluit laten kwalificeren door Claude",
  run: async (ctx) => {
    if (!hasClaude()) throw new Error("ANTHROPIC_API_KEY ontbreekt. Zet deze in de omgevingsvariabelen.");
    const limit = intParam(ctx, "limit", 100, 1000);

    const { data: companies, error } = await ctx.db
      .from("companies")
      .select("id, name, domain, website, employees, sector, legal_form, city, linkedin_url")
      .is("icp_decision", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    ctx.countIn(companies.length);
    ctx.log(`${companies.length} bedrijven zonder ICP-besluit`);

    const counts = { GO: 0, NO_GO: 0, REVIEW: 0, regel: 0, fout_review: 0 };

    await forEachSafe(ctx, companies, (company) => company.domain, async (company) => {
      const save = async (output: QualifyOutput) => {
        const result = enforceRules(output);
        const { error: updateError } = await ctx.db
          .from("companies")
          .update({
            icp_decision: result.decision,
            icp_score: result.score,
            icp_reason: result.reason,
            segment: result.segment,
            red_flags: result.red_flags,
            opening_line: checkOpeningLine(result.opening_line),
            client_contact_risk: result.client_contact_risk,
            qualified_at: new Date().toISOString(),
            ...(result.decision === "GO" ? { status: "actief" as const } : {}),
          })
          .eq("id", company.id)
          .is("icp_decision", null); // never overwrite a decision made meanwhile (for example by Julius)
        if (updateError) throw updateError;
        counts[result.decision] += 1;
        ctx.countOut();
      };

      const rule = ruleBasedDecision({ employees: company.employees });
      if (rule) {
        counts.regel += 1;
        await save(rule);
        return;
      }

      const { data: signals, error: signalError } = await ctx.db
        .from("signals")
        .select("type, title, source, first_seen_at, raw_json")
        .eq("company_id", company.id)
        .order("last_seen_at", { ascending: false })
        .limit(20);
      if (signalError) throw signalError;

      const vacancies: QualifyVacancy[] = (signals ?? [])
        .filter((signal) => signal.type === "vacature")
        .slice(0, VACANCIES_PER_COMPANY)
        .map((signal) => {
          const raw = (signal.raw_json ?? {}) as RawVacancy;
          return {
            title: signal.title ?? raw.title ?? null,
            postedAt: raw.posted_at ?? null,
            firstSeenAt: signal.first_seen_at,
            source: signal.source,
            location: raw.location ?? null,
            text: raw.description ?? null,
          };
        });
      const signalTypes = [...new Set((signals ?? []).map((s) => s.type).filter((type) => type !== "vacature"))];

      const input = qualifyInput({
        name: company.name,
        domain: company.domain,
        website: company.website,
        employees: company.employees,
        sector: company.sector,
        legalForm: company.legal_form,
        city: company.city,
        linkedinUrl: company.linkedin_url,
        signalTypes,
        vacancies,
      });

      let output: QualifyOutput;
      try {
        output = await askJson({ system: QUALIFY_SYSTEM, input, schema: qualifySchema, effort: "medium", maxTokens: 8000 });
      } catch (askError) {
        // Transient API or network errors: leave the company for the next run.
        if (askError instanceof Anthropic.APIError) throw askError;
        const why =
          askError instanceof ClaudeRefusalError
            ? askError.message
            : `Antwoord van Claude niet te lezen: ${askError instanceof Error ? askError.message.slice(0, 200) : String(askError)}`;
        counts.fout_review += 1;
        ctx.log(`${company.domain}: REVIEW, ${why}`);
        output = {
          decision: "REVIEW",
          segment: null,
          score: 0,
          reason: `Automatische kwalificatie mislukt, kijk zelf. ${why}`.slice(0, 500),
          client_contact_risk: false,
          red_flags: ["kwalificatie mislukt"],
          opening_line: "",
        };
      }
      await save(output);
    });

    Object.assign(ctx.meta, {
      go: counts.GO,
      no_go: counts.NO_GO,
      review: counts.REVIEW,
      rule_based: counts.regel,
      review_after_error: counts.fout_review,
    });
    ctx.log(`GO ${counts.GO}, NO_GO ${counts.NO_GO}, REVIEW ${counts.REVIEW} (waarvan ${counts.fout_review} na een fout)`);
  },
});
