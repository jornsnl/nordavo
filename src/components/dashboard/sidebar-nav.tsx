"use client";

import { Suspense, use, useId, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type { PortalModule } from "@/lib/database.types";
import { canSeePath } from "@/lib/modules";
import { navSections } from "./nav-items";

/** Sections someone opened or closed by hand, kept in this browser only. */
const STORAGE_KEY = "nordavo.sidebar.sections";

const listeners = new Set<() => void>();
/** Fallback when the browser blocks storage, so the toggles still work this visit. */
let memory: string | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

function parseToggles(raw: string | null): Record<string, boolean> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeToggles(toggles: Record<string, boolean>) {
  memory = JSON.stringify(toggles);
  try {
    window.localStorage.setItem(STORAGE_KEY, memory);
  } catch {
    // Private window or blocked storage: the menu still works, it just forgets.
  }
  for (const listener of listeners) listener();
}

function isActive(href: string, pathname: string | null) {
  if (pathname === null) return false;
  if (href === "/dashboard") return pathname === href;
  if (href === "/dashboard/academy") {
    // Courses: the editor pages, not People, Groups or Library.
    return pathname === href || /^\/dashboard\/academy\/(courses|lessons)(\/|$)/.test(pathname);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Props = {
  onNavigate?: () => void;
  /** Modules of the signed-in user (2.5); null shows everything. */
  modules: Promise<PortalModule[] | null>;
};

/**
 * The current path is request data on dynamic routes, so the active state
 * streams in behind Suspense, and so do the modules the user may see (2.5).
 * The fallback is the menu without the active state and with only the items
 * every team member sees, so no module flashes by for someone without it.
 */
export function SidebarNav({ onNavigate, modules }: Props) {
  return (
    <Suspense fallback={<NavList onNavigate={onNavigate} pathname={null} modules={[]} />}>
      <ActiveNavList onNavigate={onNavigate} modules={modules} />
    </Suspense>
  );
}

function ActiveNavList({ onNavigate, modules }: Props) {
  const pathname = usePathname();
  return <NavList onNavigate={onNavigate} pathname={pathname} modules={use(modules)} />;
}

function NavList({
  onNavigate,
  pathname,
  modules,
}: {
  onNavigate?: () => void;
  pathname: string | null;
  modules: PortalModule[] | null;
}) {
  const sections = navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => canSeePath(item.href, modules)) }))
    .filter((section) => section.items.length > 0);
  // Titled sections start collapsed, except the one with the current page.
  // A section opened or closed by hand stays that way in this browser.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const toggles = useMemo(() => parseToggles(raw), [raw]);
  const toggle = (label: string, open: boolean) => writeToggles({ ...toggles, [label]: !open });
  const baseId = useId();

  return (
    <nav aria-label="Main menu" className="space-y-4">
      {sections.map((section, index) => {
        const hasActive = section.items.some((item) => isActive(item.href, pathname));
        const label = section.label;
        const open = !label || hasActive || toggles[label] === true;
        const listId = `${baseId}-section-${index}`;
        return (
          <div key={label ?? index}>
            {label && (
              <button
                type="button"
                onClick={() => toggle(label, open)}
                aria-expanded={open}
                aria-controls={listId}
                disabled={hasActive}
                className="group/section mb-1 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-semibold tracking-wider text-brand-200/50 uppercase transition hover:text-brand-100 focus-visible:outline-2 focus-visible:outline-accent-500 disabled:cursor-default disabled:hover:text-brand-200/50 max-lg:min-h-11"
              >
                {label}
                <ChevronRight
                  className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
              </button>
            )}
            <ul id={listId} hidden={!open} className="space-y-1">
              {section.items.map(({ label: itemLabel, href, icon: Icon }) => {
                const active = isActive(href, pathname);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      // Taller rows in the phone drawer, so every item is easy to tap.
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition active:bg-white/10 max-lg:min-h-11 max-lg:text-[15px] ${
                        active
                          ? "bg-white/10 text-white"
                          : "text-brand-100/70 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {active && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent-500"
                        />
                      )}
                      <Icon
                        className={`size-[18px] ${
                          active ? "text-accent-500" : "text-brand-200/60 group-hover:text-brand-100"
                        }`}
                        aria-hidden="true"
                      />
                      {itemLabel}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
