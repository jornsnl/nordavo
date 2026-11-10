import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ContentMemberRole, ContentPrefKind } from "@/lib/content/database";
import { check, peopleById, requireContentUser, type Person } from "@/lib/content/data";
import { notificationKinds } from "@/lib/content/rules";

/**
 * Reads for the settings pages: members of a workspace with their names,
 * people an admin can add, drive folders and the personal notification
 * preferences. Every query runs as the signed-in user (RLS).
 */

export type MemberItem = Person & { role: ContentMemberRole; isOwner: boolean };

export async function listMembers(workspaceId: string, ownerId: string | null): Promise<MemberItem[]> {
  const supabase = await createClient();
  const rows = check(
    await supabase.from("content_members").select("user_id, role").eq("workspace_id", workspaceId),
    "members",
  );
  const people = await peopleById(rows.map((r) => r.user_id));
  const order: Record<ContentMemberRole, number> = { author: 0, reviewer: 1, viewer: 2 };
  return rows
    .map((r) => ({
      ...(people.get(r.user_id) ?? { id: r.user_id, name: "Someone", email: null }),
      role: r.role,
      isOwner: r.user_id === ownerId,
    }))
    .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
}

/**
 * People who can use Content (portal admins, team members and Work accounts),
 * for the member and owner pickers. Admins only: profiles of the whole team
 * are readable for staff through the portal policies.
 */
export async function listContentCandidates(): Promise<Person[]> {
  const user = await requireContentUser();
  if (!user.isAdmin) return [];
  const supabase = await createClient();
  const rows = check(
    await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .in("role", ["admin", "member", "external"])
      .order("full_name"),
    "people",
  );
  return rows.map((p) => ({ id: p.id, name: p.full_name || p.email?.split("@")[0] || "Someone", email: p.email }));
}

export type PrefItem = { kind: ContentPrefKind; label: string; for: "reviewer" | "author" | "everyone"; inApp: boolean; email: boolean };

/** Every notification kind with the user's choice (no row: in the app and by email). */
export async function listMyPrefs(): Promise<PrefItem[]> {
  const user = await requireContentUser();
  const supabase = await createClient();
  const rows = check(
    await supabase.from("content_notification_prefs").select("kind, in_app, email").eq("user_id", user.id),
    "preferences",
  );
  const stored = new Map(rows.map((r) => [r.kind, r]));
  return notificationKinds.map((k) => ({
    kind: k.value,
    label: k.label,
    for: k.for,
    inApp: stored.get(k.value)?.in_app ?? true,
    email: stored.get(k.value)?.email ?? true,
  }));
}

export type NotificationItem = {
  id: number;
  kind: string;
  message: string;
  read: boolean;
  createdAt: string;
  href: string;
  workspaceName: string | null;
};

export async function listMyNotifications(limit = 100): Promise<NotificationItem[]> {
  const user = await requireContentUser();
  const supabase = await createClient();
  const rows = check(
    await supabase
      .from("content_notifications")
      .select("id, kind, message, read_at, created_at, workspace_id, post_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit),
    "notifications",
  );
  const workspaceIds = [...new Set(rows.map((r) => r.workspace_id).filter((id): id is string => Boolean(id)))];
  const workspaces = workspaceIds.length
    ? check(await supabase.from("content_workspaces").select("id, slug, name").in("id", workspaceIds), "workspaces")
    : [];
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const items = rows.map((r) => {
    const ws = r.workspace_id ? byId.get(r.workspace_id) : undefined;
    const href = ws ? (r.post_id ? `/content/w/${ws.slug}/posts/${r.post_id}` : `/content/w/${ws.slug}`) : "/content";
    return {
      id: r.id,
      kind: r.kind,
      message: r.message,
      read: Boolean(r.read_at),
      createdAt: r.created_at,
      href,
      workspaceName: ws?.name ?? null,
    };
  });
  // Unread first, newest first within each group.
  return [...items.filter((i) => !i.read), ...items.filter((i) => i.read)];
}

export type OptionRow = {
  id: string;
  list: string;
  value: string;
  label: string;
  meta: Record<string, unknown>;
  archived: boolean;
};

/** Option rows with their ids, per list, in order (archived last). */
export async function listOptionRows(workspaceId: string): Promise<OptionRow[]> {
  const supabase = await createClient();
  const rows = check(
    await supabase.from("content_options").select("id, list_key, value, label, meta, archived_at").eq("workspace_id", workspaceId).order("position").order("label"),
    "options",
  );
  return rows
    .map((r) => ({
      id: r.id,
      list: r.list_key,
      value: r.value,
      label: r.label,
      meta: r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? (r.meta as Record<string, unknown>) : {},
      archived: Boolean(r.archived_at),
    }))
    .sort((a, b) => Number(a.archived) - Number(b.archived));
}

