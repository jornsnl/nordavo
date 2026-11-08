import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoMark } from "@/components/brand/logo";
import { FormHeader, FormRenderer } from "@/components/forms/form-renderer";
import { Skeleton } from "@/components/ui/skeleton";
import { resolvePublicForm } from "@/lib/forms/public";
import { submitApplication } from "./actions";

export const metadata: Metadata = {
  title: "Application form",
  robots: { index: false, follow: false },
};

/** Public application form: no login, one form per link. */
export default function ApplyPage({ params }: PageProps<"/apply/[token]">) {
  return (
    <main lang="en" className="min-h-dvh bg-surface px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Suspense fallback={<FormSkeleton />}>
          <Apply params={params} />
        </Suspense>
        <p className="flex items-center justify-center gap-2 text-xs text-muted">
          <LogoMark className="size-4" />
          Nordavo
        </p>
      </div>
    </main>
  );
}

async function Apply({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePublicForm(token);

  if (resolved.state === "not_found") {
    return <Message title="Form not found" text="Check that you used the whole link, or ask the recruiter for a new one." />;
  }
  if (resolved.state === "unavailable") {
    return <Message title="Not available right now" text="The form cannot be opened at the moment. Please try again later." />;
  }
  if (resolved.state === "closed") {
    return <Message title={resolved.title} text="This form is closed and does not accept applications any more." />;
  }

  const { form } = resolved;
  const prefill = form.prefill
    ? Object.fromEntries(Object.entries(form.prefill).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : null;

  return (
    <>
      <FormHeader title={form.title} intro={form.intro} headerImageUrl={form.headerImageUrl} logoUrl={form.logoUrl} />
      {form.alreadyCompleted && (
        <p role="status" className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          You already filled in this form. Submitting again replaces your earlier answers.
        </p>
      )}
      <FormRenderer blocks={form.blocks} action={submitApplication.bind(null, token)} prefill={prefill} />
    </>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-xs">
      <h1 className="font-display text-xl font-bold text-brand-900">{title}</h1>
      <p className="mt-2 text-sm text-muted">{text}</p>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the form" className="space-y-6">
      <Skeleton className="h-64 w-full rounded-2xl" />
      <Skeleton className="h-80 w-full rounded-2xl" />
    </div>
  );
}
