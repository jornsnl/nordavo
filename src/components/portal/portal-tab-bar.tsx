"use client";

import { GraduationCap, Handshake, LayoutDashboard, ShieldCheck } from "lucide-react";
import { TabBar, type TabItem } from "@/components/ui/tab-bar";
import { isActivePortalPath } from "./nav-items";

const tabs: TabItem[] = [
  {
    label: "Overview",
    href: "/portal",
    icon: LayoutDashboard,
    match: (path) => isActivePortalPath(path, "/portal"),
  },
  { label: "Placements", href: "/portal/placements", icon: Handshake },
  { label: "Academy", href: "/academy", icon: GraduationCap },
  { label: "Security", href: "/portal/security", icon: ShieldCheck },
];

/** Bottom tabs for the client portal on phones; the header tabs take over from md. */
export function PortalTabBar() {
  return <TabBar label="Client portal" items={tabs} hideFrom="md" />;
}
