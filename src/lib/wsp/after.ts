import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processWspOutbox } from "./outbox";

/**
 * Send the Working Style Profile mail the database just queued, after the
 * response (invitation, permission request, withdrawal, completed). Without
 * SUPABASE_SECRET_KEY the hourly job wsp-mail sends it once the key is there.
 * Never fails the action.
 */
export function sendWspMailAfter(assessmentIds?: string[]) {
  const admin = createAdminClient();
  if (!admin) return;
  after(async () => {
    try {
      await processWspOutbox(admin, { assessmentIds, limit: 50 });
    } catch (cause) {
      console.error("wsp mail after action", cause);
    }
  });
}
