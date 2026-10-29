import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";
import { escapeHtml, sendMail } from "@/lib/notify/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkDelivery, WorkNotificationKind, WorkNotificationRow } from "@/lib/work/database";
import { formatDue, safeTimeZone } from "@/lib/work/time";

/**
 * Sends the e-mail notifications the database queued in work_notifications.
 * "instant" runs right after a change (from the server action or API call)
 * and every few minutes from the scheduled job; "digest" runs once a day.
 *
 * Mails name the task and who did what, with a link. Comment text and files
 * are never put in a mail: they can hold candidate data, and the link only
 * opens for people with access.
 */

type Db = SupabaseClient<Database>;

export type DeliveryResult = { claimed: number; mails: number; failed: number };

type Recipient = { email: string | null; name: string; timeZone: string };
type TaskInfo = { title: string; dueAt: string | null; project: string; workspace: string };

export async function deliverNotifications(delivery: WorkDelivery, db: Db | null = createAdminClient()): Promise<DeliveryResult> {
  const result: DeliveryResult = { claimed: 0, mails: 0, failed: 0 };
  if (!db) return result;

  // Keep claiming until the queue is empty (instant) or a sane cap is hit.
  for (let round = 0; round < 20; round++) {
    const { data: rows, error } = await db.rpc("work_claim_notifications", { p_delivery: delivery, p_limit: 200 });
    if (error) {
      console.error("[work] claiming notifications failed:", error.message);
      return result;
    }
    if (!rows || rows.length === 0) break;
    result.claimed += rows.length;
    const { mails, failed } = await sendBatch(db, rows, delivery);
    result.mails += mails;
    result.failed += failed;
    if (rows.length < 200) break;
  }
  return result;
}

async function sendBatch(db: Db, rows: WorkNotificationRow[], delivery: WorkDelivery) {
  const userIds = [...new Set(rows.flatMap((r) => [r.user_id, r.actor_id]).filter((id): id is string => Boolean(id)))];
  const taskIds = [...new Set(rows.map((r) => r.task_id).filter((id): id is string => Boolean(id)))];

  const [{ data: profiles }, { data: tasks }] = await Promise.all([
    db.from("profiles").select("id, full_name, email, time_zone").in("id", userIds),
    taskIds.length
      ? db
          .from("work_tasks")
          .select(
            "id, title, due_at, project:work_projects!work_tasks_project_id_workspace_id_fkey(name), workspace:work_workspaces!work_tasks_workspace_id_fkey(name)",
          )
          .in("id", taskIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const people = new Map<string, Recipient>(
    (profiles ?? []).map((p) => [
      p.id,
      { email: p.email, name: p.full_name || p.email?.split("@")[0] || "Someone", timeZone: safeTimeZone(p.time_zone) },
    ]),
  );
  const taskInfo = new Map<string, TaskInfo>(
    (tasks ?? []).map((t) => [
      t.id,
      {
        title: t.title,
        dueAt: t.due_at,
        project: (t.project as { name: string } | null)?.name ?? "",
        workspace: (t.workspace as { name: string } | null)?.name ?? "",
      },
    ]),
  );

  const byUser = new Map<string, WorkNotificationRow[]>();
  for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);

  let mails = 0;
  let failed = 0;
  const sent: number[] = [];
  const retry: number[] = [];

  for (const [userId, items] of byUser) {
    const recipient = people.get(userId);
    const ids = items.map((i) => i.id);
    if (!recipient?.email) {
      sent.push(...ids); // nobody to mail; do not retry forever
      continue;
    }
    const lines = items.map((item) => describe(item, people, taskInfo, recipient.timeZone));
    const subject =
      delivery === "digest"
        ? `Your daily overview: ${items.length} update${items.length === 1 ? "" : "s"}`
        : items.length === 1
          ? lines[0].subject
          : `${items.length} updates in Work`;
    const ok = await sendMail({
      to: recipient.email,
      subject,
      html: renderMail(recipient.name, lines, delivery),
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

  if (sent.length) await db.rpc("work_finish_notifications", { p_ids: sent, p_sent: true });
  if (retry.length) await db.rpc("work_finish_notifications", { p_ids: retry, p_sent: false });
  return { mails, failed };
}

type Line = { subject: string; text: string; context: string; url: string };

function describe(
  item: WorkNotificationRow,
  people: Map<string, Recipient>,
  tasks: Map<string, TaskInfo>,
  timeZone: string,
): Line {
  const site = env.siteUrl().replace(/\/$/, "");
  const actor = item.actor_id ? (people.get(item.actor_id)?.name ?? "Someone") : "Someone";
  const data = (item.data ?? {}) as Record<string, unknown>;
  const task = item.task_id ? tasks.get(item.task_id) : undefined;
  const title = task?.title ?? (typeof data.title === "string" ? data.title : "a task");
  const url = item.task_id ? `${site}/work/tasks/${item.task_id}` : item.project_id ? `${site}/work/projects/${item.project_id}` : `${site}/work`;
  const context = task ? [task.workspace, task.project].filter(Boolean).join(" › ") : "";
  const due = task?.dueAt ? formatDue(task.dueAt, timeZone) : "";

  const texts: Record<WorkNotificationKind, [string, string]> = {
    assigned: [`Assigned to you: ${title}`, `${actor} assigned "${title}" to you.`],
    comment: [`New comment on ${title}`, `${actor} commented on "${title}".`],
    mention: [`${actor} mentioned you`, `${actor} mentioned you in a comment on "${title}".`],
    review: [`Ready for your review: ${title}`, `${actor} sent "${title}" to review. You are the reviewer.`],
    returned: [`Sent back: ${title}`, `${actor} sent "${title}" back with a comment on what still needs to happen.`],
    due_soon: [`Due tomorrow: ${title}`, `"${title}" is due ${due || "tomorrow"}.`],
    overdue: [`Overdue: ${title}`, `"${title}" was due ${due || "earlier"} and is not finished yet.`],
    project_added: [
      `You were added to ${String(data.project ?? "a project")}`,
      `${actor} added you to the project "${String(data.project ?? "")}".`,
    ],
    access_expiring: [
      "Your access ends soon",
      `Your access to ${String(data.project ?? data.workspace ?? "a workspace")} ends ${
        typeof data.access_expires_at === "string" ? formatDue(data.access_expires_at, timeZone) : "soon"
      }.`,
    ],
  };
  const [subject, text] = texts[item.kind] ?? [`Update: ${title}`, `There is an update on "${title}".`];
  return { subject, text, context, url };
}

function renderMail(name: string, lines: Line[], delivery: WorkDelivery) {
  const items = lines
    .map(
      (l) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb">
        ${l.context ? `<div style="font-size:12px;color:#6b7280">${escapeHtml(l.context)}</div>` : ""}
        <div style="font-size:14px;color:#111827;margin:2px 0 6px">${escapeHtml(l.text)}</div>
        <a href="${escapeHtml(l.url)}" style="font-size:13px;color:#1d3a8a">Open in Work</a>
      </td></tr>`,
    )
    .join("");
  const intro = delivery === "digest" ? "Here is what happened since yesterday." : "There is something for you in Work.";
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
    <p style="font-size:14px;color:#111827">Hi ${escapeHtml(name)},</p>
    <p style="font-size:14px;color:#374151">${intro}</p>
    <table style="width:100%;border-collapse:collapse">${items}</table>
    <p style="font-size:12px;color:#6b7280;margin-top:24px">Choose which mails you get under Settings in Work.</p>
  </div>`;
}

/** Mail an invite link. Returns false when mail is not configured. */
export async function sendInviteMail({
  to,
  inviter,
  workspace,
  project,
  url,
}: {
  to: string;
  inviter: string;
  workspace: string;
  project: string | null;
  url: string;
}) {
  const where = project ? `the project "${project}" in ${workspace}` : `the workspace ${workspace}`;
  return sendMail({
    to,
    subject: `${inviter} invited you to ${project ?? workspace}`,
    text: `${inviter} invited you to ${where} in Work, Nordavo's task tool.\n\nAccept the invite: ${url}\n\nThe link works for 14 days.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <p style="font-size:14px;color:#111827">${escapeHtml(inviter)} invited you to ${escapeHtml(where)} in Work, Nordavo's task tool.</p>
      <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1d3a8a;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-size:14px">Accept the invite</a></p>
      <p style="font-size:12px;color:#6b7280">The link works for 14 days. Sign in with Google or a link by e-mail, using ${escapeHtml(to)}.</p>
    </div>`,
  });
}

/** Mail a one-time sign-in link we made with the admin API. */
export async function sendSignInMail(to: string, url: string) {
  return sendMail({
    to,
    subject: "Your sign-in link for Work",
    text: `Sign in to Work: ${url}\n\nThe link works once and expires within an hour. Did not ask for it? Ignore this mail.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <p style="font-size:14px;color:#111827">Here is your link to sign in to Work.</p>
      <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1d3a8a;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-size:14px">Sign in</a></p>
      <p style="font-size:12px;color:#6b7280">The link works once and expires within an hour. Did not ask for it? Ignore this mail.</p>
    </div>`,
  });
}
