import {
  BarChart3,
  Briefcase,
  Building2,
  CheckSquare,
  Contact,
  Handshake,
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
      { label: "Taken", href: "/dashboard/taken", icon: CheckSquare },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Leads", href: "/dashboard/leads", icon: Radar },
      { label: "Contacten", href: "/dashboard/contacten", icon: Contact },
      { label: "Lijsten", href: "/dashboard/lijsten", icon: ListChecks },
      { label: "Campagnes", href: "/dashboard/campagnes", icon: Megaphone },
      { label: "Rapport", href: "/dashboard/rapport", icon: BarChart3 },
    ],
  },
  {
    label: "Werving",
    items: [
      { label: "Klanten", href: "/dashboard/klanten", icon: Building2 },
      { label: "Vacatures", href: "/dashboard/vacatures", icon: Briefcase },
      { label: "Kandidaten", href: "/dashboard/kandidaten", icon: Users },
      { label: "Plaatsingen", href: "/dashboard/plaatsingen", icon: Handshake },
    ],
  },
  {
    label: "Beheer",
    items: [
      { label: "Import", href: "/dashboard/import", icon: Upload },
      { label: "Uitsluitingen", href: "/dashboard/uitsluitingen", icon: ShieldOff },
      { label: "Jobs", href: "/dashboard/jobs", icon: Workflow },
      { label: "Instellingen", href: "/dashboard/instellingen", icon: Settings },
    ],
  },
];
