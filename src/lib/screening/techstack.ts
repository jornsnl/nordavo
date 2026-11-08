import type { TechstackResult } from "@/lib/database.types";
import { foldText } from "@/lib/talent/anonymize";
import { skillOverlap } from "@/lib/talent/prefilter";

/**
 * Techstack check (recruitment brief 2.7): a deterministic keyword pass
 * that takes out candidates who clearly do not fit (no stack overlap, or an
 * excluded profile such as a frontend developer for a backend role). What
 * is not clear either way is "unclear", for a person or an optional Claude
 * pass. Nobody is rejected here: the result is a proposal. Pure, unit tested.
 */

export type TechstackRules = {
  stack: string[];
  must_haves: string[];
  excluded_profiles: string[];
  techstack_min_hits: number | null;
};

export type TechstackCandidate = {
  skills: string[];
  currentTitle: string | null;
  summary: string | null;
  cvText: string | null;
};

export type TechstackOutcome = { result: TechstackResult; reason: string; hits: string[] };

/** The skills the check looks for: the stack, else the short must haves. */
export function checkedSkills(rules: Pick<TechstackRules, "stack" | "must_haves">) {
  if (rules.stack.length > 0) return [...new Set(rules.stack.map((s) => s.trim()).filter(Boolean))];
  return [...new Set(rules.must_haves.map((m) => m.trim()).filter((m) => m && m.split(/\s+/).length <= 3))];
}

/** Stack skills needed to pass: the vacancy setting, else about half the stack, at least 1 and at most 3. */
export function requiredHits(rules: TechstackRules) {
  const total = checkedSkills(rules).length;
  if (total === 0) return 0;
  const wanted = rules.techstack_min_hits ?? Math.min(3, Math.max(1, Math.ceil(total / 2)));
  return Math.min(total, Math.max(1, wanted));
}

const FILLER = /\b(only|profiles?|developers?|engineers?|roles?|candidates?|people|pure|just|no)\b/g;

/** "Frontend only" -> "frontend"; "QA / testers" -> "qa testers". */
export function profileCore(profile: string) {
  return foldText(profile).replace(/[^a-z0-9#+.]+/g, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();
}

function profilePattern(profile: string) {
  const core = profileCore(profile);
  if (!core) return null;
  const parts = core.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // "front end", "front-end" and "frontend" all match "frontend".
  const joined = parts.join("[\\s-]*");
  const single = parts.length === 1 && /^(front|back)end$/.test(parts[0]) ? `${parts[0].slice(0, -3)}[\\s-]*end` : joined;
  return new RegExp(`(^|[^a-z0-9])(${single})($|[^a-z0-9])`);
}

/** The excluded profile the candidate's title or headline matches, or null. */
export function matchedExcludedProfile(excluded: string[], c: TechstackCandidate): string | null {
  const headline = foldText(
    [c.currentTitle ?? "", (c.summary ?? "").slice(0, 200), (c.cvText ?? "").slice(0, 200)].join(" \n "),
  );
  for (const profile of excluded) {
    const pattern = profilePattern(profile);
    if (pattern && pattern.test(headline)) return profile.trim();
  }
  return null;
}

function list(items: string[], max = 5) {
  return items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");
}

export function evaluateTechstack(rules: TechstackRules, c: TechstackCandidate): TechstackOutcome {
  const skills = checkedSkills(rules);
  const hasText = Boolean(c.cvText?.trim() || c.summary?.trim());
  const hasInfo = hasText || c.skills.length > 0;
  if (!hasInfo && !c.currentTitle?.trim()) {
    return { result: "unclear", reason: "No CV, skills or title to check yet.", hits: [] };
  }
  if (skills.length === 0 && rules.excluded_profiles.length === 0) {
    return { result: "unclear", reason: "This vacancy has no stack or excluded profiles to check against.", hits: [] };
  }

  const hits = skills.length > 0 ? skillOverlap(skills, { skills: c.skills, summary: c.summary, cvText: [c.currentTitle, c.cvText].filter(Boolean).join("\n") }) : [];
  const needed = requiredHits(rules);
  const excluded = matchedExcludedProfile(rules.excluded_profiles, c);

  if (excluded) {
    if (hits.length === 0) {
      return { result: "fail", reason: `Excluded profile (${excluded})${skills.length > 0 ? " and none of the stack found" : ""}.`, hits };
    }
    return { result: "unclear", reason: `Looks like an excluded profile (${excluded}), but has ${list(hits)}.`, hits };
  }
  if (skills.length === 0) {
    return { result: "pass", reason: "No excluded profile found. This vacancy has no stack to check.", hits };
  }
  if (hits.length >= needed) {
    return { result: "pass", reason: `Has ${hits.length} of ${skills.length}: ${list(hits)}.`, hits };
  }
  if (hits.length === 0) {
    if (!hasInfo) return { result: "unclear", reason: "Only a job title, no skills or CV to check the stack.", hits };
    return { result: "fail", reason: `None of the stack found (${list(skills)}).`, hits };
  }
  return {
    result: "unclear",
    reason: `Only ${hits.length} of ${skills.length} stack skills found (${needed} needed): ${list(hits)}.`,
    hits,
  };
}

/** The rejection reason for a failed check, as stored on the application. */
export function mismatchReason(reason: string) {
  return `Techstack mismatch: ${reason.replace(/\.$/, "")}`.slice(0, 2000);
}

/**
 * Plan for the confirmation screen: passes go to fill_out, fails to
 * rejected, grouped by reason (move_applications takes one reason per call).
 */
export function planTechstackMoves(checks: { applicationId: string; result: TechstackResult; reason: string }[]) {
  const pass = checks.filter((c) => c.result === "pass").map((c) => c.applicationId);
  const failByReason = new Map<string, string[]>();
  for (const c of checks) {
    if (c.result !== "fail") continue;
    const reason = mismatchReason(c.reason);
    failByReason.set(reason, [...(failByReason.get(reason) ?? []), c.applicationId]);
  }
  return { pass, fail: [...failByReason.entries()].map(([reason, ids]) => ({ reason, ids })) };
}
