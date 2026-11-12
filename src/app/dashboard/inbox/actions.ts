"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModule } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import type { TriageDestination } from "@/lib/sales/flow-database";
import { amsterdamDate } from "@/lib/sales/status";
import { triageInputError } from "@/lib/sales/triage";
import { createClient } from "@/lib/supabase/server";

// Triage of incoming leads (feedback Julius, 038aa8ea): one destination for
// one lead or a selection, through public.sales_triage, which applies the
// rules (one bucket per lead, occupied leads not in a second campaign) and
// logs every move in Activities.

export type TriageOptions = {
  callLists: { id: string; name: string }[];
  callers: { id: string; name: string }[];
  campaigns: { id: string; name: string; channel: "mail" | "linkedin"; provider: string }[];
};

/** What the triage picker offers: call lists, active callers and running campaigns. */
export async function loadTriageOptions(): Promise<TriageOptions> {
  await requireModule("sales");
  const db = await createClient();
  const [lists, callers, campaigns] = await Promise.all([
    db.from("sales_views").select("id, name").eq("is_call_list", true).order("position").order("name"),
    db.from("callers").select("id, name").eq("status", "active").order("name"),
    db.from("campaigns").select("id, name, channel, provider, status").in("channel", ["mail", "linkedin"]).neq("status", "finished").order("name"),
  ]);
  return {
    callLists: lists.data ?? [],
    callers: callers.data ?? [],
    campaigns: (campaigns.data ?? []).map((c) => ({ id: c.id, name: c.name, channel: c.channel as "mail" | "linkedin", provider: c.provider })),
  };
}

const destinations = ["incoming", "find_number", "call", "mail_campaign", "linkedin_campaign", "parked", "no_go", "free"] as const satisfies TriageDestination[];

const triageSchema = z.object({
  companyIds: z.array(z.guid()).min(1, "Select at least one lead.").max(2000),
  destination: z.enum(destinations),
  viewId: z.guid().nullish(),
  callerId: z.guid().nullish(),
  campaignId: z.guid().nullish(),
  until: z.string().nullish(),
  reason: z.string().trim().max(2000).nullish(),
  force: z.boolean().optional(),
});

export type TriageInput = z.input<typeof triageSchema>;
export type TriageOutcome =
  | { ok: true; message: string; skipped: { id: string; name: string; reason: string }[] }
  | { ok: false; error: string };

function friendly(message: string) {
  if (/already in the campaign/i.test(message)) return message.replace(/^.*?(This lead)/, "$1");
  if (/No access to sales/.test(message)) return "You have no access to sales.";
  if (/does not exist|schema cache/.test(message)) return "Triage is not set up yet: apply the latest database migrations.";
  return message.length < 200 ? message : "The leads could not be moved.";
}

export async function triageLeads(input: TriageInput): Promise<TriageOutcome> {
  await requireModule("sales");
  const parsed = triageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the destination." };
  const v = parsed.data;
  const problem = triageInputError(v.destination, v, amsterdamDate());
  if (problem) return { ok: false, error: problem };

  const db = await createClient();
  const { data, error } = await db.rpc("sales_triage", {
    p_companies: [...new Set(v.companyIds)],
    p_destination: v.destination,
    p_options: {
      view_id: v.viewId ?? null,
      caller_id: v.callerId ?? null,
      campaign_id: v.campaignId ?? null,
      until: v.until ?? null,
      reason: v.reason ?? null,
      force: v.force ?? false,
    } as Json,
    p_source: "handmatig",
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/leads", "layout");
  const moved = data?.moved ?? 0;
  const skipped = data?.skipped ?? [];
  const message =
    `${moved} ${moved === 1 ? "lead" : "leads"} moved.` +
    (skipped.length ? ` ${skipped.length} skipped: ${skipped.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join(", ")}${skipped.length > 3 ? ", ..." : ""}.` : "");
  return { ok: true, message, skipped };
}

const campaignSchema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(200),
  channel: z.enum(["mail", "linkedin"]),
  externalId: z.string().trim().max(300).nullish(),
});

/** A campaign to triage leads into; Claude links it to Instantly or Seleqt. */
export async function createCampaign(input: z.input<typeof campaignSchema>): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireModule("sales");
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the campaign." };
  const db = await createClient();
  const { data, error } = await db
    .from("campaigns")
    .insert({
      name: parsed.data.name,
      channel: parsed.data.channel,
      provider: parsed.data.channel === "mail" ? "instantly" : "seleqt",
      external_id: parsed.data.externalId || null,
      status: "active",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/dashboard/sequences/campaigns");
  return { ok: true, id: data.id };
}
