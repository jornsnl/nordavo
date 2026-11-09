import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { Message, WspPersonView } from "@/components/wsp/person-view";
import { TOKEN_RE } from "@/lib/wsp/data";

export const metadata: Metadata = {
  title: "Working Style Profile",
  robots: { index: false, follow: false },
};

/**
 * The personal link of the Working Style Profile: no account needed. Intro,
 * questionnaire, then the own report with the PDF and "Delete my profile".
 * Sharing with a client needs the own account (RLS on wsp_shares).
 */
export default function WorkingStylePage({ params }: PageProps<"/working-style/[token]">) {
  return (
    <main lang="en" className="min-h-dvh bg-surface px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
          <Person params={params} />
        </Suspense>
        <p className="flex items-center justify-center gap-2 text-xs text-muted">
          <LogoMark className="size-4" />
          Nordavo
        </p>
      </div>
    </main>
  );
}

async function Person({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) {
    return <Message title="Link not found" text="Check that you used the whole link, or ask your contact at Nordavo for a new one." />;
  }
  return <WspPersonView access={{ token }} pdfHref={`/working-style/${token}/pdf`} afterDeleteHref={`/working-style/${token}`} />;
}
