import "server-only";
import { hasModule, isStaff, type CurrentUser } from "@/lib/auth";
import { recordKey, resolveRecords } from "@/lib/data/search";
import { entityTypes } from "@/lib/labels";
import { moduleForEntity } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import type { WorkTaskLinkRow } from "@/lib/work/database";

/**
 * Work tasks on portal records (clients, leads, vacancies, candidates,
 * applications, placements). Only the Nordavo team with the module of a
 * record sees the link, the record and its primary contact. Everything here
 * reads as the signed-in user, so RLS on work_task_links, contacts and
 * client_contacts applies as well; for anyone else these return nothing.
 */

export type RecordType = WorkTaskLinkRow["entity_type"];

export const recordTypes: RecordType[] = ["company", "client", "vacancy", "candidate", "placement", "application"];

export type TaskRecord = {
  type: RecordType;
  id: string;
  /** "Lead", "Client", ... */
  typeLabel: string;
  /** Name of the record, null when it is gone or out of reach. */
  label: string | null;
  sublabel: string | null;
  href: string | null;
};

export type PrimaryContact = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
};

export function isRecordType(value: unknown): value is RecordType {
  return typeof value === "string" && (recordTypes as string[]).includes(value);
}

/** Whether this user may see and set links to this kind of record. Mirrors work_private.can_link. */
export function canUseRecordType(user: CurrentUser, type: RecordType): boolean {
  if (!isStaff(user)) return false;
  const mod = moduleForEntity(type);
  return mod !== null && hasModule(user, mod);
}

/** Record types this user may link a task to (empty for guests and freelancers). */
export function linkableRecordTypes(user: CurrentUser): RecordType[] {
  return recordTypes.filter((type) => canUseRecordType(user, type));
}

/** Label and link of records, as far as this team member may see them. */
export async function describeRecords(
  user: CurrentUser,
  refs: { type: RecordType; id: string }[],
): Promise<Map<string, TaskRecord>> {
  const result = new Map<string, TaskRecord>();
  const allowed = refs.filter((r) => canUseRecordType(user, r.type));
  if (allowed.length === 0) return result;
  const resolved = await resolveRecords(allowed);
  for (const ref of allowed) {
    const hit = resolved.get(recordKey(ref.type, ref.id));
    result.set(recordKey(ref.type, ref.id), {
      type: ref.type,
      id: ref.id,
      typeLabel: entityTypes[ref.type].label,
      label: hit?.label ?? null,
      sublabel: hit?.sublabel ?? null,
      href: hit?.href ?? null,
    });
  }
  return result;
}

/** The linked record per task id. Guests get an empty map without a query. */
export async function loadTaskRecords(user: CurrentUser, taskIds: string[]): Promise<Map<string, TaskRecord>> {
  const result = new Map<string, TaskRecord>();
  const ids = [...new Set(taskIds)];
  if (ids.length === 0 || linkableRecordTypes(user).length === 0) return result;
  const supabase = await createClient();
  const links: { task_id: string; entity_type: RecordType; entity_id: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("work_task_links")
      .select("task_id, entity_type, entity_id")
      .in("task_id", ids.slice(i, i + 200));
    if (error) throw new Error(`Loading linked records failed: ${error.message}`);
    links.push(...(data ?? []));
  }
  const visible = links.filter((l) => canUseRecordType(user, l.entity_type));
  const records = await describeRecords(
    user,
    visible.map((l) => ({ type: l.entity_type, id: l.entity_id })),
  );
  for (const link of visible) {
    const record = records.get(recordKey(link.entity_type, link.entity_id));
    if (record) result.set(link.task_id, record);
  }
  return result;
}

/**
 * The primary contact of leads (contacts.is_primary) and clients
 * (client_contacts.is_primary), keyed by recordKey(type, id). Other record
 * types have none.
 */
export async function loadPrimaryContacts(
  user: CurrentUser,
  refs: { type: RecordType; id: string }[],
): Promise<Map<string, PrimaryContact>> {
  const result = new Map<string, PrimaryContact>();
  const idsOf = (type: RecordType) =>
    canUseRecordType(user, type) ? [...new Set(refs.filter((r) => r.type === type).map((r) => r.id))].slice(0, 200) : [];
  const companyIds = idsOf("company");
  const clientIds = idsOf("client");
  if (companyIds.length === 0 && clientIds.length === 0) return result;
  const supabase = await createClient();

  await Promise.all([
    companyIds.length > 0 &&
      supabase
        .from("contacts")
        .select("company_id, first_name, last_name, title, email, phone, linkedin_url")
        .in("company_id", companyIds)
        .eq("is_primary", true)
        .then(({ data }) => {
          for (const c of data ?? []) {
            const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
            result.set(recordKey("company", c.company_id), {
              name: name || c.email || "Unnamed contact",
              title: c.title,
              email: c.email,
              phone: c.phone,
              linkedinUrl: c.linkedin_url,
            });
          }
        }),
    clientIds.length > 0 &&
      supabase
        .from("client_contacts")
        .select("client_id, full_name, job_title, email, phone")
        .in("client_id", clientIds)
        .eq("is_primary", true)
        .order("created_at")
        .then(({ data }) => {
          for (const c of data ?? []) {
            const key = recordKey("client", c.client_id);
            if (result.has(key)) continue;
            result.set(key, {
              name: c.full_name,
              title: c.job_title,
              email: c.email,
              phone: c.phone,
              linkedinUrl: null,
            });
          }
        }),
  ]);
  return result;
}
