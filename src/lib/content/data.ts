import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, homePathFor, type CurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ContentFieldEntity,
  ContentOptionList,
  ContentRole,
} from "@/lib/content/database";
import {
  fieldDefFrom,
  parseModules,
  type FieldDef,
  type ModuleSettings,
  type StatusDef,
  type Transition,
} from "@/lib/content/rules";
import type { Json } from "@/lib/database.types";

/**
 * Core data access of the content module. Every query runs as the signed-in
 * user, so RLS decides what comes back. Area specific reads live next to
 * this file (ideas.ts, posts.ts, media.ts, results.ts, ...); writes are
 * server actions in src/app/content/actions/*.
 */

export const CONTENT_BUCKET = "content";

export type ContentUser = CurrentUser & { isAdmin: boolean };

/**
 * Team members and Work accounts (external, such as a freelance reviewer)
 * may open Content; memberships decide what they see. Clients, callers,
 * developers and candidates are sent home (the database refuses them too).
 */
export const requireContentUser = cache(async (): Promise<ContentUser> => {
  const user = await getCurrentUser();
  if (user.role !== "admin" && user.role !== "member" && user.role !== "external") redirect(homePathFor(user));
  return { ...user, isAdmin: user.role === "admin" };
});

export function check<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`Loading ${what} failed: ${result.error.message}`);
  return (result.data ?? []) as NonNullable<T>;
}

export type Person = { id: string; name: string; email: string | null };

/** Names for a set of user ids, as far as RLS lets this user see them. */
export async function peopleById(ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, Person>();
  if (unique.length === 0) return map;
  const supabase = await createClient();
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unique.slice(i, i + 200));
    for (const row of data ?? []) {
      map.set(row.id, { id: row.id, name: row.full_name || row.email?.split("@")[0] || "Someone", email: row.email });
    }
  }
  return map;
}

export function personName(people: Map<string, Person>, id: string | null | undefined, fallback = "Someone") {
  return (id && people.get(id)?.name) || fallback;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export type ContentWorkspaceItem = {
  id: string;
  name: string;
  slug: string;
  role: ContentRole;
  ownerId: string | null;
  archived: boolean;
  modules: ModuleSettings;
};

/** Workspaces the user can open, with their role in each (admins: every workspace). */
export const listMyContentWorkspaces = cache(async (): Promise<ContentWorkspaceItem[]> => {
  const user = await requireContentUser();
  const supabase = await createClient();
  const [workspaces, members] = await Promise.all([
    supabase.from("content_workspaces").select("id, name, slug, owner_id, archived_at, modules").order("name"),
    supabase.from("content_members").select("workspace_id, role").eq("user_id", user.id),
  ]);
  const roles = new Map(check(members, "memberships").map((m) => [m.workspace_id, m.role]));
  return check(workspaces, "workspaces")
    .map((w) => {
      const role: ContentRole | undefined = user.isAdmin ? "admin" : roles.get(w.id);
      return role
        ? {
            id: w.id,
            name: w.name,
            slug: w.slug,
            role,
            ownerId: w.owner_id,
            archived: Boolean(w.archived_at),
            modules: parseModules(w.modules),
          }
        : null;
    })
    .filter((w): w is ContentWorkspaceItem => w !== null && (!w.archived || user.isAdmin));
});

export type OptionItem = { value: string; label: string; position: number; meta: Record<string, unknown>; archived: boolean };

export type ContentWorkspace = ContentWorkspaceItem & {
  rhythmGoal: number;
  bufferMin: number;
  bufferMax: number;
  successThreshold: number;
  mediaReuseMonths: number;
  adminApprovalRequired: boolean;
  /** Every option per list, archived ones included (for labels of old posts). */
  options: Record<ContentOptionList, OptionItem[]>;
  statuses: (StatusDef & { archived: boolean })[];
  transitions: Transition[];
  fields: Record<ContentFieldEntity, (FieldDef & { id: string; archived: boolean; position: number })[]>;
  /** Whether this user may change settings (author of the workspace or admin). */
  canManage: boolean;
  /** Whether this user writes (author, reviewer or admin): viewers only read. */
  canWrite: boolean;
};

function metaObject(value: Json): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A workspace with its settings and configuration, or 404. */
export const getContentWorkspace = cache(async (slug: string): Promise<ContentWorkspace> => {
  const workspaces = await listMyContentWorkspaces();
  const item = workspaces.find((w) => w.slug === slug);
  if (!item) notFound();
  const supabase = await createClient();
  const [workspace, options, statuses, transitions, fields] = await Promise.all([
    supabase.from("content_workspaces").select("*").eq("id", item.id).single(),
    supabase.from("content_options").select("*").eq("workspace_id", item.id).order("position").order("label"),
    supabase.from("content_statuses").select("*").eq("workspace_id", item.id).order("position"),
    supabase.from("content_workflow_transitions").select("*").eq("workspace_id", item.id),
    supabase.from("content_field_definitions").select("*").eq("workspace_id", item.id).order("position").order("label"),
  ]);
  const ws = check(workspace, "workspace");
  const grouped = {
    channel: [],
    language: [],
    audience: [],
    theme: [],
    angle: [],
    format: [],
    priority: [],
    time_slot: [],
    platform: [],
  } as Record<ContentOptionList, OptionItem[]>;
  for (const o of check(options, "options")) {
    grouped[o.list_key].push({ value: o.value, label: o.label, position: o.position, meta: metaObject(o.meta), archived: Boolean(o.archived_at) });
  }
  const fieldsBy = { post: [], idea: [], media: [] } as ContentWorkspace["fields"];
  for (const f of check(fields, "fields")) {
    fieldsBy[f.entity].push({ ...fieldDefFrom(f), id: f.id, archived: Boolean(f.archived_at), position: f.position });
  }
  return {
    ...item,
    rhythmGoal: ws.rhythm_goal,
    bufferMin: ws.buffer_min,
    bufferMax: ws.buffer_max,
    successThreshold: ws.success_threshold,
    mediaReuseMonths: ws.media_reuse_months,
    adminApprovalRequired: ws.admin_approval_required,
    options: grouped,
    statuses: check(statuses, "statuses").map((s) => ({
      key: s.key,
      label: s.label,
      position: s.position,
      isCore: s.is_core,
      allowedRoles: s.allowed_roles,
      archived: Boolean(s.archived_at),
    })),
    transitions: check(transitions, "transitions").map((t) => ({ from: t.from_status, to: t.to_status })),
    fields: fieldsBy,
    canManage: item.role === "admin" || item.role === "author",
    canWrite: item.role !== "viewer",
  };
});

/** Label of an option value; archived options keep their label, unknown values show as stored. */
export function optionLabel(workspace: ContentWorkspace, list: ContentOptionList, value: string | null | undefined): string | null {
  if (!value) return null;
  return workspace.options[list].find((o) => o.value === value)?.label ?? value;
}

/** Options to offer in a dropdown: active ones, plus the current value if it was archived. */
export function activeOptions(workspace: ContentWorkspace, list: ContentOptionList, current?: string | null): OptionItem[] {
  return workspace.options[list].filter((o) => !o.archived || o.value === current);
}

export function statusLabel(workspace: ContentWorkspace, key: string): string {
  return workspace.statuses.find((s) => s.key === key)?.label ?? key;
}

export function formatNeedsMedia(workspace: ContentWorkspace, format: string | null | undefined): boolean {
  if (!format) return false;
  return workspace.options.format.find((o) => o.value === format)?.meta.needs_media === true;
}

/** Workspace pages of a switched off module answer 404. */
export function requireModule(workspace: ContentWorkspace, module: keyof ModuleSettings) {
  if (!workspace.modules[module]) notFound();
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** The secret key client; throws when SUPABASE_SECRET_KEY is missing. */
export function requireAdminClient() {
  const admin = createAdminClient();
  if (!admin) throw new Error("SUPABASE_SECRET_KEY is missing: files and mails of Content need it.");
  return admin;
}

/**
 * Signed URLs (valid for an hour) for files the caller already proved access
 * to by loading their row through RLS. Uses the secret key: the bucket has no
 * policies for signed-in users.
 */
export async function signedUrls(paths: (string | null | undefined)[], expiresIn = 3600): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const admin = createAdminClient();
  if (!admin) return map;
  for (let i = 0; i < unique.length; i += 100) {
    const { data } = await admin.storage.from(CONTENT_BUCKET).createSignedUrls(unique.slice(i, i + 100), expiresIn);
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) map.set(row.path, row.signedUrl);
    }
  }
  return map;
}

/** Unread notifications for the menu badge. */
export const countUnreadNotifications = cache(async (): Promise<number> => {
  const user = await requireContentUser();
  const supabase = await createClient();
  const { count } = await supabase
    .from("content_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);
  return count ?? 0;
});
