import { Suspense } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyName } from "@/components/portal/company-name";
import { PortalNav, PortalNavFallback } from "@/components/portal/portal-nav";
import { PortalUserMenu, PortalUserMenuSkeleton } from "@/components/portal/portal-user-menu";
import { requireClient } from "@/lib/auth";

export default function PortalLayout({ children }: LayoutProps<"/portaal">) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 px-4 sm:px-6 lg:px-10">
          <div className="flex h-16 min-w-0 flex-1 items-center gap-4 md:flex-none">
            <Link
              href="/portaal"
              className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              <Logo />
            </Link>
            <span aria-hidden="true" className="hidden h-6 w-px bg-border sm:block" />
            <span className="hidden min-w-0 sm:flex">
              <Suspense fallback={<Skeleton className="h-4 w-28" />}>
                <CompanyName />
              </Suspense>
            </span>
          </div>
          <div className="order-last w-full md:order-none md:w-auto md:flex-1">
            <Suspense fallback={<PortalNavFallback />}>
              <PortalNav />
            </Suspense>
          </div>
          <div className="flex h-16 items-center">
            <Suspense fallback={<PortalUserMenuSkeleton />}>
              <PortalUserMenu />
            </Suspense>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <Suspense fallback={null}>
          <ClientGate />
        </Suspense>
        {children}
      </main>
    </div>
  );
}

/** Sends staff to /dashboard and unlinked accounts to /login. Data is protected by RLS as well. */
async function ClientGate() {
  await requireClient();
  return null;
}
