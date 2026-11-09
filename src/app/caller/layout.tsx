import type { Metadata } from "next";
import { installableMetadata } from "@/lib/pwa/manifest";
import { Suspense } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { CallerNav } from "@/components/calls/caller-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { requireCaller } from "@/lib/auth";

export const metadata: Metadata = {
  ...installableMetadata,
  title: { default: "Calling", template: "%s · Nordavo calling" },
};

/**
 * The restricted area for external callers (feedback Julius, section 2.10):
 * their own queue, the call screen and their own overview. Minimal chrome,
 * no portal menu. Every page checks requireCaller() itself; the proxy keeps
 * callers out of everything outside /caller.
 */
export default function CallerLayout({ children }: LayoutProps<"/caller">) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-white/90 pt-safe backdrop-blur-lg">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:h-16 sm:px-6 lg:px-10">
          <Link href="/caller" className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-500">
            <Logo />
          </Link>
          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <CallerNav />
            <span aria-hidden="true" className="hidden h-6 w-px bg-border sm:block" />
            <Suspense fallback={<Skeleton className="hidden h-4 w-24 sm:block" />}>
              <CallerName />
            </Suspense>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="flex size-10 items-center justify-center rounded-lg text-muted transition hover:bg-brand-50 hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-brand-500"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="size-[18px]" aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-10 sm:px-6 sm:pt-8 lg:px-10">{children}</main>
    </div>
  );
}

async function CallerName() {
  const caller = await requireCaller({ allowWithoutMfa: true });
  return <span className="hidden max-w-40 truncate text-sm font-medium text-ink sm:block">{caller.name}</span>;
}
