import "server-only";
import type { ActivityChannel, ActivityOutcome } from "@/lib/database.types";
import { requireModule } from "@/lib/auth";
import type { LeadStatus, PartnerStatus, PipelineStage } from "@/lib/sales/database";
import { createClient } from "@/lib/supabase/server";

/** Partners: people who bring in leads (feedback Julius). Their leads are companies with partner_id. */

export type PartnerListItem = {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  status: PartnerStatus;
  ownerName: string | null;
  lastContactAt: string | null;
  leads: number;
  inPipeline: number;
  won: number;
};

async function teamNames(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("role", ["admin", "member"]);
  return new Map((data ?? []).map((p) => [p.id, p.full_name || p.email || "Team member"]));
}

export async function listPartners(options: { status?: PartnerStatus | "all" } = {}): Promise<PartnerListItem[]> {
  await requireModule("sales");
  const supabase = await createClient();
  let q = supabase
    .from("partners")
    .select("id, name, company_name, email, phone, status, owner_id, last_contact_at")
    .order("name");
  if (options.status && options.status !== "all") q = q.eq("status", options.status);
  const [{ data: partners, error }, { data: leads, error: leadsError }, names] = await Promise.all([
    q,
    supabase.from("companies").select("partner_id, pipeline_stage").not("partner_id", "is", null).limit(10000),
    teamNames(),
  ]);
  if (error) throw new Error(`Could not load partners: ${error.message}`);
  if (leadsError) throw new Error(`Could not load leads: ${leadsError.message}`);
  return partners.map((p) => {
    const own = leads.filter((l) => l.partner_id === p.id);
    return {
      id: p.id,
      name: p.name,
      companyName: p.company_name,
      email: p.email,
      phone: p.phone,
      status: p.status,
      ownerName: p.owner_id ? (names.get(p.owner_id) ?? null) : null,
      lastContactAt: p.last_contact_at,
      leads: own.length,
      inPipeline: own.filter((l) => l.pipeline_stage && l.pipeline_stage !== "won" && l.pipeline_stage !== "lost").length,
      won: own.filter((l) => l.pipeline_stage === "won").length,
    };
  });
}

export type PartnerDetail = {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  status: PartnerStatus;
  ownerId: string | null;
  ownerName: string | null;
  lastContactAt: string | null;
  createdAt: string;
  leads: {
    id: string;
    name: string;
    leadStatus: LeadStatus;
    pipelineStage: PipelineStage | null;
    city: string | null;
    createdAt: string;
  }[];
  moments: {
    id: string;
    date: string;
    channel: ActivityChannel;
    outcome: ActivityOutcome | null;
    direction: "inbound" | "outbound" | null;
    notes: string | null;
    byName: string | null;
  }[];
};

export async function getPartner(id: string): Promise<PartnerDetail | null> {
  await requireModule("sales");
  const supabase = await createClient();
  const { data: p, error } = await supabase
    .from("partners")
    .select("id, name, company_name, email, phone, linkedin_url, notes, status, owner_id, last_contact_at, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the partner: ${error.message}`);
  if (!p) return null;
  const [leads, moments, names] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, lead_status, pipeline_stage, city, created_at")
      .eq("partner_id", id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("activities")
      .select("id, date, channel, outcome, direction, notes, created_by")
      .eq("partner_id", id)
      .in("type", ["contact", "note", "meeting", "reply"])
      .order("date", { ascending: false })
      .limit(100),
    teamNames(),
  ]);
  if (leads.error) throw new Error(`Could not load leads: ${leads.error.message}`);
  if (moments.error) throw new Error(`Could not load contact moments: ${moments.error.message}`);
  return {
    id: p.id,
    name: p.name,
    companyName: p.company_name,
    email: p.email,
    phone: p.phone,
    linkedinUrl: p.linkedin_url,
    notes: p.notes,
    status: p.status,
    ownerId: p.owner_id,
    ownerName: p.owner_id ? (names.get(p.owner_id) ?? null) : null,
    lastContactAt: p.last_contact_at,
    createdAt: p.created_at,
    leads: leads.data.map((c) => ({
      id: c.id,
      name: c.name,
      leadStatus: c.lead_status,
      pipelineStage: c.pipeline_stage,
      city: c.city,
      createdAt: c.created_at,
    })),
    moments: moments.data.map((m) => ({
      id: m.id,
      date: m.date,
      channel: m.channel,
      outcome: m.outcome,
      direction: m.direction,
      notes: m.notes,
      byName: m.created_by ? (names.get(m.created_by) ?? null) : null,
    })),
  };
}

/** Team members who can own a partner. */
export async function listTeamOptions(): Promise<{ id: string; name: string }[]> {
  await requireModule("sales");
  const names = await teamNames();
  return [...names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Partners for a select, e.g. on the lead page. */
export async function listPartnerOptions(): Promise<{ id: string; name: string; companyName: string | null }[]> {
  await requireModule("sales");
  const supabase = await createClient();
  const { data, error } = await supabase.from("partners").select("id, name, company_name").eq("status", "active").order("name");
  if (error) throw new Error(`Could not load partners: ${error.message}`);
  return data.map((p) => ({ id: p.id, name: p.name, companyName: p.company_name }));
}
