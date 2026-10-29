import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { WorkPriority, WorkStatus } from "@/lib/work/database";

/**
 * One-time import from ClickUp (briefing section 13): every open task and
 * every task on review, with description, subtasks, comments and files.
 *
 * ClickUp workspace ("team") -> Work workspace (must exist already)
 * ClickUp list               -> Work project (created when missing)
 *
 * People are matched by e-mail to members of the Work workspace; anyone not
 * found is named in the text instead. Running it again skips everything that
 * was imported before (external_source = 'clickup').
 */

const API = "https://api.clickup.com/api/v2";
const SOURCE = "clickup";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

type Db = SupabaseClient<Database>;
type Fetch = typeof fetch;

export type ClickUpUser = { id: number; email?: string | null; username?: string | null };
export type ClickUpTask = {
  id: string;
  name: string;
  text_content?: string | null;
  description?: string | null;
  markdown_description?: string | null;
  status: { status: string; type: string };
  priority?: { priority: string } | null;
  due_date?: string | null;
  parent?: string | null;
  assignees?: ClickUpUser[];
  creator?: ClickUpUser | null;
  date_created?: string;
  list: { id: string; name: string };
  folder?: { id: string; name: string; hidden?: boolean } | null;
};

/** ClickUp status to Work status; null means "do not import" (finished work). */
export function mapStatus(status: { status: string; type: string }): WorkStatus | null {
  const name = status.status.toLowerCase();
  if (status.type === "closed" || status.type === "done") return null;
  if (/review|controle|check/.test(name)) return "review";
  if (/progress|bezig|doing|working/.test(name)) return "in_progress";
  if (/complete|done|klaar|afgerond/.test(name)) return null;
  if (status.type === "open") return "todo";
  return "in_progress";
}

export function mapPriority(priority: { priority: string } | null | undefined): WorkPriority {
  const value = priority?.priority?.toLowerCase();
  return value === "urgent" || value === "high" || value === "low" ? value : "normal";
}

export function clickUpDate(value: string | null | undefined): string | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return new Date(Number(value)).toISOString();
}

/** Subtasks are one level deep in Work: deeper ClickUp subtasks hang under their top task. */
export function rootParent(taskId: string, parents: Map<string, string | null>): string | null {
  let parent = parents.get(taskId) ?? null;
  const seen = new Set<string>([taskId]);
  while (parent && parents.get(parent) && !seen.has(parent)) {
    seen.add(parent);
    parent = parents.get(parent)!;
  }
  return parent;
}

export type ImportOptions = {
  token: string;
  db: Db;
  /** ClickUp team id -> Work workspace slug. Teams not listed are matched by name. */
  map?: Record<string, string>;
  dryRun?: boolean;
  projectVisibility?: "open" | "private";
  log: (message: string) => void;
  fetchImpl?: Fetch;
};

export type ImportCounts = { projects: number; tasks: number; comments: number; files: number; skipped: number };

export async function importFromClickUp(options: ImportOptions): Promise<ImportCounts> {
  const { db, log, dryRun = false } = options;
  const get = clickUpClient(options.token, options.fetchImpl ?? fetch);
  const counts: ImportCounts = { projects: 0, tasks: 0, comments: 0, files: 0, skipped: 0 };

  const { teams } = await get<{ teams: { id: string; name: string }[] }>("/team");
  const { data: workspaces } = await db.from("work_workspaces").select("id, name, slug");

  for (const team of teams) {
    const slug = options.map?.[team.id];
    const workspace = (workspaces ?? []).find((w) =>
      slug ? w.slug === slug : w.name.toLowerCase() === team.name.toLowerCase() || w.slug === team.name.toLowerCase(),
    );
    if (!workspace) {
      log(`ClickUp workspace "${team.name}" (${team.id}) overgeslagen: geen Work workspace gevonden. Maak hem aan of zet CLICKUP_IMPORT_MAP.`);
      continue;
    }
    log(`ClickUp "${team.name}" -> Work "${workspace.name}"`);

    const people = await memberEmails(db, workspace.id);
    const fallbackReviewer = people.admins[0] ?? null;
    const person = (u: ClickUpUser | null | undefined) => (u?.email ? (people.byEmail.get(u.email.toLowerCase()) ?? null) : null);

    // Every list in every space, inside folders and outside.
    const { spaces } = await get<{ spaces: { id: string; name: string }[] }>(`/team/${team.id}/space?archived=false`);
    const lists: { id: string; name: string; space: string }[] = [];
    for (const space of spaces) {
      const { folders } = await get<{ folders: { name: string; lists: { id: string; name: string }[] }[] }>(`/space/${space.id}/folder?archived=false`);
      for (const folder of folders) for (const list of folder.lists) lists.push({ ...list, space: space.name });
      const { lists: loose } = await get<{ lists: { id: string; name: string }[] }>(`/space/${space.id}/list?archived=false`);
      for (const list of loose) lists.push({ ...list, space: space.name });
    }

    for (const list of lists) {
      const tasks: ClickUpTask[] = [];
      for (let page = 0; page < 100; page++) {
        const batch = await get<{ tasks: ClickUpTask[]; last_page?: boolean }>(
          `/list/${list.id}/task?archived=false&subtasks=true&include_closed=false&include_markdown_description=true&page=${page}`,
        );
        tasks.push(...batch.tasks);
        if (batch.last_page !== false || batch.tasks.length < 100) break;
      }
      const wanted = tasks.filter((t) => mapStatus(t.status) !== null);
      counts.skipped += tasks.length - wanted.length;
      if (wanted.length === 0) continue;

      const projectId = dryRun ? `dry-${list.id}` : await ensureProject(db, workspace.id, list, options.projectVisibility ?? "open");
      if (!projectId) continue;
      counts.projects++;

      // Parents first, so subtasks can point at them.
      const parents = new Map(wanted.map((t) => [t.id, t.parent ?? null]));
      const ordered = [...wanted].sort((a, b) => Number(Boolean(a.parent)) - Number(Boolean(b.parent)));
      const newIds = new Map<string, string>();
      if (!dryRun) {
        const { data: existing } = await db
          .from("work_tasks")
          .select("id, external_id")
          .eq("external_source", SOURCE)
          .in("external_id", wanted.map((t) => t.id));
        for (const row of existing ?? []) newIds.set(row.external_id!, row.id);
      }

      for (const task of ordered) {
        if (newIds.has(task.id)) {
          counts.skipped++;
          continue;
        }
        const status = mapStatus(task.status)!;
        const owners = (task.assignees ?? []).map(person).filter((id): id is string => Boolean(id));
        const missing = (task.assignees ?? []).filter((a) => !person(a)).map((a) => a.username || a.email || "someone");
        const creator = person(task.creator);
        const root = rootParent(task.id, parents);
        const parentId = root ? (newIds.get(root) ?? null) : null;

        let description = task.markdown_description || task.text_content || task.description || "";
        const notes = [
          missing.length ? `Owners in ClickUp without a Work account: ${missing.join(", ")}` : "",
          `Imported from ClickUp (${task.status.status}): https://app.clickup.com/t/${task.id}`,
        ].filter(Boolean);
        description = [description.trim(), notes.map((n) => `_${n}_`).join("\n")].filter(Boolean).join("\n\n");

        if (dryRun) {
          newIds.set(task.id, `dry-${task.id}`);
          counts.tasks++;
          continue;
        }

        const { data: inserted, error } = await db
          .from("work_tasks")
          .insert({
            workspace_id: workspace.id,
            project_id: projectId,
            parent_id: parentId,
            title: task.name.slice(0, 300) || "Untitled",
            description: description.slice(0, 50_000),
            status,
            priority: mapPriority(task.priority),
            due_at: clickUpDate(task.due_date),
            created_by: creator,
            reviewer_id: creator ?? fallbackReviewer,
            review_requested_at: status === "review" ? new Date().toISOString() : null,
            created_at: clickUpDate(task.date_created) ?? undefined,
            external_source: SOURCE,
            external_id: task.id,
          })
          .select("id")
          .single();
        if (error || !inserted) {
          log(`Taak "${task.name}" (${task.id}) mislukt: ${error?.message}`);
          continue;
        }
        newIds.set(task.id, inserted.id);
        counts.tasks++;

        if (owners.length) {
          await db.from("work_task_assignees").insert(owners.map((user_id) => ({ task_id: inserted.id, user_id })));
        }
        counts.comments += await importComments(get, db, task.id, inserted.id, people.byEmail);
        counts.files += await importFiles(get, db, task.id, inserted.id, options.token, options.fetchImpl ?? fetch, log);
      }
      log(`  ${list.space} / ${list.name}: ${wanted.length} taken`);
    }
  }
  return counts;
}

function clickUpClient(token: string, fetchImpl: Fetch) {
  return async function get<T>(path: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetchImpl(`${API}${path}`, { headers: { Authorization: token, Accept: "application/json" } });
      if (response.status === 429) {
        // ClickUp allows 100 requests a minute; wait for the window.
        await new Promise((r) => setTimeout(r, 15_000));
        continue;
      }
      if (!response.ok) throw new Error(`ClickUp ${path}: ${response.status} ${await response.text()}`);
      return (await response.json()) as T;
    }
    throw new Error(`ClickUp ${path}: rate limited`);
  };
}

async function memberEmails(db: Db, workspaceId: string) {
  const { data } = await db
    .from("work_members")
    .select("user_id, role, profile:profiles!work_members_user_id_fkey(email)")
    .eq("workspace_id", workspaceId)
    .is("deactivated_at", null);
  const byEmail = new Map<string, string>();
  const admins: string[] = [];
  for (const m of data ?? []) {
    const email = (m.profile as { email: string | null } | null)?.email;
    if (email) byEmail.set(email.toLowerCase(), m.user_id);
    if (m.role === "admin") admins.push(m.user_id);
  }
  return { byEmail, admins };
}

async function ensureProject(db: Db, workspaceId: string, list: { id: string; name: string }, visibility: "open" | "private") {
  const { data: existing } = await db
    .from("work_projects")
    .select("id")
    .eq("external_source", SOURCE)
    .eq("external_id", list.id)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db
    .from("work_projects")
    .insert({ workspace_id: workspaceId, name: list.name.slice(0, 120), visibility, external_source: SOURCE, external_id: list.id })
    .select("id")
    .single();
  if (error) throw new Error(`Project "${list.name}": ${error.message}`);
  return data.id;
}

async function importComments(
  get: <T>(path: string) => Promise<T>,
  db: Db,
  clickUpId: string,
  taskId: string,
  byEmail: Map<string, string>,
) {
  const { comments } = await get<{
    comments: { id: string; comment_text: string; date: string; user?: ClickUpUser | null }[];
  }>(`/task/${clickUpId}/comment`);
  const rows = comments
    .filter((c) => c.comment_text?.trim())
    .reverse() // ClickUp returns newest first
    .map((c) => {
      const author = c.user?.email ? (byEmail.get(c.user.email.toLowerCase()) ?? null) : null;
      const prefix = author ? "" : `**${c.user?.username || c.user?.email || "ClickUp"}:** `;
      return {
        task_id: taskId,
        author_id: author,
        body: (prefix + c.comment_text.trim()).slice(0, 20_000),
        created_at: clickUpDate(c.date) ?? undefined,
        external_source: SOURCE,
        external_id: c.id,
      };
    });
  if (rows.length === 0) return 0;
  const { error } = await db.from("work_comments").upsert(rows, { onConflict: "external_source,external_id", ignoreDuplicates: true });
  return error ? 0 : rows.length;
}

async function importFiles(
  get: <T>(path: string) => Promise<T>,
  db: Db,
  clickUpId: string,
  taskId: string,
  token: string,
  fetchImpl: Fetch,
  log: (message: string) => void,
) {
  const detail = await get<{ attachments?: { id: string; title?: string; url: string; size?: number; mimetype?: string }[] }>(
    `/task/${clickUpId}`,
  );
  let count = 0;
  for (const file of detail.attachments ?? []) {
    if (file.size && file.size > MAX_FILE_BYTES) {
      log(`  bestand "${file.title}" te groot, overgeslagen`);
      continue;
    }
    const response = await fetchImpl(file.url, { headers: { Authorization: token } });
    if (!response.ok) {
      log(`  bestand "${file.title}" niet te downloaden (${response.status})`);
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) continue;
    const name = (file.title || "file").normalize("NFKD").replace(/[^\w.\-]+/g, "-").slice(-120);
    const path = `task/${taskId}/${file.id.slice(0, 8)}-${name}`;
    const contentType = file.mimetype || response.headers.get("content-type") || "application/octet-stream";
    const { error: uploadError } = await db.storage.from("work").upload(path, bytes, { contentType, upsert: true });
    if (uploadError) {
      log(`  bestand "${file.title}" uploaden mislukt: ${uploadError.message}`);
      continue;
    }
    const { error } = await db.from("work_attachments").upsert(
      {
        task_id: taskId,
        storage_path: path,
        file_name: (file.title || name).slice(0, 255),
        mime_type: contentType,
        size_bytes: bytes.byteLength,
        external_source: SOURCE,
        external_id: file.id,
      },
      { onConflict: "external_source,external_id", ignoreDuplicates: true },
    );
    if (!error) count++;
  }
  return count;
}
