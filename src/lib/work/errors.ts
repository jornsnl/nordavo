/** Return shape of the task tool's form actions (English, unlike the portal's ActionState). */
export type WorkActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

export const WORK_GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * The work_* database functions raise short English messages for the rules
 * they enforce (P0001, plus 42501 for "not allowed" and P0002 for "not
 * found"). Those are safe to show; anything else gets a generic message.
 */
export function workErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return WORK_GENERIC_ERROR;
  if (error.code && ["P0001", "P0002", "42501"].includes(error.code) && error.message) {
    return error.message;
  }
  return WORK_GENERIC_ERROR;
}
