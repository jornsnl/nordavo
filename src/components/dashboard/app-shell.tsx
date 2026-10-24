"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Briefcase, CheckSquare, LayoutDashboard, Menu, Radar, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import {
  CommandPalette,
  MobileSearchButton,
  SidebarSearchButton,
} from "@/components/search/command-palette";
import { TabBar, TabButton, type TabItem } from "@/components/ui/tab-bar";
import { SidebarNav } from "./sidebar-nav";

// The most used modules as tabs on phones; everything else sits under "Meer".
const tabs: TabItem[] = [
  { label: "Overzicht", href: "/dashboard", icon: LayoutDashboard, match: (path) => path === "/dashboard" },
  { label: "Taken", href: "/dashboard/taken", icon: CheckSquare },
  { label: "Leads", href: "/dashboard/leads", icon: Radar },
  { label: "Vacatures", href: "/dashboard/vacatures", icon: Briefcase },
];

/**
 * Dashboard chrome: a fixed sidebar on desktop; on phones a top bar, a bottom
 * tab bar and a slide-in drawer with the full menu behind "Meer".
 * The user menu is rendered on the server and passed in as a slot.
 */
export function AppShell({
  userMenu,
  children,
}: {
  userMenu: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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
        <SidebarNav onNavigate={() => setOpen(false)} />
      </div>
      <div className="mt-6 border-t border-white/10 pt-4">{userMenu}</div>
    </div>
  );

  return (
    <div className="min-h-dvh">
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
          <MobileSearchButton onClick={() => setSearchOpen(true)} />
        </div>
      </header>

      <TabBar
        label="Snelmenu"
        items={tabs}
        extra={
          <TabButton
            label="Meer"
            icon={Menu}
            onClick={() => setOpen(true)}
            active={open}
            aria-expanded={open}
            aria-controls="mobile-sidebar"
          />
        }
      />

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
            aria-label="Menu sluiten"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />

      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-6xl pt-6 pb-tabbar pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pt-8 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
