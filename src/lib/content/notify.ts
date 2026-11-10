import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";
import { escapeHtml, sendMail } from "@/lib/notify/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ContentNotificationRow } from "@/lib/content/database";
import { addDays, dayKey, notificationLabel, weekStart } from "@/lib/content/rules";

/**
 * Mails for the notifications the database queued in content_notifications
 * (triggers and content_run_checks). The database already skips mail for
 * kinds a user switched off (email_state 'skipped'), so everything claimed
 * here goes out. Mails name the post, the workspace and a link; the post
 * text never goes in a mail.
 */

type Db = SupabaseClient<Database>;

export type ContentMailResult = { claimed: number; mails: number; failed: number };

function site() {
  return env.siteUrl().replace(/\/$/, "");
}

export async function deliverContentMail(db: Db | null = createAdminClient()): Promise<ContentMailResult> {
  const result: ContentMailResult = { claimed: 0, mails: 0, failed: 0 };
  if (!db) return result;
  for (let round = 0; round < 20; round++) {
    const { data: rows, error } = await db.rpc("content_claim_mail", { p_limit: 200 });
    if (error) {
      console.error("[content] claiming mail failed:", error.message);
      return result;
    }
    if (!rows || rows.length === 0) break;
    result.claimed += rows.length;
    const { mails, failed } = await sendBatch(db, rows);
    result.mails += mails;
    result.failed += failed;
    if (rows.length < 200) break;
  }
  return result;
}

/** Send queued mail right after the response of a server action. */
export function sendContentMailSoon() {
  after(async () => {
    try {
      await deliverContentMail();
    } catch (error) {
      console.error("[content] sending mail failed:", error instanceof Error ? error.message : error);
    }
  });
}

type Line = { text: string; context: string; url: string };

async function sendBatch(db: Db, rows: ContentNotificationRow[]) {
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const workspaceIds = [...new Set(rows.map((r) => r.workspace_id).filter((id): id is string => Boolean(id)))];
  const [{ data: profiles }, { data: workspaces }] = await Promise.all([
    db.from("profiles").select("id, full_name, email").in("id", userIds),
    workspaceIds.length
      ? db.from("content_workspaces").select("id, name, slug").in("id", workspaceIds)
      : Promise.resolve({ data: [] as { id: string; name: string; slug: string }[] }),
  ]);
  const people = new Map((profiles ?? []).map((p) => [p.id, { email: p.email, name: p.full_name || p.email?.split("@")[0] || "there" }]));
  const spaces = new Map((workspaces ?? []).map((w) => [w.id, w]));

  const byUser = new Map<string, ContentNotificationRow[]>();
  for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);

  let mails = 0;
  let failed = 0;
  const sent: number[] = [];
  const retry: number[] = [];
  for (const [userId, items] of byUser) {
    const person = people.get(userId);
    const ids = items.map((i) => i.id);
    if (!person?.email) {
      sent.push(...ids);
      continue;
    }
    const lines: Line[] = items.map((item) => {
      const ws = item.workspace_id ? spaces.get(item.workspace_id) : undefined;
      const url = ws ? (item.post_id ? `${site()}/content/w/${ws.slug}/posts/${item.post_id}` : `${site()}/content/w/${ws.slug}`) : `${site()}/content`;
      return { text: item.message, context: [ws?.name, notificationLabel(item.kind)].filter(Boolean).join(" › "), url };
    });
    const ok = await sendMail({
      category: "content_notification",
      to: person.email,
      subject: items.length === 1 ? items[0].message : `${items.length} updates in Content`,
      html: renderList(person.name, "There is something for you in Content.", lines),
      text: lines.map((l) => `${l.text}\n${l.url}`).join("\n\n"),
    });
    if (ok) {
      mails++;
      sent.push(...ids);
    } else {
      failed++;
      retry.push(...ids);
    }
  }
  if (sent.length) await db.rpc("content_finish_mail", { p_ids: sent, p_sent: true });
  if (retry.length) await db.rpc("content_finish_mail", { p_ids: retry, p_sent: false });
  return { mails, failed };
}

function renderList(name: string, intro: string, lines: Line[], footer = "Choose which mails you get under Settings in Content.") {
  const items = lines
    .map(
      (l) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb">
        ${l.context ? `<div style="font-size:12px;color:#6b7280">${escapeHtml(l.context)}</div>` : ""}
        <div style="font-size:14px;color:#111827;margin:2px 0 6px">${escapeHtml(l.text)}</div>
        <a href="${escapeHtml(l.url)}" style="font-size:13px;color:#1f4e8c">Open in Content</a>
      </td></tr>`,
    )
    .join("");
  return `
    <p style="font-size:14px;color:#111827">Hi ${escapeHtml(name)},</p>
    <p style="font-size:14px;color:#374151">${escapeHtml(intro)}</p>
    <table style="width:100%;border-collapse:collapse">${items}</table>
    <p style="font-size:12px;color:#6b7280;margin-top:24px">${escapeHtml(footer)}</p>
`;
}

// ---------------------------------------------------------------------------
// Monday morning summary
// ---------------------------------------------------------------------------

export type SummaryPost = {
  title: string;
  status: string;
  plannedDate: string | null;
  timeSlot: string | null;
  formatNeedsMedia: boolean;
  mediaCount: number;
};

const READY = ["approved", "scheduled", "published", "measured"];

/** What is still missing before a post can go live. Pure, unit tested. */
export function missingFor(post: SummaryPost): string[] {
  const missing: string[] = [];
  if (!READY.includes(post.status)) missing.push("not approved");
  if (!post.timeSlot) missing.push("no time slot");
  if (post.formatNeedsMedia && post.mediaCount === 0) missing.push("no media");
  return missing;
}

/**
 * Per user: what goes live this week in each workspace they are in, and
 * what is still missing. Skipped for people who switched off
 * weekly_summary by email, and for weeks without any planned post.
 */
export async function sendWeeklySummaries(db: Db, now: Date = new Date()): Promise<{ users: number; mails: number }> {
  const start = weekStart(dayKey(now));
  const end = addDays(start, 7);

  const [{ data: workspaces }, { data: members }, { data: admins }, { data: optOut }] = await Promise.all([
    db.from("content_workspaces").select("id, name, slug, owner_id").is("archived_at", null),
    db.from("content_members").select("workspace_id, user_id, role"),
    db.from("profiles").select("id").eq("role", "admin"),
    db.from("content_notification_prefs").select("user_id").eq("kind", "weekly_summary").eq("email", false),
  ]);
  if (!workspaces?.length) return { users: 0, mails: 0 };

  const ids = workspaces.map((w) => w.id);
  const [{ data: posts }, { data: formats }] = await Promise.all([
    db
      .from("content_posts")
      .select("id, workspace_id, title, status, planned_date, time_slot, format, submitted_at")
      .in("workspace_id", ids)
      .gte("planned_date", start)
      .lt("planned_date", end)
      .not("status", "in", "(parked,rejected)")
      .order("planned_date"),
    db.from("content_options").select("workspace_id, value, meta").eq("list_key", "format").in("workspace_id", ids),
  ]);
  const postIds = (posts ?? []).map((p) => p.id);
  const { data: media } = postIds.length
    ? await db.from("content_post_media").select("post_id").in("post_id", postIds)
    : { data: [] as { post_id: string }[] };
  const mediaCount = new Map<string, number>();
  for (const m of media ?? []) mediaCount.set(m.post_id, (mediaCount.get(m.post_id) ?? 0) + 1);
  const needsMedia = new Set(
    (formats ?? [])
      .filter((f) => f.meta && typeof f.meta === "object" && !Array.isArray(f.meta) && (f.meta as Record<string, unknown>).needs_media === true)
      .map((f) => `${f.workspace_id}:${f.value}`),
  );

  // Who sees which workspace: members (reviewers only submitted posts) and admins.
  const access = new Map<string, Map<string, string>>();
  const grant = (user: string, ws: string, role: string) => {
    const map = access.get(user) ?? new Map<string, string>();
    if (!map.has(ws)) map.set(ws, role);
    access.set(user, map);
  };
  for (const m of members ?? []) grant(m.user_id, m.workspace_id, m.role);
  for (const a of admins ?? []) for (const w of workspaces) grant(a.id, w.id, "admin");
  const skip = new Set((optOut ?? []).map((o) => o.user_id));

  const userIds = [...access.keys()].filter((id) => !skip.has(id));
  if (userIds.length === 0) return { users: 0, mails: 0 };
  const { data: profiles } = await db.from("profiles").select("id, full_name, email").in("id", userIds);

  let mails = 0;
  for (const person of profiles ?? []) {
    if (!person.email) continue;
    const lines: Line[] = [];
    for (const [wsId, role] of access.get(person.id) ?? []) {
      const ws = workspaces.find((w) => w.id === wsId);
      if (!ws) continue;
      for (const p of (posts ?? []).filter((x) => x.workspace_id === wsId)) {
        if (role === "reviewer" && !p.submitted_at) continue;
        const missing = missingFor({
          title: p.title,
          status: p.status,
          plannedDate: p.planned_date,
          timeSlot: p.time_slot,
          formatNeedsMedia: Boolean(p.format && needsMedia.has(`${wsId}:${p.format}`)),
          mediaCount: mediaCount.get(p.id) ?? 0,
        });
        lines.push({
          context: `${ws.name} › ${p.planned_date}`,
          text: missing.length ? `${p.title} (still missing: ${missing.join(", ")})` : `${p.title} (ready)`,
          url: `${site()}/content/w/${ws.slug}/posts/${p.id}`,
        });
      }
    }
    if (lines.length === 0) continue;
    const open = lines.filter((l) => l.text.includes("still missing")).length;
    const ok = await sendMail({
      category: "content_summary",
      to: person.email,
      subject: `This week in Content: ${lines.length} post${lines.length === 1 ? "" : "s"}${open ? `, ${open} still need work` : ""}`,
      html: renderList(person.full_name || "there", `What goes live this week (from ${start}) and what is still missing.`, lines),
      text: lines.map((l) => `${l.context}: ${l.text}\n${l.url}`).join("\n\n"),
    });
    if (ok) mails++;
  }
  return { users: userIds.length, mails };
}
