"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { env } from "@/lib/env";
import { applyUrl, inviteMail } from "@/lib/forms/mail-content";
import { localDate, parseAddressList } from "@/lib/forms/reminders";
import { hasRecruitmentMail, recruitmentFrom, sendMail } from "@/lib/notify/mail";
import { createClient } from "@/lib/supabase/server";

export type SentLink = {
  applicationId: string;
  name: string;
  email: string | null;
  link: string;
  status: "mailed" | "marked" | "no_email" | "failed" | "link_only";
};

export type SendResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  mailConfigured: boolean;
  links: SentLink[];
};

const inputSchema = z.object({
  vacancyId: z.guid(),
  applicationIds: z.array(z.guid()).min(1, "Select at least one candidate.").max(500, "Send to at most 500 candidates at once."),
  cc: z.string().max(1000).optional(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  /** Only make the personal links, do not send or mark anything. */
  linksOnly: z.boolean().optional(),
});

/**
 * Send the form: one mail PER candidate (never BCC) with their personal
 * link, optional CC and a deadline. Sourced and Techstack check move to
 * Fill out. Without RESEND_API_KEY nothing is mailed: the invites are marked
 * as sent and the links come back to copy.
 */
export async function sendFormAction(input: z.input<typeof inputSchema>): Promise<SendResult> {
  const user = await requireStaff();
  const mailConfigured = hasRecruitmentMail();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR, mailConfigured, links: [] };
  const { vacancyId, applicationIds, linksOnly } = parsed.data;
  const cc = parseAddressList(parsed.data.cc);
  if (parsed.data.cc && parsed.data.cc.trim() && cc.length === 0) {
    return { error: "The CC address is not valid.", mailConfigured, links: [] };
  }
  if (cc.length > 5) return { error: "Use at most five CC addresses.", mailConfigured, links: [] };
  const deadline = parsed.data.deadline || null;
  if (deadline && deadline < localDate(new Date())) return { error: "The deadline is in the past.", mailConfigured, links: [] };

  const supabase = await createClient();
  const [{ data: form }, { data: vacancy }, { data: applications, error: appError }] = await Promise.all([
    supabase.from("recruitment_forms").select("id, status, version").eq("vacancy_id", vacancyId).maybeSingle(),
    supabase.from("vacancies").select("title").eq("id", vacancyId).maybeSingle(),
    supabase
      .from("applications")
      .select("id, stage, candidate:candidates(full_name, email)")
      .eq("vacancy_id", vacancyId)
      .in("id", applicationIds),
  ]);
  if (!form || !vacancy) return { error: "Create the form for this vacancy first.", mailConfigured, links: [] };
  if (form.status !== "published") return { error: "Publish the form first, then send it.", mailConfigured, links: [] };
  if (appError || !applications || applications.length === 0) return { error: GENERIC_ERROR, mailConfigured, links: [] };

  // One personal link per application, kept when the form is sent again.
  const { error: inviteError } = await supabase
    .from("form_invites")
    .upsert(
      applications.map((a) => ({ form_id: form.id, application_id: a.id, created_by: user.id })),
      { onConflict: "application_id", ignoreDuplicates: true },
    );
  if (inviteError) return { error: GENERIC_ERROR, mailConfigured, links: [] };
  const { data: invites } = await supabase.from("form_invites").select("application_id, token").in("application_id", applications.map((a) => a.id));
  const tokens = new Map((invites ?? []).map((i) => [i.application_id, i.token]));

  const siteUrl = env.siteUrl();
  const links: SentLink[] = [];
  for (const a of applications) {
    const token = tokens.get(a.id);
    if (!token) continue;
    const name = a.candidate?.full_name ?? "Candidate";
    const email = a.candidate?.email ?? null;
    const link = applyUrl(siteUrl, token);
    let status: SentLink["status"];
    if (linksOnly) {
      status = "link_only";
    } else if (!mailConfigured) {
      status = "marked";
    } else if (!email) {
      status = "no_email";
    } else {
      const mail = inviteMail({ candidateName: name, vacancyTitle: vacancy.title, link, deadline });
      const ok = await sendMail({
        to: email,
        cc: cc.length > 0 ? cc.join(",") : undefined,
        replyTo: user.email || undefined,
        from: recruitmentFrom(),
        ...mail,
      });
      status = ok ? "mailed" : "failed";
    }
    links.push({ applicationId: a.id, name, email, link, status });
  }

  const sentIds = links.filter((l) => l.status === "mailed" || l.status === "marked").map((l) => l.applicationId);
  if (sentIds.length > 0) {
    const now = new Date().toISOString();
    const sentTo = new Map(links.map((l) => [l.applicationId, l.email]));
    await Promise.all(
      sentIds.map((id) =>
        supabase
          .from("form_invites")
          .update({ sent_at: now, sent_to: sentTo.get(id) ?? null, cc: cc.join(", ") || null, deadline, reminder_count: 0, reminded_at: null })
          .eq("application_id", id),
      ),
    );
    await supabase.from("applications").update({ form_sent_at: now, form_reminded_at: null }).in("id", sentIds);

    // Auto advance: the form is out, so Sourced and Techstack check move to Fill out.
    const toMove = applications.filter((a) => sentIds.includes(a.id) && (a.stage === "sourced" || a.stage === "techstack_check")).map((a) => a.id);
    if (toMove.length > 0) {
      await supabase.rpc("move_applications", { p_application_ids: toMove, p_stage: "fill_out" });
    }
  }

  revalidatePath(`/dashboard/vacancies/${vacancyId}/form/tracking`);
  revalidatePath(`/dashboard/vacancies/${vacancyId}/pipeline`);
  revalidatePath(`/dashboard/vacancies/${vacancyId}`);

  const count = (s: SentLink["status"]) => links.filter((l) => l.status === s).length;
  const parts: string[] = [];
  if (count("mailed")) parts.push(`${count("mailed")} mailed`);
  if (count("marked")) parts.push(`${count("marked")} marked as sent (mail is not configured, send the links yourself)`);
  if (count("no_email")) parts.push(`${count("no_email")} without an email address`);
  if (count("failed")) parts.push(`${count("failed")} could not be mailed`);
  if (count("link_only")) parts.push(`${count("link_only")} personal links ready`);
  return {
    ok: count("failed") === 0,
    error: count("failed") > 0 ? `Some mails failed: ${parts.join(", ")}.` : undefined,
    message: parts.length > 0 ? `${parts.join(", ")}.` : "Nothing to send.",
    mailConfigured,
    links,
  };
}
