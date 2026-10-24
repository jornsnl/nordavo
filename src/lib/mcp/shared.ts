import "server-only";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import type { McpTokenContext } from "@/lib/mcp/tokens";

/** The admin (secret key) client. Every query scopes itself explicitly. */
export type McpDb = SupabaseClient<Database>;

export type McpToolContext = McpTokenContext & { db: McpDb; siteUrl: string };

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)
  .describe(`Maximum number of rows (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`);

export const offsetSchema = z
  .number()
  .int()
  .min(0)
  .max(10_000)
  .default(0)
  .describe("Rows to skip, for paging.");

export const idSchema = z.guid().describe("Record id (uuid).");

/** Record types that tasks and notes can be linked to. */
export const linkableTypes = ["client", "vacancy", "candidate", "application", "placement", "company"] as const;
export type LinkableType = (typeof linkableTypes)[number];

/** Compact JSON text result. */
export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Throws a short error for a failed query; the SDK turns it into an isError result. */
export function check<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`${what} laden mislukt: ${result.error.message}`);
  return (result.data ?? []) as NonNullable<T>;
}

/**
 * Free text to a safe ilike pattern. Characters with a meaning in PostgREST
 * filter strings are dropped, wildcards are escaped. Null when too short.
 */
export function searchPattern(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[,()"'*:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (cleaned.length < 2) return null;
  return `%${cleaned.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** Today's date (YYYY-MM-DD) in Amsterdam, plus an offset in days. */
export function amsterdamDate(offsetDays = 0, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

export function daysSince(date: string, until: string | Date = new Date()): number {
  return Math.max(0, Math.floor((new Date(until).getTime() - new Date(date).getTime()) / 86_400_000));
}

export function personName(p: { full_name: string | null; email: string | null } | null | undefined) {
  if (!p) return null;
  return p.full_name || p.email || null;
}

/** Shorten long text so results stay compact. */
export function clip(value: string | null | undefined, max = 2000): string | null {
  if (value === null || value === undefined) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Link to a record in the portal, so Claude can hand the user a URL. */
export function recordUrl(siteUrl: string, type: string, id: string): string | null {
  const base = siteUrl.replace(/\/$/, "");
  switch (type) {
    case "client":
      return `${base}/dashboard/klanten/${id}`;
    case "vacancy":
      return `${base}/dashboard/vacatures/${id}`;
    case "candidate":
      return `${base}/dashboard/kandidaten/${id}`;
    case "placement":
      return `${base}/dashboard/plaatsingen/${id}`;
    case "company":
      return `${base}/dashboard/leads/${id}`;
    case "task":
      return `${base}/dashboard/taken`;
    default:
      return null;
  }
}

/** Short labels for a mixed list of records, in a few queries. Missing records are left out. */
export async function resolveLabels(
  db: McpDb,
  refs: { type: string; id: string }[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const idsOf = (type: string) => [...new Set(refs.filter((r) => r.type === type).map((r) => r.id))].slice(0, 200);
  const key = (type: string, id: string) => `${type}:${id}`;

  const jobs: PromiseLike<void>[] = [];
  const clients = idsOf("client");
  if (clients.length)
    jobs.push(
      db.from("clients").select("id, name").in("id", clients).then(({ data }) => {
        for (const r of data ?? []) labels.set(key("client", r.id), r.name);
      }),
    );
  const companies = idsOf("company");
  if (companies.length)
    jobs.push(
      db.from("companies").select("id, name").in("id", companies).then(({ data }) => {
        for (const r of data ?? []) labels.set(key("company", r.id), r.name);
      }),
    );
  const vacancies = idsOf("vacancy");
  if (vacancies.length)
    jobs.push(
      db.from("vacancies").select("id, title").in("id", vacancies).then(({ data }) => {
        for (const r of data ?? []) labels.set(key("vacancy", r.id), r.title);
      }),
    );
  const candidates = idsOf("candidate");
  if (candidates.length)
    jobs.push(
      db.from("candidates").select("id, full_name").in("id", candidates).then(({ data }) => {
        for (const r of data ?? []) labels.set(key("candidate", r.id), r.full_name);
      }),
    );
  const placements = idsOf("placement");
  if (placements.length)
    jobs.push(
      db
        .from("placements")
        .select("id, candidate:candidates(full_name), client:clients(name)")
        .in("id", placements)
        .then(({ data }) => {
          for (const r of data ?? []) {
            labels.set(key("placement", r.id), `${r.candidate?.full_name ?? "Plaatsing"} bij ${r.client?.name ?? "?"}`);
          }
        }),
    );
  const applications = idsOf("application");
  if (applications.length)
    jobs.push(
      db
        .from("applications")
        .select("id, candidate:candidates(full_name), vacancy:vacancies(title)")
        .in("id", applications)
        .then(({ data }) => {
          for (const r of data ?? []) {
            labels.set(key("application", r.id), `${r.candidate?.full_name ?? "?"} voor ${r.vacancy?.title ?? "?"}`);
          }
        }),
    );
  const tasks = idsOf("task");
  if (tasks.length)
    jobs.push(
      db.from("tasks").select("id, title").in("id", tasks).then(({ data }) => {
        for (const r of data ?? []) labels.set(key("task", r.id), r.title);
      }),
    );

  await Promise.all(jobs);
  return labels;
}

/** Whether a record a task or note points at exists. */
export async function recordExists(db: McpDb, type: LinkableType, id: string): Promise<boolean> {
  const table = {
    client: "clients",
    vacancy: "vacancies",
    candidate: "candidates",
    application: "applications",
    placement: "placements",
    company: "companies",
  } as const satisfies Record<LinkableType, keyof Database["public"]["Tables"]>;
  const { data, error } = await db.from(table[type]).select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`Record controleren mislukt: ${error.message}`);
  return Boolean(data);
}
