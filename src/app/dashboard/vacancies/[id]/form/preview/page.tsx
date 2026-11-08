import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { FormHeader, FormRenderer } from "@/components/forms/form-renderer";
import { ListSkeleton } from "@/components/ui/skeleton";
import { getVacancyBasics, getVacancyForm } from "@/lib/forms/data";
import { createSignedUrl } from "@/lib/storage";

export const metadata: Metadata = {
  title: "Form preview",
};

/** The saved draft as candidates would see it; submitting is off. */
export default function Page({ params }: PageProps<"/dashboard/vacancies/[id]/form/preview">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Preview params={params} />
    </Suspense>
  );
}

async function Preview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vacancy = await getVacancyBasics(id);
  if (!vacancy) notFound();
  const vf = await getVacancyForm(vacancy.id);
  if (!vf) notFound();

  const [headerImageUrl, logoUrl] = await Promise.all([
    vf.form.header_image_path ? createSignedUrl(vf.form.header_image_path, 600) : null,
    vf.form.logo_path ? createSignedUrl(vf.form.logo_path, 600) : null,
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <p role="status" className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Preview of the saved draft. Unsaved changes in the editor are not shown, and submitting is off.
      </p>
      <FormHeader title={vf.form.title} intro={vf.form.intro} headerImageUrl={headerImageUrl} logoUrl={logoUrl} />
      <FormRenderer blocks={vf.blocks} />
    </div>
  );
}
