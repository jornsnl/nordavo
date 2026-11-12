"use client";

import { Suspense, use, useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { Briefcase, KanbanSquare, LayoutDashboard, Menu, Radar, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import {
  CommandPalette,
  MobileSearchButton,
  SidebarSearchButton,
} from "@/components/search/command-palette";
import { TabBar, TabButton, type TabItem } from "@/components/ui/tab-bar";
import { useDrawer } from "@/components/ui/use-drawer";
import { SyncIndicator } from "@/components/offline/sync-indicator";
import { SyncRuntime } from "@/components/offline/sync-runtime";
import { PortalShortcuts } from "@/components/shortcuts/portal-shortcuts";

/** Kept on the device ahead of time, so they open without a connection (read only, Work tasks also writable). */
const OFFLINE_PAGES = ["/dashboard", "/work", "/dashboard/leads", "/dashboard/vacancies", "/dashboard/candidates", "/dashboard/clients"];
import type { PortalModule } from "@/lib/database.types";
import { canSeePath } from "@/lib/modules";
import { SidebarNav } from "./sidebar-nav";

// The most used modules as tabs on phones; everything else sits under "Meer".
const tabs: TabItem[] = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard, match: (path) => path === "/dashboard" },
  { label: "Work", href: "/work", icon: KanbanSquare },
  { label: "Leads", href: "/dashboard/leads", icon: Radar },
  { label: "Vacancies", href: "/dashboard/vacancies", icon: Briefcase },
];

/**
 * Dashboard chrome: a fixed sidebar on desktop; on phones a top bar, a bottom
 * tab bar and a slide-in drawer with the full menu behind "Meer".
 * The user menu is rendered on the server and passed in as a slot.
 */
export function AppShell({
  userMenu,
  modules,
  children,
}: {
  userMenu: ReactNode;
  /** Modules of the signed-in user (2.5), streamed in; null shows everything. */
  modules: Promise<PortalModule[] | null>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useDrawer(open, close, "mobile-sidebar");

  const moreButton = (
    <TabButton
      label="More"
      icon={Menu}
      onClick={() => setOpen(true)}
      active={open}
      aria-expanded={open}
      aria-controls="mobile-sidebar"
    />
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-900 px-4 py-5 max-lg:pt-[calc(1.25rem+env(safe-area-inset-top))] max-lg:pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
      <Link
        href="/dashboard"
        className="mb-5 flex items-center rounded-lg px-2 focus-visible:outline-2 focus-visible:outline-accent-500"
      >
        <Logo tone="light" />
      </Link>
      <SidebarSearchButton
        onClick={() => {
          setOpen(false);
          setSearchOpen(true);
        }}
      />
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <SidebarNav onNavigate={() => setOpen(false)} modules={modules} />
      </div>
      <div className="mt-6 space-y-2 border-t border-white/10 pt-4">
        <SyncIndicator tone="dark" />
        {userMenu}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      {/* Reads the path (request data): behind Suspense like the menus. */}
      <Suspense fallback={null}>
        <SyncRuntime warm={OFFLINE_PAGES} />
      </Suspense>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        {sidebar}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-white/90 pt-safe backdrop-blur-lg lg:hidden">
        <div className="flex h-14 items-center justify-between px-4 pl-safe pr-safe">
          <Link href="/dashboard" className="rounded-lg focus-visible:outline-2 focus-visible:outline-brand-500">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <SyncIndicator />
            <MobileSearchButton onClick={() => setSearchOpen(true)} />
          </div>
        </div>
      </header>

      <Suspense fallback={<QuickTabs items={tabs.filter((t) => canSeePath(t.href, []))} extra={moreButton} />}>
        <ModuleTabs modules={modules} extra={moreButton} />
      </Suspense>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-40 lg:hidden ${open ? "" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        <div
          className={`absolute inset-0 bg-brand-950/60 transition-opacity ${
            open ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setOpen(false)}
        />
        <div
          id="mobile-sidebar"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          inert={!open}
          className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl transition-transform duration-200 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {sidebar}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-[calc(1.25rem+env(safe-area-inset-top))] right-3 flex size-10 items-center justify-center rounded-lg text-brand-100 hover:bg-white/10"
            aria-label="Close menu"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <PortalShortcuts onSearch={openSearch} portal />

      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-6xl pt-6 pb-tabbar pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pt-8 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

function QuickTabs({ items, extra }: { items: TabItem[]; extra: ReactNode }) {
  return <TabBar label="Quick menu" items={items} extra={extra} />;
}

/** The phone tabs, without modules the user does not have. */
function ModuleTabs({ modules, extra }: { modules: Promise<PortalModule[] | null>; extra: ReactNode }) {
  const visible = use(modules);
  return <QuickTabs items={tabs.filter((t) => canSeePath(t.href, visible))} extra={extra} />;
}
