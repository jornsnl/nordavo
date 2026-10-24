"use client";

import { Handshake, LayoutDashboard, ShieldCheck } from "lucide-react";
import { TabBar, type TabItem } from "@/components/ui/tab-bar";
import { isActivePortalPath } from "./nav-items";

const tabs: TabItem[] = [
  {
    label: "Overzicht",
    href: "/portaal",
    icon: LayoutDashboard,
    match: (path) => isActivePortalPath(path, "/portaal"),
  },
  { label: "Plaatsingen", href: "/portaal/plaatsingen", icon: Handshake },
  { label: "Beveiliging", href: "/portaal/beveiliging", icon: ShieldCheck },
];

/** Bottom tabs for the client portal on phones; the header tabs take over from md. */
export function PortalTabBar() {
  return <TabBar label="Klantportaal" items={tabs} hideFrom="md" />;
}
