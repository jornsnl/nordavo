function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Omgevingsvariabele ${name} ontbreekt. Kopieer .env.example naar .env.local en vul de waarden in.`,
    );
  }
  return value;
}

// NEXT_PUBLIC_ variables must be referenced literally so Next.js can inline them.
export const env = {
  supabaseUrl: () =>
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: () =>
    required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};
