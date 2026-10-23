import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";

/**
 * Supabase client with the secret (service role) key. Bypasses RLS, so only
 * use it in Server Actions after an explicit requireAdmin() check, and never
 * import it from a Client Component.
 *
 * Returns null when SUPABASE_SECRET_KEY is not set.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) return null;

  return createClient<Database>(env.supabaseUrl(), secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Whether invites can be sent from the app. */
export function hasAdminClient() {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}
