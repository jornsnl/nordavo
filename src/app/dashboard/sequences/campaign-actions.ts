"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModule } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { parseMemberCsv } from "@/lib/sales/campaign-import";
import { createClient } from "@/lib/supabase/server";

// Campaigns in Instantly and Seleqt (feedback Julius, 4f7fd90a): status by
// hand and the leads of a campaign from a CSV export (Seleqt has no API the
// portal knows). Members go through sales_register_campaign_members, so a
// lead in another running campaign is refused and named.

const uuid = z.guid();

export async function setCampaignStatus(id: string, status: "active" | "paused" | "finished"): Promise<{ ok: boolean; error?: string }> {
  await requireModule("sales");
  if (!uuid.safeParse(id).success || !["active", "paused", "finished"].includes(status)) return { ok: false, error: "Campaign not found." };
  const db = await createClient();
  const { error } = await db
    .from("campaigns")
    .update({ status, ended_at: status === "finished" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/sequences", "layout");
  return { ok: true };
}

/** linkedin.com/in/jane-doe as the contacts table keys it (contacts.linkedin_key). */
function linkedinKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^([a-z]{2,3}\.|www\.)?linkedin\.com/, "linkedin.com")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

export async function importCampaignMembers(
  id: string,
  text: string,
  force: boolean,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  await requireModule("sales");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Campaign not found." };
  if (typeof text !== "string" || text.length > 2_000_000) return { ok: false, error: "The list is too long." };
  const parsed = parseMemberCsv(text);
  if (parsed.error) return { ok: false, error: parsed.error };
  const db = await createClient();

  // LinkedIn links to contacts (Seleqt exports have no mail address).
  const keys = [...new Set(parsed.members.filter((m) => !m.email && m.linkedinUrl).map((m) => linkedinKey(m.linkedinUrl!)))];
  const byKey = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await db.from("contacts").select("id, linkedin_key").in("linkedin_key", keys.slice(i, i + 200));
    if (error) return { ok: false, error: error.message };
    for (const c of (data ?? []) as { id: string; linkedin_key: string | null }[]) if (c.linkedin_key) byKey.set(c.linkedin_key, c.id);
  }
  let unknown = 0;
  const members = parsed.members.flatMap((m) => {
    const contactId = !m.email && m.linkedinUrl ? byKey.get(linkedinKey(m.linkedinUrl)) : undefined;
    if (!m.email && !contactId) {
      unknown += 1;
      return [];
    }
    return [{ email: m.email, contact_id: contactId ?? null, status: m.status, replied_at: m.repliedAt, reply_outcome: m.replyOutcome }];
  });

  let added = 0;
  let updated = 0;
  let refused = 0;
  for (let i = 0; i < members.length; i += 500) {
    const { data, error } = await db.rpc("sales_register_campaign_members", {
      p_campaign: id,
      p_members: members.slice(i, i + 500) as Json,
      p_force: force,
      p_source: "import",
    });
    if (error) return { ok: false, error: error.message };
    added += data?.added ?? 0;
    updated += data?.updated ?? 0;
    unknown += data?.unknown?.length ?? 0;
    refused += data?.refused?.length ?? 0;
  }
  revalidatePath("/dashboard/sequences", "layout");
  return {
    ok: true,
    message: `${added} added, ${updated} updated${unknown ? `, ${unknown} not found as a contact` : ""}${refused ? `, ${refused} already in another running campaign` : ""}${parsed.skipped ? `, ${parsed.skipped} lines without mail or LinkedIn` : ""}.`,
  };
}
