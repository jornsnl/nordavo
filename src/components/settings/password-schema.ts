import { z } from "zod";

/** New password with confirmation, shared by settings and /auth/wachtwoord. */
export const passwordSchema = z
  .object({
    password: z
      .string({ error: "Kies een wachtwoord van minimaal 8 tekens" })
      .min(8, { error: "Kies een wachtwoord van minimaal 8 tekens" })
      .max(72, { error: "Maximaal 72 tekens" }),
    confirm: z.string({ error: "Herhaal je wachtwoord" }),
  })
  .refine((v) => v.password === v.confirm, {
    error: "De wachtwoorden zijn niet hetzelfde",
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
      return "Dit is je huidige wachtwoord. Kies een nieuw wachtwoord.";
    case "weak_password":
      return "Dit wachtwoord is te zwak. Kies een langer of minder voorspelbaar wachtwoord.";
    case "reauthentication_needed":
      return "Log opnieuw in en probeer het daarna nog een keer.";
    default:
      return "Er ging iets mis. Probeer het opnieuw.";
  }
}
