import type { PortalModule, ProfileRole } from "@/lib/database.types";

/**
 * Who sees what (recruitment brief 2.5). Admins decide per team member which
 * modules they see; admins always see everything. The database enforces the
 * same split through public.has_module() in the RLS policies, so hiding a
 * menu item is only the visible half. Pure, safe for client components.
 */
export const portalModules: { value: PortalModule; label: string; description: string }[] = [
  {
    value: "sales",
    label: "Sales",
    description: "Leads, contacts, pipeline, calls, call lists, meetings, sequences, partners, suppressions and the GTM jobs.",
  },
  {
    value: "recruitment",
    label: "Recruitment",
    description: "Vacancies, candidates, pipelines, interviews, placements and matches.",
  },
  {
    value: "clients",
    label: "Clients",
    description: "Client companies and their contact persons. Recruitment and sales can read client names.",
  },
  {
    value: "report",
    label: "Report",
    description: "The report page; each section also needs its own module (sales or recruitment).",
  },
  {
    value: "academy",
    label: "Academy",
    description: "Nordavo Academy: courses, lessons, people, answers, reviews and progress of clients, developers and candidates.",
  },
];

export const ALL_MODULES: PortalModule[] = portalModules.map((m) => m.value);

export function isPortalModule(value: unknown): value is PortalModule {
  return typeof value === "string" && (ALL_MODULES as string[]).includes(value);
}

/** The modules a user effectively has: admins all, members what is stored, others none. */
export function effectiveModules(role: ProfileRole, stored: readonly string[] | null | undefined): PortalModule[] {
  if (role === "admin") return [...ALL_MODULES];
  if (role !== "member") return [];
  if (!stored) return [...ALL_MODULES];
  return ALL_MODULES.filter((m) => stored.includes(m));
}

/** Dashboard routes that belong to a module. Routes not listed are for every team member. */
const routeModules: [prefix: string, module: PortalModule][] = [
  ["/dashboard/leads", "sales"],
  ["/dashboard/inbox", "sales"],
  ["/dashboard/contacts", "sales"],
  ["/dashboard/pipeline", "sales"],
  ["/dashboard/calls", "sales"],
  ["/dashboard/call-lists", "sales"],
  ["/dashboard/meetings", "sales"],
  ["/dashboard/sequences", "sales"],
  ["/dashboard/partners", "sales"],
  ["/dashboard/suppressions", "sales"],
  ["/dashboard/vacancies", "recruitment"],
  ["/dashboard/candidates", "recruitment"],
  ["/dashboard/placements", "recruitment"],
  ["/dashboard/agenda", "recruitment"],
  ["/dashboard/clients", "clients"],
  ["/dashboard/report", "report"],
  ["/dashboard/academy", "academy"],
];

export function moduleForPath(path: string): PortalModule | null {
  const hit = routeModules.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return hit ? hit[1] : null;
}

/** Whether a menu item (by its href) is visible with these modules. */
export function canSeePath(path: string, modules: readonly PortalModule[] | null): boolean {
  if (modules === null) return true;
  const mod = moduleForPath(path);
  return mod === null || modules.includes(mod);
}

/** Claude's scheduled tasks that belong to recruitment, not sales (docs/claude-jobs.md). */
export const CLAUDE_RECRUITMENT_JOBS: readonly string[] = ["claude-match", "claude-screening"];

/** Claude's task for the AI request queue: it serves several modules, every staff member sees it. */
export const CLAUDE_SHARED_JOBS: readonly string[] = ["claude-requests"];

/** Which module a job belongs to. Mirrors public.job_module() in the database. */
export function jobModule(jobName: string): PortalModule | null {
  // Claude's recruitment tasks (docs/claude-jobs.md); mirrors public.job_module().
  if (CLAUDE_SHARED_JOBS.includes(jobName)) return null;
  if (CLAUDE_RECRUITMENT_JOBS.includes(jobName)) return "recruitment";
  if (/^s[0-9]+-/.test(jobName) || jobName.startsWith("max-") || jobName.startsWith("claude-")) return "sales";
  if (jobName.startsWith("work-") || jobName.startsWith("clickup-")) return null;
  if (jobName.startsWith("academy-")) return "academy";
  return "recruitment";
}

/** Record types of notes, tasks and attachments per module. Mirrors public.can_access_entity(). */
export function moduleForEntity(entityType: string | null | undefined): PortalModule | null {
  switch (entityType) {
    case "company":
      return "sales";
    case "client":
      return "clients";
    case "vacancy":
    case "candidate":
    case "application":
    case "placement":
      return "recruitment";
    default:
      return null;
  }
}

/** Entity types visible with these modules (for filters on notes, tasks and the activity log). */
export function entityTypesFor(modules: readonly PortalModule[]): string[] {
  return ["client", "vacancy", "candidate", "application", "placement", "company"].filter((type) => {
    const mod = moduleForEntity(type);
    return mod === null || modules.includes(mod);
  });
}
