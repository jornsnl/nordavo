import { Suspense } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyName } from "@/components/portal/company-name";
import { PortalNav, PortalNavFallback } from "@/components/portal/portal-nav";
import { PortalTabBar } from "@/components/portal/portal-tab-bar";
import { PortalUserMenu, PortalUserMenuSkeleton } from "@/components/portal/portal-user-menu";
import { requireClient } from "@/lib/auth";

export default function PortalLayout({ children }: LayoutProps<"/portaal">) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-white/90 pt-safe backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-x-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-10">
          <div className="flex h-14 min-w-0 flex-1 items-center gap-4 md:h-16 md:flex-none">
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
          <div className="hidden md:block md:flex-1">
            <Suspense fallback={<PortalNavFallback />}>
              <PortalNav />
            </Suspense>
          </div>
          <div className="flex h-14 items-center md:h-16">
            <Suspense fallback={<PortalUserMenuSkeleton />}>
              <PortalUserMenu />
            </Suspense>
          </div>
        </div>
      </header>

      <PortalTabBar />

      <main className="mx-auto w-full max-w-6xl pt-6 pb-tabbar pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pt-8 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] md:pb-8 lg:px-10 lg:py-10">
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
