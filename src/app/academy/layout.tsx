import type { Metadata } from "next";
import { installableMetadata } from "@/lib/pwa/manifest";
import { Suspense } from "react";
import { AcademyBrand, AcademyHeaderMenu, AcademyHeaderMenuSkeleton } from "@/components/academy/shell/header";
import { PreviewNotice } from "@/components/academy/shell/preview-notice";

export const metadata: Metadata = {
  ...installableMetadata,
  title: { default: "Academy", template: "%s · Nordavo Academy" },
};

/**
 * The learner shell of the Academy: clients, developers, candidates, and
 * Nordavo managers in preview. Light blue with orange actions; works on a
 * phone. Access: proxy (src/lib/academy/routing.ts) and requireAcademyUser().
 */
export default function AcademyLayout({ children }: LayoutProps<"/academy">) {
  return (
    <div className="min-h-dvh bg-academy-blue-50">
      <header className="sticky top-0 z-20 border-b border-academy-blue-200 bg-white/90 pt-safe backdrop-blur-lg">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:h-16 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-10">
          <AcademyBrand />
          <Suspense fallback={<AcademyHeaderMenuSkeleton />}>
            <AcademyHeaderMenu />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pt-8 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-10">
        <Suspense fallback={null}>
          <PreviewNotice />
        </Suspense>
        {children}
      </main>
    </div>
  );
}
