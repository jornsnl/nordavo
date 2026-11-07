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
      { label: "Overzicht", href: "/dashboard", icon: LayoutDashboard },
      { label: "Taken", href: "/dashboard/tasks", icon: CheckSquare },
      { label: "Work (takentool)", href: "/work", icon: KanbanSquare },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Leads", href: "/dashboard/leads", icon: Radar },
      { label: "Contacten", href: "/dashboard/contacts", icon: Contact },
      { label: "Lijsten", href: "/dashboard/lists", icon: ListChecks },
      { label: "Campagnes", href: "/dashboard/campaigns", icon: Megaphone },
      { label: "Rapport", href: "/dashboard/report", icon: BarChart3 },
    ],
  },
  {
    label: "Werving",
    items: [
      { label: "Klanten", href: "/dashboard/clients", icon: Building2 },
      { label: "Vacatures", href: "/dashboard/vacancies", icon: Briefcase },
      { label: "Kandidaten", href: "/dashboard/candidates", icon: Users },
      { label: "Plaatsingen", href: "/dashboard/placements", icon: Handshake },
    ],
  },
  {
    label: "Beheer",
    items: [
      { label: "Import", href: "/dashboard/import", icon: Upload },
      { label: "Uitsluitingen", href: "/dashboard/suppressions", icon: ShieldOff },
      { label: "Jobs", href: "/dashboard/jobs", icon: Workflow },
      { label: "Instellingen", href: "/dashboard/settings", icon: Settings },
    ],
  },
];
