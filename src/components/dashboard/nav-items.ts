import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarCheck,
  Contact,
  Filter,
  GraduationCap,
  Handshake,
  HeartHandshake,
  KanbanSquare,
  Library,
  LayoutDashboard,
  ListChecks,
  Phone,
  Radar,
  Route,
  Settings,
  ShieldOff,
  Upload,
  Users,
  UsersRound,
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
      { label: "Work (tasks)", href: "/work", icon: KanbanSquare },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Leads", href: "/dashboard/leads", icon: Radar },
      { label: "Contacts", href: "/dashboard/contacts", icon: Contact },
      { label: "Pipeline", href: "/dashboard/pipeline", icon: Filter },
      { label: "Calls", href: "/dashboard/calls", icon: Phone },
      { label: "Call lists", href: "/dashboard/call-lists", icon: ListChecks },
      { label: "Meetings", href: "/dashboard/meetings", icon: CalendarCheck },
      { label: "Sequences", href: "/dashboard/sequences", icon: Route },
      { label: "Partners", href: "/dashboard/partners", icon: HeartHandshake },
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
    label: "Academy",
    items: [
      { label: "Courses", href: "/dashboard/academy", icon: GraduationCap },
      { label: "People", href: "/dashboard/academy/people", icon: Contact },
      { label: "Groups", href: "/dashboard/academy/groups", icon: UsersRound },
      { label: "Library", href: "/dashboard/academy/library", icon: Library },
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
