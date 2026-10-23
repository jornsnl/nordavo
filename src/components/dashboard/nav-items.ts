import {
  Briefcase,
  Building2,
  Handshake,
  LayoutDashboard,
  Settings,
  Users,
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
    items: [{ label: "Overzicht", href: "/dashboard", icon: LayoutDashboard }],
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
      { label: "Instellingen", href: "/dashboard/instellingen", icon: Settings },
    ],
  },
];
