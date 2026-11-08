import { z } from "zod";

/**
 * Application forms per vacancy (recruitment brief 2.8 and section 3).
 * A form is a list of blocks ("Add group"), each with a title, an
 * explanation and questions. Stored as jsonb in recruitment_forms.blocks
 * (draft) and recruitment_form_versions.blocks (published).
 *
 * Pure module: used by the builder (client), the public form and the tests.
 */

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "single_choice",
  "multiple_choice",
  "yes_no",
  "file",
  "current_ctc",
  "expected_ctc",
  "hourly_rate",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const questionTypeLabels: Record<QuestionType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  email: "Email address",
  phone: "Phone number",
  url: "Link",
  number: "Number",
  single_choice: "One choice from a list",
  multiple_choice: "Multiple choices",
  yes_no: "Yes / no",
  file: "File upload (CV)",
  current_ctc: "Current CTC (INR per year)",
  expected_ctc: "Expected CTC (INR per year)",
  hourly_rate: "Hourly rate (INR)",
};

/** Candidate fields an answer can be saved to. */
export const MAPPING_TARGETS = [
  "full_name",
  "email",
  "phone",
  "linkedin_url",
  "video_url",
  "current_company",
  "years_experience",
  "notice_period",
  "willing_to_relocate",
  "location",
  "source",
  "cv",
] as const;
export type MappingTarget = (typeof MAPPING_TARGETS)[number];

export const mappingLabels: Record<MappingTarget, string> = {
  full_name: "Name",
  email: "Email",
  phone: "Phone",
  linkedin_url: "LinkedIn",
  video_url: "Video intro",
  current_company: "Current company",
  years_experience: "Total experience (years)",
  notice_period: "Notice period",
  willing_to_relocate: "Willing to relocate",
  location: "Location",
  source: "Source (how did you find us)",
  cv: "CV",
};

/** Which candidate fields fit which question type. */
export const mappingsForType: Record<QuestionType, MappingTarget[]> = {
  short_text: ["full_name", "current_company", "notice_period", "location"],
  long_text: [],
  email: ["email"],
  phone: ["phone"],
  url: ["linkedin_url", "video_url"],
  number: ["years_experience"],
  single_choice: ["notice_period", "source", "location"],
  multiple_choice: [],
  yes_no: ["willing_to_relocate"],
  file: ["cv"],
  current_ctc: [],
  expected_ctc: [],
  hourly_rate: [],
};

export const CHOICE_TYPES: QuestionType[] = ["single_choice", "multiple_choice"];
export const COMPENSATION_TYPES: QuestionType[] = ["current_ctc", "expected_ctc", "hourly_rate"];

export const LIMITS = {
  blocks: 20,
  questionsPerBlock: 60,
  options: 50,
  label: 300,
  help: 1000,
  option: 200,
  blockTitle: 200,
  blockDescription: 2000,
  title: 200,
  intro: 5000,
  shortText: 300,
  longText: 5000,
};

const id = z.string().regex(/^[a-z0-9_]{1,40}$/i, "Invalid id");

export const questionSchema = z
  .object({
    id,
    type: z.enum(QUESTION_TYPES),
    label: z.string().trim().min(1, "Every question needs a label.").max(LIMITS.label),
    help: z.string().trim().max(LIMITS.help).optional(),
    required: z.boolean().default(false),
    width: z.enum(["full", "half"]).default("full"),
    options: z.array(z.string().trim().min(1).max(LIMITS.option)).max(LIMITS.options).optional(),
    mapsTo: z.enum(MAPPING_TARGETS).optional(),
    /** Check question: the answer we hope for; other answers are highlighted. */
    expected: z.enum(["yes", "no"]).optional(),
  })
  .superRefine((q, ctx) => {
    if (CHOICE_TYPES.includes(q.type) && (!q.options || q.options.length === 0)) {
      ctx.addIssue({ code: "custom", message: `Add choices to "${q.label}".`, path: ["options"] });
    }
    if (q.mapsTo && !mappingsForType[q.type].includes(q.mapsTo)) {
      ctx.addIssue({ code: "custom", message: `"${q.label}" cannot be saved to ${mappingLabels[q.mapsTo]}.`, path: ["mapsTo"] });
    }
  });

export const blockSchema = z.object({
  id,
  title: z.string().trim().max(LIMITS.blockTitle).default(""),
  description: z.string().trim().max(LIMITS.blockDescription).optional(),
  questions: z.array(questionSchema).max(LIMITS.questionsPerBlock),
});

export const blocksSchema = z
  .array(blockSchema)
  .max(LIMITS.blocks)
  .superRefine((blocks, ctx) => {
    const seen = new Set<string>();
    const mapped = new Set<string>();
    for (const block of blocks) {
      for (const q of block.questions) {
        if (seen.has(q.id)) ctx.addIssue({ code: "custom", message: "Two questions have the same id." });
        seen.add(q.id);
        const target = q.mapsTo ?? (COMPENSATION_TYPES.includes(q.type) ? q.type : undefined);
        if (target) {
          if (mapped.has(target)) {
            const name = q.mapsTo ? mappingLabels[q.mapsTo] : questionTypeLabels[q.type];
            ctx.addIssue({ code: "custom", message: `Only one question can be saved to ${name}.` });
          }
          mapped.add(target);
        }
      }
    }
  });

export type Question = z.infer<typeof questionSchema>;
export type Block = z.infer<typeof blockSchema>;
export type RoleType = "fulltime" | "freelance";

export const formMetaSchema = z.object({
  title: z.string().trim().min(1, "Give the form a title.").max(LIMITS.title),
  intro: z.string().trim().max(LIMITS.intro).optional(),
  roleType: z.enum(["fulltime", "freelance"]),
  maxReminders: z.coerce.number().int().min(0).max(5),
  reminderIntervalDays: z.coerce.number().int().min(1).max(60),
});

/** Read stored jsonb safely; anything malformed becomes an empty form. */
export function readBlocks(value: unknown): Block[] {
  const parsed = blocksSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function allQuestions(blocks: Block[]): Question[] {
  return blocks.flatMap((b) => b.questions);
}

/** Short random id for a block or question. */
export function newId(prefix: "b" | "q") {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${random}`;
}

/** The field name of a question in the public form. */
export function fieldName(questionId: string) {
  return `f_${questionId}`;
}

/** Where an answer goes: a candidate field, a compensation amount, or nowhere. */
export function targetOf(q: Question): MappingTarget | "current_ctc" | "expected_ctc" | "hourly_rate" | null {
  if (q.type === "current_ctc" || q.type === "expected_ctc" || q.type === "hourly_rate") return q.type;
  return q.mapsTo ?? null;
}
