import type { PortalModule } from "@/lib/database.types";
import { canSeePath } from "@/lib/modules";
import { navSections } from "@/components/dashboard/nav-items";
import { fuzzyFilter } from "./fuzzy";

/**
 * Pages for the global search (feedback Julius: Ctrl/Cmd K only found
 * records). Every item of the portal menu, the pages of Work, and a few
 * words people type for them (Dutch too: "vacatures" finds Vacancies).
 */

export type PageEntry = { label: string; href: string; section: string; keywords?: string[] };

const workPages: PageEntry[] = [
  { label: "My tasks", href: "/work", section: "Work", keywords: ["my overview", "taken", "todo"] },
  { label: "To review", href: "/work?tab=review", section: "Work", keywords: ["review", "approve", "beoordelen"] },
  { label: "Add a task", href: "/work/add", section: "Work", keywords: ["new task", "inbox", "quick add", "taak toevoegen"] },
  { label: "Quick log", href: "/work/log", section: "Work", keywords: ["log work", "logged"] },
  { label: "Search tasks", href: "/work/search", section: "Work", keywords: ["zoeken"] },
  { label: "Work settings", href: "/work/settings", section: "Work", keywords: ["time zone", "mails", "api token", "notifications"] },
];

/** Words people use for a menu item, by href. */
const keywords: Record<string, string[]> = {
  "/dashboard": ["dashboard", "home", "overzicht"],
  "/work": ["tasks", "taken", "todo"],
  "/content": ["linkedin", "posts"],
  "/dashboard/leads": ["companies", "bedrijven", "prospects"],
  "/dashboard/contacts": ["people", "contactpersonen"],
  "/dashboard/pipeline": ["deals", "funnel"],
  "/dashboard/calls": ["bellen", "call"],
  "/dashboard/call-lists": ["bellijsten"],
  "/dashboard/meetings": ["afspraken", "appointments"],
  "/dashboard/sequences": ["campaigns", "mail"],
  "/dashboard/report": ["rapport", "stats", "numbers"],
  "/dashboard/clients": ["klanten", "customers"],
  "/dashboard/vacancies": ["vacatures", "jobs"],
  "/dashboard/candidates": ["kandidaten", "talent"],
  "/dashboard/placements": ["plaatsingen"],
  "/dashboard/academy": ["courses", "cursussen"],
  "/dashboard/import": ["upload", "csv"],
  "/dashboard/settings": ["instellingen", "account", "users", "gebruikers"],
};

/** Every page someone may open: the portal menu (team members, by module) and Work. */
export function pageEntries({ staff, modules }: { staff: boolean; modules: readonly PortalModule[] | null }): PageEntry[] {
  const portal: PageEntry[] = staff
    ? navSections.flatMap((section) =>
        section.items
          .filter((item) => canSeePath(item.href, modules))
          .map((item) => ({ label: item.label, href: item.href, section: section.label ?? "Portal", keywords: keywords[item.href] })),
      )
    : [];
  const seen = new Set(portal.map((p) => p.href));
  return [...portal, ...workPages.filter((p) => !seen.has(p.href))];
}

/** Pages that match the query, best first. */
export function searchPages(query: string, entries: PageEntry[], limit = 6): PageEntry[] {
  return fuzzyFilter(query, entries, (p) => [p.label, `${p.section} ${p.label}`, ...(p.keywords ?? [])]).slice(0, limit);
}
