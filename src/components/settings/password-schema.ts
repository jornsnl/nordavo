import { z } from "zod";

/** New password with confirmation, shared by settings and /auth/password. */
export const passwordSchema = z
  .object({
    password: z
      .string({ error: "Choose a password of at least 8 characters" })
      .min(8, { error: "Choose a password of at least 8 characters" })
      .max(72, { error: "At most 72 characters" }),
    confirm: z.string({ error: "Repeat your password" }),
  })
  .refine((v) => v.password === v.confirm, {
    error: "The passwords do not match",
    path: ["confirm"],
  });

/** Password fields are not trimmed: spaces are part of a password. */
export function passwordValues(formData: FormData) {
  const read = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  return { password: read("password"), confirm: read("confirm") };
}

/** Dutch message for a failed supabase.auth.updateUser({ password }). */
export function passwordErrorMessage(code: string | undefined) {
  switch (code) {
    case "same_password":
      return "This is your current password. Choose a new password.";
    case "weak_password":
      return "This password is too weak. Choose a longer or less predictable password.";
    case "reauthentication_needed":
      return "Sign in again and then try once more.";
    default:
      return "Something went wrong. Try again.";
  }
}
