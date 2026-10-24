import type { z } from "zod";

/** Return shape of every form server action, consumed with useActionState. */
export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

export const initialActionState: ActionState = {};

/** Map zod issues to one Dutch message per field. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !result[key]) result[key] = issue.message;
  }
  return result;
}

/** Turn FormData into a plain object; empty strings become undefined. */
export function formValues(formData: FormData): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    values[key] = trimmed === "" ? undefined : trimmed;
  }
  return values;
}

/** "react, node , postgres" -> ["react", "node", "postgres"] */
export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export const GENERIC_ERROR = "Er ging iets mis. Probeer het opnieuw.";
