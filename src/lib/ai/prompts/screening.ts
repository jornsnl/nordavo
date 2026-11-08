import { z } from "zod";

/**
 * Prompts for screening (recruitment brief 2.6.2, 2.7, 2.11, 2.15).
 * The CV scoring instructions are editable by an admin (screening_prompts);
 * SCREENING_DEFAULT_INSTRUCTIONS is version 0, used while no version is
 * active. The output rules below are fixed in code so the schema always fits.
 */

export const SCREENING_DEFAULT_INSTRUCTIONS = `You screen CVs for Nordavo. Nordavo places medior and senior developers and data professionals from Bangalore full time in the teams of Dutch companies. They work remotely from Bangalore as regular team members, with overlap with Dutch working hours and English as the working language.

You get one job description with a list of requirements, and one CV. Judge how well the CV matches the job.

How to judge:
- Look for evidence in the CV: tools and languages used in real jobs or projects, years of use, responsibilities. A keyword in a skills list without any project or job using it is weak evidence.
- Requirements marked "must have" cannot be missing. If there is no evidence for a must have, mark it missing.
- Requirements marked "alternative possible" may be met by a comparable technology or experience. Use the listed alternatives; a close equivalent that is not listed also counts, but say which one in the evidence.
- "Nice to have" requirements add to the score but are never a reason to reject.
- Seniority: Nordavo does not place juniors. Less than 2 years of relevant professional experience is a clear minus.
- Judge only on what the CV says. Do not assume skills that are not there. Unclear dates or gaps are not a reason to reject, but mention them in the summary when they matter.

Match percentage: 0 to 100, how well the CV fits the whole job. Roughly: must haves and core stack 60, relevant experience and seniority 25, nice to haves and domain 15. 70 or higher means you would put this CV in front of the recruiter with confidence. With a missing must have, stay below 50.`;

export const SCREENING_OUTPUT_RULES = `Output:
- requirements: exactly one entry per requirement in the job, in the same order, with the label exactly as given. status is "met" (clear evidence), "alternative" (met through an alternative, only for requirements that allow one) or "missing" (no evidence). evidence is one short sentence in English quoting or paraphrasing the CV, or saying what is missing.
- match_percentage: integer 0 to 100.
- verdict: "fit", "maybe" or "no_fit".
- summary: at most three short sentences in English for the recruiter: the main reason, the biggest gap, anything to check in the screening call.
Do not repeat names, email addresses or phone numbers from the CV.`;

export const cvScoreSchema = z.object({
  requirements: z.array(
    z.object({
      label: z.string(),
      status: z.enum(["met", "alternative", "missing"]),
      evidence: z.string(),
    }),
  ),
  match_percentage: z.number(),
  verdict: z.enum(["fit", "maybe", "no_fit"]),
  summary: z.string(),
});

export type CvScoreOutput = z.infer<typeof cvScoreSchema>;

/** System prompt for one prompt version: the editable instructions plus the fixed output rules. */
export function screeningSystem(instructions: string) {
  return `${instructions.trim()}\n\n${SCREENING_OUTPUT_RULES}`;
}

export type ScoringRequirement = { label: string; kind: "must_have" | "alternative" | "nice_to_have"; alternatives: string[] };

const KIND_LABEL: Record<ScoringRequirement["kind"], string> = {
  must_have: "must have",
  alternative: "alternative possible",
  nice_to_have: "nice to have",
};

/** The job part of the input: the same for every CV of a vacancy, so it is cached. */
export function jobInput(job: { title: string; seniority: string; description: string | null; stack: string[] }, requirements: ScoringRequirement[]) {
  const lines = requirements.map((r, i) => {
    const alt = r.kind === "alternative" && r.alternatives.length > 0 ? ` (alternatives: ${r.alternatives.join(", ")})` : "";
    return `${i + 1}. [${KIND_LABEL[r.kind]}] ${r.label}${alt}`;
  });
  return [
    `Job: ${job.title}`,
    `Seniority: ${job.seniority}`,
    job.stack.length > 0 ? `Stack: ${job.stack.join(", ")}` : null,
    "",
    "Requirements:",
    ...(lines.length > 0 ? lines : ["(none listed: judge on the job description)"]),
    "",
    "Job description:",
    (job.description ?? "").trim().slice(0, 12000) || "(no job description, use the requirements)",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function cvInput(cv: string) {
  return `CV:\n${cv}`;
}

// ---------------------------------------------------------------------------
// Reading a CV
// ---------------------------------------------------------------------------

export const CV_READ_SYSTEM = `You read CVs for Nordavo, a recruitment company. Extract the facts from the CV exactly as written. Do not guess: leave a field null or empty when the CV does not say it.

- full_name: the candidate's name.
- email, phone: as written in the CV (the first one if there are several).
- linkedin_url: the LinkedIn profile URL if present.
- location: city (and country if given), for example "Bangalore".
- current_title: the current or most recent job title.
- years_experience: total years of professional experience as a whole number, from the CV's own statement or the dates of the jobs. Null if you cannot tell.
- skills: the technical skills, tools and languages, at most 30, strongest first.
- employers: the employers, most recent first, at most 10.
- summary: two or three sentences in English about the profile (role, main stack, kind of projects), without the name or contact details.`;

export const cvFieldsSchema = z.object({
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  location: z.string().nullable(),
  current_title: z.string().nullable(),
  years_experience: z.number().nullable(),
  skills: z.array(z.string()),
  employers: z.array(z.string()),
  summary: z.string().nullable(),
});

export type CvFields = z.infer<typeof cvFieldsSchema>;

/** For a PDF Claude reads itself: the fields plus the full plain text. */
export const cvPdfSchema = cvFieldsSchema.extend({
  cv_text: z.string().describe("The full text of the CV as plain text, in reading order, without layout."),
});

export const CV_PDF_EXTRA = `Also return cv_text: the complete text of the CV as plain text in reading order (headings, jobs with dates, projects, skills, education). Do not summarise or leave parts out.`;

// ---------------------------------------------------------------------------
// Techstack check, unclear cases
// ---------------------------------------------------------------------------

export const TECHSTACK_SYSTEM = `You help Nordavo with the first filter on applicants: does a candidate roughly have the right techstack for a role? This is not a full assessment, only: is this obviously the wrong profile (for example a frontend developer for a backend role, a tester for a data engineering role), or is it worth looking further.

You get the role (stack, must haves and profiles that do not fit) and one candidate (title, skills and part of the CV). Answer:
- result: "pass" when the candidate works with (most of) the stack or a close equivalent, "fail" when the profile clearly does not fit the role, "unclear" when you cannot tell from the information.
- reason: one short sentence in English, concrete (which stack is there or missing). Do not mention names or contact details.
When in doubt, choose "unclear": a person decides.`;

export const techstackSchema = z.object({
  result: z.enum(["pass", "fail", "unclear"]),
  reason: z.string(),
});

// ---------------------------------------------------------------------------
// Talent pool question
// ---------------------------------------------------------------------------

export const PROFILE_QUERY_SYSTEM = `You turn a short free text description of a wanted profile into search requirements for Nordavo's talent pool (medior and senior developers and data professionals in Bangalore).

- title: a short role title.
- stack: the technologies, languages and tools that are asked for, as short names (for example "Python", "dbt", "React").
- seniority: "medior", "senior" or "lead". Senior when nothing is said.
- must_haves: requirements that are clearly required, short.
- nice_to_haves: things that are mentioned as a plus.
Do not add technologies that are not in the text.`;

export const profileQuerySchema = z.object({
  title: z.string(),
  stack: z.array(z.string()),
  seniority: z.enum(["medior", "senior", "lead"]),
  must_haves: z.array(z.string()),
  nice_to_haves: z.array(z.string()),
});
