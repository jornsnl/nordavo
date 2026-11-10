import "server-only";
import { createClient } from "@/lib/supabase/server";
import { check, listMyContentWorkspaces } from "@/lib/content/data";

/**
 * One search bar across ideas and posts (title, text and tags), within what
 * the user may see: RLS keeps private ideas and unsubmitted posts out.
 */

export type SearchHit = { id: string; title: string; snippet: string; href: string; workspace: string; status: string };

/** Free text to a safe ilike pattern for PostgREST filters; null when too short. */
export function contentSearchPattern(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[,()"'*:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (cleaned.length < 2) return null;
  return `%${cleaned.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** A tag to look for: one word, lowercase. */
function tagOf(raw: string): string | null {
  const tag = raw.trim().replace(/^#/, "").toLowerCase();
  return /^[\p{L}\p{N}_-]{2,40}$/u.test(tag) ? tag : null;
}

function snippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return flat.slice(0, 160);
  const start = Math.max(0, at - 60);
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + 160)}${start + 160 < flat.length ? "…" : ""}`;
}

export async function searchContent(query: string): Promise<{ ideas: SearchHit[]; posts: SearchHit[] }> {
  const pattern = contentSearchPattern(query);
  if (!pattern) return { ideas: [], posts: [] };
  const workspaces = await listMyContentWorkspaces();
  if (workspaces.length === 0) return { ideas: [], posts: [] };
  const bySlug = new Map(workspaces.map((w) => [w.id, w]));
  const ids = workspaces.map((w) => w.id);
  const tag = tagOf(query);
  const supabase = await createClient();

  const ideaFilter = [`text.ilike.${pattern}`, ...(tag ? [`tags.cs.{${tag}}`] : [])].join(",");
  const postFilter = [`title.ilike.${pattern}`, `hook.ilike.${pattern}`, `body.ilike.${pattern}`, `closing_question.ilike.${pattern}`].join(",");

  const [ideas, posts] = await Promise.all([
    supabase
      .from("content_ideas")
      .select("id, workspace_id, text, tags, status")
      .in("workspace_id", ids)
      .or(ideaFilter)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("content_posts")
      .select("id, workspace_id, title, hook, body, status")
      .in("workspace_id", ids)
      .or(postFilter)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  return {
    ideas: check(ideas, "ideas").map((i) => {
      const ws = bySlug.get(i.workspace_id)!;
      return {
        id: i.id,
        title: i.text.split("\n")[0].slice(0, 120),
        snippet: i.tags.length ? `#${i.tags.join(" #")}` : snippet(i.text, query),
        href: `/content/w/${ws.slug}/ideas?view=${i.status === "shortlisted" ? "shortlist" : i.status === "archived" || i.status === "converted" ? "archive" : "inbox"}#idea-${i.id}`,
        workspace: ws.name,
        status: i.status,
      };
    }),
    posts: check(posts, "posts").map((p) => {
      const ws = bySlug.get(p.workspace_id)!;
      return {
        id: p.id,
        title: p.title,
        snippet: snippet(`${p.hook}\n${p.body}`, query),
        href: `/content/w/${ws.slug}/posts/${p.id}`,
        workspace: ws.name,
        status: p.status,
      };
    }),
  };
}
