import Link from "next/link";

/** Tabs above the contacts pages: all contacts and the enrichment for Max (2.13). */
export function ContactTabs({ active }: { active: "all" | "enrich" }) {
  const tab = (isActive: boolean) =>
    `inline-flex items-center gap-2 border-b-2 px-1 pb-3 text-sm max-md:min-h-11 max-md:pt-1 font-semibold whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
      isActive ? "border-brand-700 text-brand-900" : "border-transparent text-muted hover:text-brand-800"
    }`;
  return (
    <nav aria-label="Contacts" className="scrollbar-none mb-6 flex gap-6 overflow-x-auto border-b border-border">
      <Link href="/dashboard/contacts" className={tab(active === "all")} aria-current={active === "all" ? "page" : undefined}>
        All contacts
      </Link>
      <Link href="/dashboard/contacts/enrich" className={tab(active === "enrich")} aria-current={active === "enrich" ? "page" : undefined}>
        Enrich for Max
      </Link>
      <Link href="/dashboard/call-lists" className={tab(false)}>
        Call lists
      </Link>
    </nav>
  );
}
