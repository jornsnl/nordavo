import type { CallOutcome } from "@/lib/sales/database";
import { WRONG_MOMENT } from "@/lib/sales/labels";

// What each call outcome asks for and what it means for the queue (feedback
// Julius, 813e214d and c6b258e3). Pure: the follow-up window on the call
// screen and the server action both use it, so what the window checks is
// what the server checks.

/** An outcome is about the person called, or about the whole company. */
export type OutcomeScope = "person" | "company";

/**
 * No answer, wrong number and wrong person are about the person: the next
 * contact of the same company follows. Call back, interested, meeting planned
 * and not interested are about the company: the next company follows. After
 * Referred the referred contact is next (a person outcome too).
 */
export const outcomeScope: Record<CallOutcome, OutcomeScope> = {
  no_answer: "person",
  wrong_number: "person",
  wrong_person: "person",
  referred: "person",
  call_back: "company",
  reached_interested: "company",
  meeting_planned: "company",
  reached_not_interested: "company",
};

/** Only No answer saves with one tap; every other outcome asks its follow-up first. */
export function needsFollowUp(outcome: CallOutcome): boolean {
  return outcome !== "no_answer";
}

export const nextSteps = [
  { value: "send_info", label: "Send info by mail" },
  { value: "call_back", label: "Call back" },
  { value: "meeting", label: "Plan a meeting" },
] as const;

export type NextStep = (typeof nextSteps)[number]["value"];

export const wrongPersonReasons = [
  { value: "left", label: "No longer works here" },
  { value: "other_role", label: "Works here, but not the right role" },
] as const;

export type WrongPersonReason = (typeof wrongPersonReasons)[number]["value"];

/** Everything the follow-up windows can fill in; all optional, the outcome decides what is required. */
export type OutcomeFields = {
  outcome: CallOutcome;
  callbackAt?: string | null;
  callbackTime?: string | null;
  callbackWith?: string | null;
  referredName?: string | null;
  referredTitle?: string | null;
  referredPhone?: string | null;
  referredEmail?: string | null;
  reasons?: string[] | null;
  reasonText?: string | null;
  /** Park the company until this date (required with the reason wrong moment). */
  until?: string | null;
  interest?: string | null;
  nextStep?: NextStep | null;
  nextStepAt?: string | null;
  nextOwner?: string | null;
  meetingReason?: string | null;
  /** The Cal.com link (who the meeting is with) picked for Meeting planned. */
  bookingLinkId?: string | null;
  wrongReason?: WrongPersonReason | null;
  newPhone?: string | null;
  note?: string | null;
};

const timePattern = /^([01]?\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const blank = (v: string | null | undefined) => !v || v.trim() === "";

/** The first thing missing or wrong for this outcome, or null when it can be saved. today is YYYY-MM-DD. */
export function outcomeProblem(v: OutcomeFields, today: string): string | null {
  switch (v.outcome) {
    case "call_back":
      if (!v.callbackAt || !datePattern.test(v.callbackAt)) return "Pick a date to call back";
      if (blank(v.callbackTime) || !timePattern.test(v.callbackTime!.trim())) return "Pick a time to call back";
      return null;
    case "reached_interested":
      if (!v.nextStep) return "Pick the next step";
      if (!v.nextStepAt || !datePattern.test(v.nextStepAt)) return "Pick when the next step happens";
      return null;
    case "meeting_planned":
      return blank(v.meetingReason) ? "Say what the meeting is about" : null;
    case "reached_not_interested": {
      const reasons = v.reasons ?? [];
      if (reasons.length === 0 && blank(v.reasonText)) return "Pick a reason or write one";
      if (reasons.includes(WRONG_MOMENT) && !v.until) return "Pick a date to get back in touch";
      if (v.until && (!datePattern.test(v.until) || v.until <= today)) return "Pick a date in the future";
      return null;
    }
    case "referred":
      if (blank(v.referredName)) return "Who were you referred to?";
      if (!blank(v.referredEmail) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.referredEmail!.trim())) return "That mail address does not look right";
      return null;
    case "wrong_person":
      if (!blank(v.referredEmail) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.referredEmail!.trim())) return "That mail address does not look right";
      return null;
    default:
      return null;
  }
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}-${m}-${y}`;
}

/**
 * The note that goes to the call log: what the follow-up window collected that
 * has no column of its own (for a "no" the reasons by name, reasonLabel), then what the caller typed. Meeting planned is the
 * exception: its first line is the reason, which becomes the reason of the
 * meeting in the register.
 */
export function composeNote(v: OutcomeFields, reasonLabel?: string | null): string | null {
  const own = v.note?.trim() ?? "";
  const lines: string[] = [];
  switch (v.outcome) {
    case "call_back": {
      const who = v.callbackWith?.trim();
      lines.push(`Call back${v.callbackAt ? ` on ${dayLabel(v.callbackAt)}` : ""}${v.callbackTime ? ` at ${v.callbackTime.trim()}` : ""}${who ? ` with ${who}` : ""}`);
      break;
    }
    case "reached_interested": {
      if (!blank(v.interest)) lines.push(`Interest: ${v.interest!.trim()}`);
      const step = nextSteps.find((s) => s.value === v.nextStep)?.label;
      if (step) lines.push(`Next step: ${step}${v.nextStepAt ? ` on ${dayLabel(v.nextStepAt)}` : ""}`);
      break;
    }
    case "meeting_planned":
      return [v.meetingReason?.trim(), own].filter(Boolean).join("\n") || null;
    case "wrong_person": {
      const why = wrongPersonReasons.find((r) => r.value === v.wrongReason)?.label;
      if (why) lines.push(why);
      break;
    }
    case "wrong_number":
      if (!blank(v.newPhone)) lines.push(`Right number: ${v.newPhone!.trim()}`);
      break;
    case "referred":
      if (!blank(v.referredEmail)) lines.push(`Referred mail: ${v.referredEmail!.trim()}`);
      break;
    case "reached_not_interested":
      if (reasonLabel) lines.push(`Reasons: ${reasonLabel}`);
      if (!blank(v.reasonText)) lines.push(`In their words: ${v.reasonText!.trim()}`);
      if (v.until) lines.push(`May be approached again from ${dayLabel(v.until)}`);
      break;
    default:
      break;
  }
  return [...lines, own].filter(Boolean).join("\n") || null;
}
