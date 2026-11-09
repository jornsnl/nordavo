import Link from "next/link";

/** Overview and Academy tabs on /dashboard/placements/[id] (Academy tab: module academy). */
export function PlacementTabs({ placementId, active }: { placementId: string; active: "overview" | "academy" }) {
  const tabs = [
    { key: "overview", label: "Overview", href: `/dashboard/placements/${placementId}` },
    { key: "academy", label: "Academy", href: `/dashboard/placements/${placementId}?tab=academy` },
  ] as const;
  return (
    <nav aria-label="Placement" className="scrollbar-none -mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-border px-1">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
            active === tab.key ? "border-accent-500 text-brand-900" : "border-transparent text-muted hover:border-brand-200 hover:text-brand-900"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
