import {
  BarChart3,
  Briefcase,
  Building2,
  CheckSquare,
  Contact,
  Handshake,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Radar,
  Settings,
  ShieldOff,
  Upload,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavSection = {
  label?: string;
  items: NavItem[];
};

// Add a page to the portal by adding it here and creating its route.
export const navSections: NavSection[] = [
  {
    items: [
      { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
      { label: "Tasks", href: "/dashboard/tasks", icon: CheckSquare },
      { label: "Work (task tool)", href: "/work", icon: KanbanSquare },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Leads", href: "/dashboard/leads", icon: Radar },
      { label: "Contacts", href: "/dashboard/contacts", icon: Contact },
      { label: "Lists", href: "/dashboard/lists", icon: ListChecks },
      { label: "Campaigns", href: "/dashboard/campaigns", icon: Megaphone },
      { label: "Report", href: "/dashboard/report", icon: BarChart3 },
    ],
  },
  {
    label: "Recruitment",
    items: [
      { label: "Clients", href: "/dashboard/clients", icon: Building2 },
      { label: "Vacancies", href: "/dashboard/vacancies", icon: Briefcase },
      { label: "Candidates", href: "/dashboard/candidates", icon: Users },
      { label: "Placements", href: "/dashboard/placements", icon: Handshake },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Import", href: "/dashboard/import", icon: Upload },
      { label: "Suppressions", href: "/dashboard/suppressions", icon: ShieldOff },
      { label: "Jobs", href: "/dashboard/jobs", icon: Workflow },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
];
