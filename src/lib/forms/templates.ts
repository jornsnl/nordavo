import { newId, type Block, type Question, type RoleType } from "./schema";

/**
 * Starting points for a new form, based on the two Airtable forms in
 * section 3 of the recruitment brief. Everything can be changed afterwards.
 */

type Draft = Omit<Question, "id" | "required" | "width"> & Partial<Pick<Question, "required" | "width">>;

function q(draft: Draft): Question {
  return { id: newId("q"), required: false, width: "full", ...draft };
}

function block(title: string, description: string | undefined, questions: Question[]): Block {
  return { id: newId("b"), title, description, questions };
}

export const SOURCE_OPTIONS = ["LinkedIn", "Naukri", "Instagram (@nordavotalent)", "Indeed", "Monster", "Referral", "Other"];
/** The same choices as the notice period on the candidate (src/lib/recruitment/candidate-fields.ts). */
export const NOTICE_OPTIONS = ["Immediately", "15 days", "30 days", "45 days", "60 days", "90 days or more"];

const VIDEO_HELP =
  "Upload a 1 to 2 minute intro video to Google Drive and set it to Anyone with the link can view. Tell us who you are and why this role fits you.";

const INSTAGRAM_LINE = "We post every new opening on Instagram first: [@nordavotalent](https://www.instagram.com/nordavotalent/)";

export type FormTemplate = { title: string; intro: string; roleType: RoleType; blocks: Block[] };

export function fulltimeTemplate(vacancyTitle: string): FormTemplate {
  return {
    title: `${vacancyTitle} Application Form`,
    intro: `Thank you for your interest in the ${vacancyTitle} role at Nordavo. It takes about five minutes to apply.\n\n${INSTAGRAM_LINE}`,
    roleType: "fulltime",
    blocks: [
      block("Your details", undefined, [
        q({ type: "short_text", label: "Candidate Name", required: true, mapsTo: "full_name" }),
        q({ type: "phone", label: "Phone Number", required: true, width: "half", mapsTo: "phone" }),
        q({ type: "email", label: "Email ID", required: true, width: "half", mapsTo: "email" }),
        q({ type: "single_choice", label: "How did you find us?", options: SOURCE_OPTIONS, mapsTo: "source" }),
      ]),
      block("Technical Background", "Tell us about your professional experience with the stack of this role.", [
        q({ type: "number", label: "How many years of professional experience do you have with the main stack of this role?", required: true }),
        q({
          type: "multiple_choice",
          label: "Technologies Worked With (Professional)",
          required: true,
          options: ["PHP", "Laravel", "MySQL", "PostgreSQL", "JavaScript", "Vue", "React", "Docker", "AWS", "Other"],
        }),
      ]),
      block("Supporting Documents & Screening", "Applications missing the required video link will not be processed.", [
        q({ type: "file", label: "Resume/CV", required: true, mapsTo: "cv", help: "PDF, DOC or DOCX, at most 10 MB." }),
        q({ type: "url", label: "LinkedIn URL", mapsTo: "linkedin_url" }),
        q({ type: "url", label: "Video introduction link", required: true, mapsTo: "video_url", help: VIDEO_HELP }),
      ]),
      block("Professional Details", "This helps us match you with the right client.", [
        q({ type: "number", label: "Total Experience (Years)", required: true, width: "half", mapsTo: "years_experience" }),
        q({ type: "short_text", label: "Current Company", width: "half", mapsTo: "current_company" }),
        q({ type: "current_ctc", label: "Current CTC (INR per year)", required: true, width: "half", help: "Your gross yearly salary in rupees, for example 1200000 or 12 LPA." }),
        q({ type: "expected_ctc", label: "Expected CTC (INR per year)", required: true, width: "half" }),
        q({ type: "single_choice", label: "Notice Period", required: true, options: NOTICE_OPTIONS, mapsTo: "notice_period", width: "half" }),
        q({ type: "yes_no", label: "Willing to Relocate to Bengaluru", required: true, mapsTo: "willing_to_relocate", width: "half" }),
      ]),
    ],
  };
}

export function freelanceTemplate(vacancyTitle: string): FormTemplate {
  return {
    title: `Freelance ${vacancyTitle}`,
    intro: `Thank you for your interest in this freelance role at Nordavo. It takes about five minutes to apply.\n\n${INSTAGRAM_LINE}`,
    roleType: "freelance",
    blocks: [
      block("Personal Information", undefined, [
        q({ type: "short_text", label: "Full name", required: true, mapsTo: "full_name" }),
        q({ type: "phone", label: "Phone number", required: true, width: "half", mapsTo: "phone" }),
        q({ type: "email", label: "Email address", required: true, width: "half", mapsTo: "email" }),
        q({ type: "short_text", label: "City", width: "half", mapsTo: "location" }),
        q({ type: "url", label: "LinkedIn profile", width: "half", mapsTo: "linkedin_url" }),
      ]),
      block("Experience & Skills", undefined, [
        q({ type: "number", label: "Years of relevant experience", required: true, mapsTo: "years_experience" }),
        q({
          type: "multiple_choice",
          label: "Which tools have you worked with?",
          required: true,
          options: ["Clay", "Python", "n8n", "Apify", "Sales Navigator", "Make", "Zapier", "Apollo", "Other"],
        }),
        q({ type: "yes_no", label: "Have you written your own scrapers?", required: true, width: "half" }),
        q({ type: "yes_no", label: "Worked with European or Dutch data?", required: true, width: "half" }),
      ]),
      block("Project Example", "Describe one project you are proud of: the goal, what you built and the result.", [
        q({ type: "long_text", label: "Project description", required: true }),
      ]),
      block("Compensation & Availability", undefined, [
        q({ type: "hourly_rate", label: "Your hourly rate (INR)", required: true, width: "half" }),
        q({
          type: "single_choice",
          label: "When can you start?",
          required: true,
          width: "half",
          options: ["Immediately", "Within 1 week", "Within 2 weeks", "Within 1 month"],
          mapsTo: "notice_period",
        }),
        q({
          type: "yes_no",
          label: "Our budget is ₹500 to ₹1,000 per hour. Are you comfortable with this rate?",
          required: true,
          expected: "yes",
        }),
      ]),
      block("Resume & Video Introduction", "Applications missing the required video link will not be processed.", [
        q({ type: "file", label: "Resume/CV", required: true, mapsTo: "cv", help: "PDF, DOC or DOCX, at most 10 MB." }),
        q({ type: "url", label: "Video introduction link", required: true, mapsTo: "video_url", help: VIDEO_HELP }),
      ]),
    ],
  };
}

/** Fresh ids for a copied form, so answers of two vacancies never share keys. */
export function cloneBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => ({ ...b, id: newId("b"), questions: b.questions.map((qq) => ({ ...qq, id: newId("q") })) }));
}
