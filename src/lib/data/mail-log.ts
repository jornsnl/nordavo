import "server-only";
import { requireAdmin } from "@/lib/auth";
import type { MailLogStatus, Tables } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const MAIL_LOG_PAGE = 50;

export const mailLogStatuses: { value: MailLogStatus; label: string; tone: "success" | "danger" | "warning" }[] = [
  { value: "sent", label: "Sent", tone: "success" },
  { value: "failed", label: "Failed", tone: "danger" },
  { value: "not_configured", label: "Not sent", tone: "warning" },
];

export function isMailLogStatus(value: unknown): value is MailLogStatus {
  return mailLogStatuses.some((s) => s.value === value);
}

export type MailLogItem = Pick<
  Tables<"mail_log">,
  "id" | "created_at" | "category" | "status" | "from_address" | "to_addresses" | "cc_addresses" | "subject" | "error"
>;

/** Newest first; `before` is the created_at of the last row of the previous page. Admins only (RLS too). */
export async function listMailLog({
  status,
  category,
  q,
  before,
}: {
  status?: MailLogStatus;
  category?: string;
  q?: string;
  before?: string;
}): Promise<{ items: MailLogItem[]; hasMore: boolean }> {
  await requireAdmin();
  const supabase = await createClient();
  let query = supabase
    .from("mail_log")
    .select("id, created_at, category, status, from_address, to_addresses, cc_addresses, subject, error")
    .order("created_at", { ascending: false })
    .limit(MAIL_LOG_PAGE + 1);
  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  if (before) query = query.lt("created_at", before);
  const term = q?.trim().toLowerCase().replace(/[%,()*\\]/g, "");
  if (term) {
    // A recipient is matched exactly (array contains), the subject partly.
    query = query.or(`subject.ilike.%${term}%,to_addresses.cs.{${term}}`);
  }
  const { data, error } = await query;
  if (error) {
    console.error("listMailLog", error.code, error.message);
    throw new Error("The mail log could not be loaded.");
  }
  const rows = data ?? [];
  return { items: rows.slice(0, MAIL_LOG_PAGE), hasMore: rows.length > MAIL_LOG_PAGE };
}

export async function getMailLogEntry(id: string): Promise<Tables<"mail_log"> | null> {
  await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("mail_log").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("getMailLogEntry", error.code, error.message);
    return null;
  }
  return data;
}
