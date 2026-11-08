import type { VacancyRequirements } from "@/lib/talent/prefilter";

/**
 * A free text profile ("senior data engineer, Python and dbt, Snowflake a
 * plus") as requirements without Claude: short comma separated phrases
 * become stack skills, the seniority is read from the words. Claude refines
 * this when it is connected. Pure, unit tested.
 */
export function requirementsFromText(text: string): VacancyRequirements {
  const lower = text.toLowerCase();
  const seniority: VacancyRequirements["seniority"] = /\blead\b|\bprincipal\b|\bstaff\b/.test(lower)
    ? "lead"
    : /\bmedior\b|\bmid\b|\bmid-level\b/.test(lower)
      ? "medior"
      : "senior";
  const phrases = text
    .split(/[,;\n]|\band\b|\bwith\b|\bplus\b|\bor\b/i)
    .map((p) =>
      p
        .replace(/\b(senior|medior|junior|lead|mid|level|developer|engineer|experience|years?|of|in|a|an|the|someone|who|knows|looking|for|we|need|strong|good|at|least|\d+\+?)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((p) => p.length >= 1 && p.split(" ").length <= 3);
  const stack = [...new Set(phrases)].slice(0, 15);
  return {
    title: text.trim().split(/[.\n]/)[0].slice(0, 120) || "Profile",
    stack,
    seniority,
    hours: null,
    timezone_overlap: null,
    budget_min: null,
    budget_max: null,
    client_contact_required: null,
    must_haves: [],
    nice_to_haves: [],
  };
}
