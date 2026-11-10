/** Return shape of the content module's form actions (English). */
export type ContentActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Optional id of what was created, for the client to continue with. */
  id?: string;
};

export const CONTENT_GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * The content triggers and functions raise short English messages for the
 * rules they enforce (P0001, and 42501 for "not allowed"). Those are safe to
 * show. A refused row (RLS) gets a plain "not allowed"; anything else a
 * generic message.
 */
export function contentErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return CONTENT_GENERIC_ERROR;
  if (error.message?.includes("row-level security")) return "You are not allowed to do that here.";
  if (error.code === "23505") return "That already exists.";
  if (error.code && ["P0001", "P0002", "42501"].includes(error.code) && error.message) return error.message;
  return CONTENT_GENERIC_ERROR;
}
