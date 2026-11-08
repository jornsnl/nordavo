import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { FormBuilder } from "@/components/forms/form-builder";
import { FormNav } from "@/components/forms/form-nav";
import { CreateFormPanel, FormImages, FormLinks } from "@/components/forms/form-setup";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { env } from "@/lib/env";
import { getVacancyBasics, getVacancyForm, listCopySources } from "@/lib/forms/data";
import { applyUrl } from "@/lib/forms/mail-content";
import { createSignedUrl } from "@/lib/storage";

export const metadata: Metadata = {
  title: "Application form",
};

export default function Page({ params }: PageProps<"/dashboard/vacancies/[id]/form">) {
  return (
    <Suspense fallback={<BuilderSkeleton />}>
      <FormPage params={params} />
    </Suspense>
  );
}

async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vacancy = await getVacancyBasics(id);
  if (!vacancy) notFound();
  const vf = await getVacancyForm(vacancy.id);

  return (
    <>
      <FormNav vacancyId={vacancy.id} active="form" />
      <PageHeader
        eyebrow={vacancy.clientName ?? "Application form"}
        title={vacancy.title}
        description="The form candidates fill in for this vacancy: questions, CV, video and compensation. Changes go live when you publish."
      />
      {!vf ? (
        <CreateFormPanel vacancyId={vacancy.id} sources={await listCopySources(vacancy.id)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <FormBuilder
              // Remount after a publish so the editor starts from the stored draft.
              key={`${vf.form.id}-${vf.form.version}`}
              formId={vf.form.id}
              vacancyId={vacancy.id}
              initialMeta={{
                title: vf.form.title,
                intro: vf.form.intro ?? "",
                roleType: vf.form.role_type,
                maxReminders: vf.form.max_reminders,
                reminderIntervalDays: vf.form.reminder_interval_days,
              }}
              initialBlocks={vf.blocks}
              status={vf.form.status}
              version={vf.form.version}
              hasUnpublishedChanges={vf.hasUnpublishedChanges}
            />
          </div>
          <div className="min-w-0 space-y-4 sm:space-y-6">
            <FormLinks
              formId={vf.form.id}
              publicUrl={applyUrl(env.siteUrl(), vf.form.public_token)}
              headhuntedUrl={applyUrl(env.siteUrl(), vf.form.headhunted_token)}
              published={vf.form.status === "published"}
            />
            <FormImages
              formId={vf.form.id}
              headerUrl={vf.form.header_image_path ? await createSignedUrl(vf.form.header_image_path, 600) : null}
              logoUrl={vf.form.logo_path ? await createSignedUrl(vf.form.logo_path, 600) : null}
            />
          </div>
        </div>
      )}
    </>
  );
}

function BuilderSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the form">
      <Skeleton className="mb-4 h-10 w-80 max-w-full" />
      <Skeleton className="mb-8 h-10 w-72 max-w-full" />
      <ListSkeleton rows={6} />
    </div>
  );
}
