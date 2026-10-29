"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCheck, ClipboardList, Inbox, Menu, NotebookPen, Search, Settings, X, type LucideIcon } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { TabBar, TabButton, type TabItem } from "@/components/ui/tab-bar";

const tabs: TabItem[] = [
  { label: "My tasks", href: "/work", icon: ClipboardList, match: (path) => path === "/work" },
  { label: "Review", href: "/work?tab=review", icon: CheckCheck, match: () => false },
  { label: "Log", href: "/work/log", icon: NotebookPen },
  { label: "Search", href: "/work/search", icon: Search },
];

const links: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "My overview", href: "/work", icon: Inbox },
  { label: "Quick log", href: "/work/log", icon: NotebookPen },
  { label: "Search", href: "/work/search", icon: Search },
  { label: "Settings", href: "/work/settings", icon: Settings },
];

/**
 * Chrome of the task tool: a sidebar with the personal pages and every
 * workspace and project the user can open (rendered on the server and passed
 * in), a tab bar and drawer on phones.
 */
export function WorkShell({
  workspaces,
  userMenu,
  children,
}: {
  workspaces: ReactNode;
  userMenu: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-900 px-4 py-5 max-lg:pt-[calc(1.25rem+env(safe-area-inset-top))] max-lg:pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
      <Link href="/work" className="mb-6 flex items-center gap-2.5 rounded-lg px-2 focus-visible:outline-2 focus-visible:outline-accent-500">
        <LogoMark className="size-8" />
        <span className="font-display text-lg font-bold text-white">Work</span>
      </Link>
      <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
        <Suspense fallback={<NavLinks pathname={null} />}>
          <ActiveNavLinks />
        </Suspense>
        {workspaces}
      </div>
      <div className="mt-6 border-t border-white/10 pt-4">{userMenu}</div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      <header className="sticky top-0 z-20 border-b border-border bg-white/90 pt-safe backdrop-blur-lg lg:hidden">
        <div className="flex h-14 items-center gap-2.5 px-4 pl-safe pr-safe">
          <Link href="/work" className="flex items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-500">
            <LogoMark className="size-7" />
            <span className="font-display text-base font-bold text-brand-900">Work</span>
          </Link>
        </div>
      </header>

      <TabBar
        label="Quick menu"
        items={tabs}
        extra={
          <TabButton
            label="More"
            icon={Menu}
            onClick={() => setOpen(true)}
            active={open}
            aria-expanded={open}
            aria-controls="work-drawer"
          />
        }
      />

      <div className={`fixed inset-0 z-40 lg:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div
          className={`absolute inset-0 bg-brand-950/60 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          onClick={() => setOpen(false)}
        />
        <div
          id="work-drawer"
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

      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-6xl pt-6 pb-tabbar pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pt-8 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

function ActiveNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Work">
      <ul className="space-y-1">
        {links.map(({ label, href, icon: Icon }) => {
          const active = pathname !== null && (href === "/work" ? pathname === href : pathname.startsWith(href));
          return (
            <li key={href}>
              <NavLink href={href} active={active}>
                <Icon className={`size-[18px] ${active ? "text-accent-500" : "text-brand-200/60"}`} aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition active:bg-white/10 max-lg:min-h-11 ${
        active ? "bg-white/10 text-white" : "text-brand-100/70 hover:bg-white/5 hover:text-white"
      }`}
    >
      {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent-500" />}
      {children}
    </Link>
  );
}
