import "server-only";
import { requireStaff } from "@/lib/auth";
import type {
  CompanyStatus,
  IcpDecision,
  Segment,
  SignalSource,
  SignalType,
  SuppressionReason,
  SuppressionScope,
} from "@/lib/database.types";
import { companyStatuses, icpDecisions, segments } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { isUuid, likePattern } from "@/lib/data/clients";

export const LEADS_PAGE_SIZE = 50;

export function isSegment(value: unknown): value is Segment {
  return segments.some((s) => s.value === value);
}

export function isIcpDecision(value: unknown): value is IcpDecision {
  return icpDecisions.some((s) => s.value === value);
}

export function isCompanyStatus(value: unknown): value is CompanyStatus {
  return companyStatuses.some((s) => s.value === value);
}

/**
 * A value for a PostgREST `or=(...)` filter: commas, brackets and quotes would
 * break the filter syntax, so they are dropped before the value is quoted.
 */
export function orFilterPattern(value: string) {
  const cleaned = value.replace(/[,()"\\]/g, " ").trim();
  return `"${likePattern(cleaned)}"`;
}

export type LeadFilters = {
  q?: string;
  /** "none" lists companies Claude has not judged yet. */
  icp?: IcpDecision | "none";
  segment?: Segment;
  status?: CompanyStatus;
  /** Only companies with a signal seen in the last N days. */
  signalDays?: number;
  minScore?: number;
  sort?: "score" | "new";
  page?: number;
};

export type LeadListItem = {
  id: string;
  name: string;
  domain: string;
  segment: Segment | null;
  icpDecision: IcpDecision | null;
  icpScore: number | null;
  status: CompanyStatus;
  createdAt: string;
  contactsCount: number;
  latestSignal: { type: SignalType; title: string | null; lastSeenAt: string } | null;
  lastActivityAt: string | null;
};

export async function listLeads(filters: LeadFilters): Promise<{ items: LeadListItem[]; total: number }> {
  await requireStaff();
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  const from = (page - 1) * LEADS_PAGE_SIZE;

  let query = supabase
    .from("companies")
    .select(
      "id, name, domain, segment, icp_decision, icp_score, status, created_at, contacts(count), signals(type, title, last_seen_at), activities(date)",
      { count: "exact" },
    )
    .order("last_seen_at", { referencedTable: "signals", ascending: false })
    .limit(1, { referencedTable: "signals" })
    .order("date", { referencedTable: "activities", ascending: false })
    .limit(1, { referencedTable: "activities" });

  if (filters.q) {
    const p = orFilterPattern(filters.q);
    query = query.or(`name.ilike.${p},domain.ilike.${p}`);
  }
  if (filters.icp === "none") query = query.is("icp_decision", null);
  else if (filters.icp) query = query.eq("icp_decision", filters.icp);
  if (filters.segment) query = query.eq("segment", filters.segment);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.minScore !== undefined) query = query.gte("icp_score", filters.minScore);
  if (filters.signalDays) {
    // Filter the embedded signals, then keep only companies that still have one.
    const since = new Date(Date.now() - filters.signalDays * 86_400_000).toISOString();
    query = query.gte("signals.last_seen_at", since).not("signals", "is", null);
  }

  query =
    filters.sort === "new"
      ? query.order("created_at", { ascending: false })
      : query
          .order("icp_score", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });

  const { data, error, count } = await query.range(from, from + LEADS_PAGE_SIZE - 1);
  if (error) throw new Error(`Leads laden mislukt: ${error.message}`);

  const items = data.map((c) => {
    const signal = c.signals[0];
    return {
      id: c.id,
      name: c.name,
      domain: c.domain,
      segment: c.segment,
      icpDecision: c.icp_decision,
      icpScore: c.icp_score,
      status: c.status,
      createdAt: c.created_at,
      contactsCount: c.contacts[0]?.count ?? 0,
      latestSignal: signal
        ? { type: signal.type, title: signal.title, lastSeenAt: signal.last_seen_at }
        : null,
      lastActivityAt: c.activities[0]?.date ?? null,
    };
  });
  return { items, total: count ?? items.length };
}

/** Number of companies waiting for Julius in the review queue. */
export async function countReview(): Promise<number> {
  await requireStaff();
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .eq("icp_decision", "REVIEW");
  if (error) throw new Error(`Reviewlijst laden mislukt: ${error.message}`);
  return count ?? 0;
}

export type SignalItem = {
  id: string;
  type: SignalType;
  title: string | null;
  sourceUrl: string | null;
  source: SignalSource;
  firstSeenAt: string;
  lastSeenAt: string;
};

function toSignal(s: {
  id: string;
  type: SignalType;
  title: string | null;
  source_url: string | null;
  source: SignalSource;
  first_seen_at: string;
  last_seen_at: string;
}): SignalItem {
  return {
    id: s.id,
    type: s.type,
    title: s.title,
    sourceUrl: s.source_url,
    source: s.source,
    firstSeenAt: s.first_seen_at,
    lastSeenAt: s.last_seen_at,
  };
}

export type ReviewItem = {
  id: string;
  name: string;
  domain: string;
  website: string | null;
  legalForm: string | null;
  employees: number | null;
  sector: string | null;
  city: string | null;
  segment: Segment | null;
  icpScore: number | null;
  icpReason: string | null;
  redFlags: string[];
  openingLine: string | null;
  clientContactRisk: boolean;
  signals: SignalItem[];
};

/** The review queue: REVIEW companies, highest score first. */
export async function listReviewQueue(limit = 50): Promise<ReviewItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(
      "id, name, domain, website, legal_form, employees, sector, city, segment, icp_score, icp_reason, red_flags, opening_line, client_contact_risk, signals(id, type, title, source_url, source, first_seen_at, last_seen_at)",
    )
    .eq("icp_decision", "REVIEW")
    .order("icp_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .order("last_seen_at", { referencedTable: "signals", ascending: false })
    .limit(10, { referencedTable: "signals" })
    .limit(limit);
  if (error) throw new Error(`Reviewlijst laden mislukt: ${error.message}`);

  return data.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    website: c.website,
    legalForm: c.legal_form,
    employees: c.employees,
    sector: c.sector,
    city: c.city,
    segment: c.segment,
    icpScore: c.icp_score,
    icpReason: c.icp_reason,
    redFlags: c.red_flags,
    openingLine: c.opening_line,
    clientContactRisk: c.client_contact_risk,
    signals: c.signals.map(toSignal),
  }));
}

export async function getCompany(id: string) {
  await requireStaff();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(
      "*, reviewer:profiles!companies_reviewed_by_fkey(full_name, email), client:clients!companies_client_id_fkey(id, name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Bedrijf laden mislukt: ${error.message}`);
  return data;
}

export type CompanyDetail = NonNullable<Awaited<ReturnType<typeof getCompany>>>;

export async function getCompanySignals(companyId: string): Promise<SignalItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("signals")
    .select("id, type, title, source_url, source, first_seen_at, last_seen_at")
    .eq("company_id", companyId)
    .order("last_seen_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Signalen laden mislukt: ${error.message}`);
  return data.map(toSignal);
}

export type SuppressionItem = {
  id: string;
  companyId: string | null;
  contactId: string | null;
  email: string | null;
  reason: SuppressionReason;
  scope: SuppressionScope;
  notes: string | null;
  createdAt: string;
};

/** Suppression rows that hit this company, one of its contacts or their mail addresses. */
export async function getCompanySuppressions(
  companyId: string,
  contacts: { id: string; email: string | null }[],
): Promise<SuppressionItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const parts = [`company_id.eq.${companyId}`];
  if (contacts.length > 0) parts.push(`contact_id.in.(${contacts.map((c) => c.id).join(",")})`);
  const emails = contacts
    .map((c) => c.email)
    .filter((e): e is string => Boolean(e) && !/[,()"\\]/.test(e as string));
  if (emails.length > 0) parts.push(`email.in.(${emails.map((e) => `"${e}"`).join(",")})`);

  const { data, error } = await supabase
    .from("suppression")
    .select("id, company_id, contact_id, email, reason, scope, notes, created_at")
    .or(parts.join(","))
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Uitsluitingen laden mislukt: ${error.message}`);
  return data.map((s) => ({
    id: s.id,
    companyId: s.company_id,
    contactId: s.contact_id,
    email: s.email,
    reason: s.reason,
    scope: s.scope,
    notes: s.notes,
    createdAt: s.created_at,
  }));
}
