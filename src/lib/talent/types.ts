import type { ActionState } from "@/lib/action-state";
import type { VacancyExtraction } from "@/lib/ai/prompts/vacancy";

/** ActionState for talent actions: a warning keeps the success but flags a side effect that failed. */
export type TalentActionState = ActionState & { warning?: string };

/** Result of T1: Claude's extraction, shown as an editable form before saving. */
export type IntakeState = ActionState & { extraction?: VacancyExtraction; rawText?: string };
