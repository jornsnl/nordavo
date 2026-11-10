"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import type { ContentFieldEntity, ContentFieldType, ContentMemberRole, ContentOptionList } from "@/lib/content/database";
import { getContentWorkspace, requireContentUser } from "@/lib/content/data";
import { CONTENT_GENERIC_ERROR, contentErrorMessage, type ContentActionState } from "@/lib/content/errors";
import { checkbox, text } from "@/lib/content/forms";
import { fieldTypes, modules, optionLists, optionValue } from "@/lib/content/rules";

/**
 * Settings of a content workspace: general settings, modules, option lists,
 * extra fields, statuses and transitions (the author of the workspace and
 * admins), members, owner and archiving (admins). RLS and the triggers
 * enforce the same; these actions validate input and give clear messages.
 */

function invalid(error: z.ZodError): ContentActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { error: "Check the highlighted fields.", fieldErrors };
}

async function manage(slug: string) {
  const workspace = await getContentWorkspace(slug);
  if (!workspace.canManage) throw new Error("Only the author of this workspace and admins can change its settings.");
  return { workspace, supabase: await createClient() };
}

async function adminOf(slug: string) {
  const user = await requireContentUser();
  if (!user.isAdmin) throw new Error("Only an admin can do this.");
  const workspace = await getContentWorkspace(slug);
  return { user, workspace, supabase: await createClient() };
}

function done(slug: string, message = "Saved."): ContentActionState {
  revalidatePath(`/content/w/${slug}`, "layout");
  revalidatePath("/content", "layout");
  return { ok: true, message };
}

function failure(error: unknown): ContentActionState {
  if (error instanceof Error && /Only (the author|an admin)/.test(error.message)) return { error: error.message };
  if (error && typeof error === "object" && "message" in error) return { error: contentErrorMessage(error as { code?: string; message?: string }) };
  return { error: CONTENT_GENERIC_ERROR };
}

const int = (min: number, max: number, label: string) =>
  z.coerce.number({ error: `Enter a number for ${label}` }).int({ error: "Whole numbers only" }).min(min, { error: `At least ${min}` }).max(max, { error: `At most ${max}` });

const slugSchema = z
  .string({ error: "Add a web address" })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: "Lowercase letters, digits and dashes only" })
  .max(40, { error: "At most 40 characters" });

const nameSchema = z.string({ error: "Add a name" }).trim().min(1, { error: "Add a name" }).max(80, { error: "At most 80 characters" });

// ---------------------------------------------------------------------------
// Workspaces (admin)
// ---------------------------------------------------------------------------

export async function createContentWorkspaceAction(_prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  const user = await requireContentUser();
  if (!user.isAdmin) return { error: "Only an admin can create content workspaces." };
  const parsed = z
    .object({ name: nameSchema, slug: slugSchema, owner: z.guid().optional() })
    .safeParse({ name: formData.get("name"), slug: formData.get("slug"), owner: text(formData, "owner") ?? undefined });
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("content_create_workspace", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_owner: parsed.data.owner ?? null,
  });
  if (error) {
    if (error.code === "23505") return { error: "That web address is taken.", fieldErrors: { slug: "Already in use" } };
    return { error: contentErrorMessage(error) };
  }
  revalidatePath("/content", "layout");
  redirect(`/content/w/${parsed.data.slug}/settings`);
}

export async function saveGeneralSettingsAction(slug: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const parsed = z
      .object({
        name: nameSchema,
        rhythm_goal: int(0, 21, "the rhythm goal"),
        buffer_min: int(0, 100, "the buffer minimum"),
        buffer_max: int(0, 100, "the buffer maximum"),
        success_threshold: int(0, 100000, "the success threshold"),
        media_reuse_months: int(0, 60, "the reuse warning"),
      })
      .refine((v) => v.buffer_max >= v.buffer_min, { path: ["buffer_max"], error: "At least the minimum" })
      .safeParse(Object.fromEntries(["name", "rhythm_goal", "buffer_min", "buffer_max", "success_threshold", "media_reuse_months"].map((k) => [k, formData.get(k)])));
    if (!parsed.success) return invalid(parsed.error);
    // Only an admin decides whether new employees need admin approval.
    const update = {
      ...parsed.data,
      ...(workspace.role === "admin" ? { admin_approval_required: checkbox(formData, "admin_approval_required") } : {}),
    };
    const { error } = await supabase.from("content_workspaces").update(update).eq("id", workspace.id);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug);
  } catch (e) {
    return failure(e);
  }
}

export async function saveModulesAction(slug: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const value = Object.fromEntries(modules.map((m) => [m.value, checkbox(formData, m.value)])) as Json;
    const { error } = await supabase.from("content_workspaces").update({ modules: value }).eq("id", workspace.id);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, "Modules saved.");
  } catch (e) {
    return failure(e);
  }
}

export async function setOwnerAction(slug: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await adminOf(slug);
    const owner = z.guid().safeParse(formData.get("owner"));
    if (!owner.success) return { error: "Pick a person.", fieldErrors: { owner: "Pick a person" } };
    const { error: memberError } = await supabase
      .from("content_members")
      .upsert({ workspace_id: workspace.id, user_id: owner.data, role: "author" }, { onConflict: "workspace_id,user_id" });
    if (memberError) return { error: contentErrorMessage(memberError) };
    const { error } = await supabase.from("content_workspaces").update({ owner_id: owner.data }).eq("id", workspace.id);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, "Owner changed.");
  } catch (e) {
    return failure(e);
  }
}

export async function setWorkspaceArchivedAction(slug: string, archived: boolean): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await adminOf(slug);
    const { error } = await supabase
      .from("content_workspaces")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", workspace.id);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, archived ? "Workspace archived." : "Workspace restored.");
  } catch (e) {
    return failure(e);
  }
}

// ---------------------------------------------------------------------------
// Members (admin)
// ---------------------------------------------------------------------------

const memberRole = z.enum(["author", "reviewer", "viewer"], { error: "Pick a role" });

export async function addMemberAction(slug: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { user, workspace, supabase } = await adminOf(slug);
    const parsed = z.object({ user_id: z.guid({ error: "Pick a person" }), role: memberRole }).safeParse({
      user_id: formData.get("user_id"),
      role: formData.get("role"),
    });
    if (!parsed.success) return invalid(parsed.error);
    const { error } = await supabase
      .from("content_members")
      .upsert({ workspace_id: workspace.id, user_id: parsed.data.user_id, role: parsed.data.role, added_by: user.id }, { onConflict: "workspace_id,user_id" });
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, "Person added.");
  } catch (e) {
    return failure(e);
  }
}

export async function setMemberRoleAction(slug: string, userId: string, role: ContentMemberRole): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await adminOf(slug);
    if (!memberRole.safeParse(role).success || !z.guid().safeParse(userId).success) return { error: "Pick a role." };
    if (userId === workspace.ownerId && role !== "author") return { error: "The owner stays author. Change the owner first." };
    const { error } = await supabase.from("content_members").update({ role }).eq("workspace_id", workspace.id).eq("user_id", userId);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, "Role changed.");
  } catch (e) {
    return failure(e);
  }
}

export async function removeMemberAction(slug: string, userId: string): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await adminOf(slug);
    if (userId === workspace.ownerId) return { error: "The owner cannot be removed. Change the owner first." };
    const { error } = await supabase.from("content_members").delete().eq("workspace_id", workspace.id).eq("user_id", userId);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, "Person removed.");
  } catch (e) {
    return failure(e);
  }
}

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

const listKeys = optionLists.map((l) => l.value) as [ContentOptionList, ...ContentOptionList[]];

function weekdaysFrom(formData: FormData): number[] {
  return [...new Set(formData.getAll("weekdays").map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
}

function optionMeta(list: ContentOptionList, formData: FormData): { meta?: Json; error?: ContentActionState } {
  if (list === "format") return { meta: { needs_media: checkbox(formData, "needs_media") } };
  if (list === "time_slot") {
    const time = text(formData, "time");
    if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: { error: "Enter a time like 08:30.", fieldErrors: { time: "Use HH:MM" } } };
    return { meta: { time, weekdays: weekdaysFrom(formData) } };
  }
  return {};
}

export async function addOptionAction(slug: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const list = z.enum(listKeys).safeParse(formData.get("list_key"));
    if (!list.success) return { error: "Unknown list." };
    const label = text(formData, list.data === "time_slot" ? "time" : "label", 80) ?? text(formData, "label", 80);
    if (!label) return { error: "Add a label.", fieldErrors: { label: "Add a label" } };
    const { meta, error: metaError } = optionMeta(list.data, formData);
    if (metaError) return metaError;
    const existing = workspace.options[list.data];
    let value = list.data === "time_slot" ? `t${label.replace(/\D/g, "")}` : optionValue(label);
    if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(value)) value = `option_${existing.length + 1}`;
    for (let n = 2; existing.some((o) => o.value === value); n++) value = `${value.replace(/_\d+$/, "")}_${n}`;
    const position = existing.reduce((max, o) => Math.max(max, o.position), 0) + 10;
    const { error } = await supabase
      .from("content_options")
      .insert({ workspace_id: workspace.id, list_key: list.data, value, label, position, ...(meta ? { meta } : {}) });
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, "Option added.");
  } catch (e) {
    return failure(e);
  }
}

export async function updateOptionAction(slug: string, id: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const { data: row } = await supabase.from("content_options").select("list_key").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
    if (!row) return { error: "Option not found." };
    // A time slot is labelled with its time.
    const label = text(formData, row.list_key === "time_slot" ? "time" : "label", 80);
    if (!label) return { error: "Add a label.", fieldErrors: { label: "Add a label" } };
    const { meta, error: metaError } = optionMeta(row.list_key, formData);
    if (metaError) return metaError;
    const { error } = await supabase.from("content_options").update({ label, ...(meta ? { meta } : {}) }).eq("id", id);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug);
  } catch (e) {
    return failure(e);
  }
}

export async function setOptionArchivedAction(slug: string, id: string, archived: boolean): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const { error } = await supabase
      .from("content_options")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("workspace_id", workspace.id);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, archived ? "Archived. Old posts keep their value." : "Restored.");
  } catch (e) {
    return failure(e);
  }
}

/** Swap places with the neighbour above (-1) or below (1) in the same list. */
async function moveRow(
  table: "content_options" | "content_field_definitions",
  slug: string,
  id: string,
  direction: -1 | 1,
): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const { data: row } =
      table === "content_options"
        ? await supabase.from("content_options").select("id, list_key, position").eq("id", id).eq("workspace_id", workspace.id).maybeSingle()
        : await supabase.from("content_field_definitions").select("id, entity, position").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
    if (!row) return { error: "Not found." };
    const group = "list_key" in row ? { column: "list_key", value: row.list_key } : { column: "entity", value: (row as { entity: string }).entity };
    const { data: siblings } = await supabase
      .from(table)
      .select("id, position")
      .eq("workspace_id", workspace.id)
      .eq(group.column, group.value)
      .order("position")
      .order("id");
    const list = (siblings ?? []) as { id: string; position: number }[];
    const index = list.findIndex((s) => s.id === id);
    const other = list[index + direction];
    if (index < 0 || !other) return { ok: true };
    // Renumber the whole list, so equal positions never block a move.
    const order = list.map((s) => s.id);
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    for (const [i, rowId] of order.entries()) {
      const { error } = await supabase.from(table).update({ position: (i + 1) * 10 }).eq("id", rowId);
      if (error) return { error: contentErrorMessage(error) };
    }
    return done(slug, "Order saved.");
  } catch (e) {
    return failure(e);
  }
}

export async function moveOptionAction(slug: string, id: string, direction: -1 | 1) {
  return moveRow("content_options", slug, id, direction);
}

// ---------------------------------------------------------------------------
// Extra fields
// ---------------------------------------------------------------------------

const entities = ["post", "idea", "media"] as const satisfies readonly ContentFieldEntity[];
const types = fieldTypes.map((t) => t.value) as [ContentFieldType, ...ContentFieldType[]];

function fieldConfig(type: ContentFieldType, formData: FormData): { config?: Json; error?: ContentActionState } {
  if (type === "single_choice" || type === "multiple_choice") {
    const choices = [...new Set((text(formData, "choices", 4000) ?? "").split(/[,\n]/).map((c) => c.trim()).filter(Boolean))].slice(0, 100);
    if (choices.length === 0) return { error: { error: "Add at least one choice.", fieldErrors: { choices: "One per line or comma separated" } } };
    return { config: { choices } };
  }
  if (type === "relation") {
    const target = z.enum(["post", "idea", "series", "source"]).safeParse(formData.get("target"));
    if (!target.success) return { error: { error: "Pick what it relates to.", fieldErrors: { target: "Pick one" } } };
    return { config: { target: target.data } };
  }
  return { config: {} };
}

export async function addFieldAction(slug: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const parsed = z
      .object({ entity: z.enum(entities, { error: "Pick where it goes" }), label: nameSchema, field_type: z.enum(types, { error: "Pick a type" }) })
      .safeParse({ entity: formData.get("entity"), label: formData.get("label"), field_type: formData.get("field_type") });
    if (!parsed.success) return invalid(parsed.error);
    const { config, error: configError } = fieldConfig(parsed.data.field_type, formData);
    if (configError) return configError;
    const existing = workspace.fields[parsed.data.entity];
    let key = optionValue(parsed.data.label);
    if (!/^[a-z]/.test(key)) key = `f_${key}`;
    key = key.slice(0, 40);
    for (let n = 2; existing.some((f) => f.key === key); n++) key = `${key.replace(/_\d+$/, "")}_${n}`;
    const position = existing.reduce((max, f) => Math.max(max, f.position), 0) + 10;
    const { error } = await supabase.from("content_field_definitions").insert({
      workspace_id: workspace.id,
      entity: parsed.data.entity,
      key,
      label: parsed.data.label,
      field_type: parsed.data.field_type,
      config,
      position,
    });
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, "Field added.");
  } catch (e) {
    return failure(e);
  }
}

export async function updateFieldAction(slug: string, id: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const { data: row } = await supabase.from("content_field_definitions").select("field_type").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
    if (!row) return { error: "Field not found." };
    const label = nameSchema.safeParse(formData.get("label"));
    if (!label.success) return invalid(label.error);
    // The type stays: stored values would no longer fit another type.
    const { config, error: configError } = fieldConfig(row.field_type, formData);
    if (configError) return configError;
    const { error } = await supabase.from("content_field_definitions").update({ label: label.data, config }).eq("id", id);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug);
  } catch (e) {
    return failure(e);
  }
}

export async function setFieldArchivedAction(slug: string, id: string, archived: boolean): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const { error } = await supabase
      .from("content_field_definitions")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("workspace_id", workspace.id);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, archived ? "Archived. Values stay stored." : "Restored.");
  } catch (e) {
    return failure(e);
  }
}

export async function moveFieldAction(slug: string, id: string, direction: -1 | 1) {
  return moveRow("content_field_definitions", slug, id, direction);
}

// ---------------------------------------------------------------------------
// Statuses and transitions
// ---------------------------------------------------------------------------

function rolesFrom(formData: FormData, key: string): ContentMemberRole[] {
  const roles: ContentMemberRole[] = [];
  if (checkbox(formData, "role_author")) roles.push("author");
  // Approving is for the author (or an admin), never for the reviewer.
  if (checkbox(formData, "role_reviewer") && key !== "approved") roles.push("reviewer");
  return roles;
}

export async function updateStatusAction(slug: string, key: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const label = z.string().trim().min(1, { error: "Add a label" }).max(60).safeParse(formData.get("label"));
    if (!label.success) return invalid(label.error);
    const { error } = await supabase
      .from("content_statuses")
      .update({ label: label.data, allowed_roles: rolesFrom(formData, key) })
      .eq("workspace_id", workspace.id)
      .eq("key", key);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug);
  } catch (e) {
    return failure(e);
  }
}

export async function addStatusAction(slug: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const label = z.string().trim().min(1, { error: "Add a label" }).max(60).safeParse(formData.get("label"));
    if (!label.success) return invalid(label.error);
    let key = optionValue(label.data);
    if (!/^[a-z]/.test(key)) key = `s_${key}`;
    key = key.slice(0, 40);
    for (let n = 2; workspace.statuses.some((s) => s.key === key); n++) key = `${key.replace(/_\d+$/, "")}_${n}`;
    const position = workspace.statuses.reduce((max, s) => Math.max(max, s.position), 0) + 10;
    const { error } = await supabase
      .from("content_statuses")
      .insert({ workspace_id: workspace.id, key, label: label.data, position, allowed_roles: rolesFrom(formData, key) });
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, "Status added. Add its transitions below.");
  } catch (e) {
    return failure(e);
  }
}

export async function setStatusArchivedAction(slug: string, key: string, archived: boolean): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const status = workspace.statuses.find((s) => s.key === key);
    if (!status) return { error: "Status not found." };
    if (status.isCore) return { error: "Built-in statuses can be renamed and reordered, not archived." };
    const { error } = await supabase
      .from("content_statuses")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("workspace_id", workspace.id)
      .eq("key", key);
    if (error) return { error: contentErrorMessage(error) };
    return done(slug, archived ? "Status archived." : "Status restored.");
  } catch (e) {
    return failure(e);
  }
}

export async function moveStatusAction(slug: string, key: string, direction: -1 | 1): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const order = workspace.statuses.map((s) => s.key);
    const index = order.indexOf(key);
    if (index < 0 || !order[index + direction]) return { ok: true };
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    for (const [i, k] of order.entries()) {
      const { error } = await supabase.from("content_statuses").update({ position: (i + 1) * 10 }).eq("workspace_id", workspace.id).eq("key", k);
      if (error) return { error: contentErrorMessage(error) };
    }
    return done(slug, "Order saved.");
  } catch (e) {
    return failure(e);
  }
}

/** The whole matrix at once: checked boxes are named t:<from>:<to>. */
export async function saveTransitionsAction(slug: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  try {
    const { workspace, supabase } = await manage(slug);
    const keys = new Set(workspace.statuses.map((s) => s.key));
    const wanted = new Set<string>();
    for (const [name, value] of formData.entries()) {
      if (!name.startsWith("t:") || value !== "on") continue;
      const [, from, to] = name.split(":");
      if (keys.has(from) && keys.has(to) && from !== to) wanted.add(`${from}:${to}`);
    }
    const current = new Set(workspace.transitions.map((t) => `${t.from}:${t.to}`));
    const add = [...wanted].filter((t) => !current.has(t));
    const remove = [...current].filter((t) => !wanted.has(t));
    if (add.length) {
      const { error } = await supabase.from("content_workflow_transitions").insert(
        add.map((t) => {
          const [from_status, to_status] = t.split(":");
          return { workspace_id: workspace.id, from_status, to_status };
        }),
      );
      if (error) return { error: contentErrorMessage(error) };
    }
    for (const t of remove) {
      const [from, to] = t.split(":");
      const { error } = await supabase
        .from("content_workflow_transitions")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("from_status", from)
        .eq("to_status", to);
      if (error) return { error: contentErrorMessage(error) };
    }
    return done(slug, `Flow saved (${add.length} added, ${remove.length} removed).`);
  } catch (e) {
    return failure(e);
  }
}
