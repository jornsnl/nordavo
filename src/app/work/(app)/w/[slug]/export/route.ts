import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/server";

/**
 * Export a whole workspace (admins only) as JSON or CSV. Runs as the signed-in
 * user: the admin check happens in the database (work_my_role) and every
 * query goes through RLS, so an export never holds more than the admin sees.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";
  const supabase = await createClient();

  const { data: workspace } = await supabase.from("work_workspaces").select("id, name, slug").eq("slug", slug).maybeSingle();
  if (!workspace) return new NextResponse("Not found", { status: 404 });
  const { data: role } = await supabase.rpc("work_my_role", { p_workspace: workspace.id });
  if (role !== "admin") return new NextResponse("Only workspace admins can export", { status: 403 });

  const [projects, tasks, members] = await Promise.all([
    supabase.from("work_projects").select("*").eq("workspace_id", workspace.id),
    fetchAll((from, to) => supabase.from("work_tasks").select("*").eq("workspace_id", workspace.id).range(from, to)),
    supabase.from("work_members").select("user_id, role, access_expires_at, deactivated_at, created_at").eq("workspace_id", workspace.id),
  ]);
  const taskIds = tasks.map((t) => t.id as string);
  const [assignees, comments, attachments, activity, accessLog] = await Promise.all([
    inChunks(taskIds, (ids) => supabase.from("work_task_assignees").select("*").in("task_id", ids)),
    inChunks(taskIds, (ids) => supabase.from("work_comments").select("*").in("task_id", ids)),
    inChunks(taskIds, (ids) => supabase.from("work_attachments").select("id, task_id, file_name, mime_type, size_bytes, uploaded_by, created_at").in("task_id", ids)),
    inChunks(taskIds, (ids) => supabase.from("work_task_activity").select("*").in("task_id", ids)),
    supabase.from("work_access_log").select("*").eq("workspace_id", workspace.id),
  ]);
  const userIds = [...new Set((members.data ?? []).map((m) => m.user_id))];
  const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `work-${workspace.slug}-${stamp}.${format}`;
  const headers = {
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };

  if (format === "json") {
    const body = {
      exported_at: new Date().toISOString(),
      workspace,
      people: people ?? [],
      members: members.data ?? [],
      projects: projects.data ?? [],
      tasks,
      assignees,
      comments,
      attachments,
      activity,
      access_log: accessLog.data ?? [],
    };
    return new NextResponse(JSON.stringify(body, null, 2), { headers: { ...headers, "Content-Type": "application/json" } });
  }

  // CSV: one row per task, with names instead of ids, ready for a spreadsheet.
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email || p.id]));
  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
  const titles = new Map(tasks.map((t) => [t.id as string, t.title as string]));
  const rows = tasks.map((t) => ({
    id: t.id,
    project: projectName.get(t.project_id as string) ?? "",
    parent: t.parent_id ? (titles.get(t.parent_id as string) ?? "") : "",
    title: t.title,
    status: t.status,
    priority: t.priority,
    due_at_utc: t.due_at ?? "",
    owners: assignees.filter((a) => a.task_id === t.id).map((a) => name.get(a.user_id as string) ?? a.user_id).join("; "),
    reviewer: t.reviewer_id ? (name.get(t.reviewer_id as string) ?? "") : "",
    created_by: t.created_by ? (name.get(t.created_by as string) ?? "") : "",
    created_at_utc: t.created_at,
    completed_at_utc: t.completed_at ?? "",
    archived_at_utc: t.archived_at ?? "",
    comments: comments.filter((c) => c.task_id === t.id).length,
    files: attachments.filter((a) => a.task_id === t.id).length,
    description: t.description ?? "",
  }));
  return new NextResponse(`﻿${Papa.unparse(rows)}`, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
}

type Row = Record<string, unknown>;

async function fetchAll(page: (from: number, to: number) => PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await page(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function inChunks(ids: string[], query: (ids: string[]) => PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await query(ids.slice(i, i + 150));
    out.push(...(data ?? []));
  }
  return out;
}
