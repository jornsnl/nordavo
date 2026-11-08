import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { io } from "next/cache";
import { PageHeader } from "@/components/dashboard/page-header";
import { FormNav } from "@/components/forms/form-nav";
import { SendFormPanel, type TrackingItem } from "@/components/forms/send-form-panel";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { env } from "@/lib/env";
import { getFormTracking, getVacancyBasics, getVacancyForm } from "@/lib/forms/data";
import { applyUrl } from "@/lib/forms/mail-content";
import { defaultDeadline, trackingStatus } from "@/lib/forms/reminders";
import { hasRecruitmentMail } from "@/lib/notify/mail";

export const metadata: Metadata = {
  title: "Send and track the form",
};

/**
 * Send the form and see who did and did not fill it in. The pipeline can
 * link here with ?applications=<id>,<id> to preselect candidates.
 */
export default function Page({ params, searchParams }: PageProps<"/dashboard/vacancies/[id]/form/tracking">) {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Tracking params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Tracking({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const vacancy = await getVacancyBasics(id);
  if (!vacancy) notFound();
  const [vf, rows] = await Promise.all([getVacancyForm(vacancy.id), getFormTracking(vacancy.id)]);

  await io();
  const now = new Date();
  const siteUrl = env.siteUrl();
  const items: TrackingItem[] = rows.map((r) => ({
    applicationId: r.applicationId,
    candidateId: r.candidateId,
    name: r.name,
    email: r.email,
    stage: r.stage,
    headhunted: r.origin === "headhunted",
    status: trackingStatus(
      { sentAt: r.formSentAt, completedAt: r.formCompletedAt, remindedAt: r.formRemindedAt, deadline: r.invite?.deadline ?? null },
      now,
    ),
    sentAt: r.formSentAt,
    completedAt: r.formCompletedAt,
    remindedAt: r.formRemindedAt,
    deadline: r.invite?.deadline ?? null,
    link: r.invite ? applyUrl(siteUrl, r.invite.token) : null,
  }));

  const raw = typeof query.applications === "string" ? query.applications : "";
  const preselected = raw.split(",").filter((v) => /^[0-9a-f-]{36}$/i.test(v)).slice(0, 500);

  return (
    <>
      <FormNav vacancyId={vacancy.id} active="tracking" />
      <PageHeader
        eyebrow={vacancy.clientName ?? "Application form"}
        title={vacancy.title}
        description="Send the form to candidates, one mail each with their personal link, and see who filled it in. Reminders go out after the deadline, as set on the form."
        actions={
          !vf ? (
            <ButtonLink href={`/dashboard/vacancies/${vacancy.id}/form`}>Create the form</ButtonLink>
          ) : undefined
        }
      />
      <SendFormPanel
        vacancyId={vacancy.id}
        items={items}
        published={vf?.form.status === "published"}
        mailConfigured={hasRecruitmentMail()}
        defaultCc={process.env.FORMS_DEFAULT_CC ?? ""}
        defaultDeadline={defaultDeadline(now)}
        preselected={preselected}
      />
    </>
  );
}
