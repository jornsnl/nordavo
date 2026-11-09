"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Columns3, List } from "lucide-react";
import type { WorkPriority } from "@/lib/work/database";
import { priorityStyles } from "@/lib/sales/labels";

const priorityOrder: WorkPriority[] = ["urgent", "high", "normal", "low"];

/** The current URL with one param changed (or removed), other params kept. */
function useHref(basePath: string) {
  const params = useSearchParams();
  return (name: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    const query = next.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
}

/** Priority filter as chips in the fixed priority colors. Click again to clear. */
export function PriorityChips({ basePath }: { basePath: string }) {
  const params = useSearchParams();
  const hrefWith = useHref(basePath);
  const current = params.get("priority");
  return (
    <nav
      aria-label="Priority"
      // Phones: one row that scrolls sideways, next to the view toggle. Wider: chips wrap.
      className="-my-1 flex min-w-0 snap-strip scrollbar-none items-center gap-1.5 py-1 *:shrink-0 sm:flex-wrap sm:overflow-visible"
    >
      <Link
        href={hrefWith("priority", null)}
        scroll={false}
        aria-current={!current ? "page" : undefined}
        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition pointer-coarse:min-h-9 focus-visible:outline-2 focus-visible:outline-brand-500 ${
          !current ? "border-brand-700 bg-brand-700 text-white" : "border-border bg-white text-muted hover:text-ink"
        }`}
      >
        Any priority
      </Link>
      {priorityOrder.map((value) => {
        const style = priorityStyles[value];
        const active = current === value;
        return (
          <Link
            key={value}
            href={hrefWith("priority", active ? null : value)}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition pointer-coarse:min-h-9 focus-visible:outline-2 focus-visible:outline-brand-500 ${
              active ? `${style.chip} ring-2 ring-brand-500 ring-offset-1` : "border-border bg-white text-ink hover:bg-surface"
            }`}
          >
            <span className={`size-2 rounded-full ${active && value === "urgent" ? "bg-white" : style.dot}`} aria-hidden="true" />
            {style.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** List or board, kept in ?view=board. */
export function ViewToggle({ basePath, view }: { basePath: string; view: "list" | "board" }) {
  const hrefWith = useHref(basePath);
  const options = [
    { value: "list" as const, label: "List", icon: List, href: hrefWith("view", null) },
    { value: "board" as const, label: "Board", icon: Columns3, href: hrefWith("view", "board") },
  ];
  return (
    <nav aria-label="View" className="inline-flex w-fit shrink-0 rounded-xl border border-border bg-white p-1 shadow-xs">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === view;
        return (
          <Link
            key={option.value}
            href={option.href}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={`relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition pointer-coarse:min-h-9 focus-visible:outline-2 focus-visible:outline-brand-500 ${
              active ? "bg-brand-700 text-white" : "text-muted hover:bg-brand-50 hover:text-brand-900"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {/* Icon only on phones, so the toggle fits on the toolbar row. */}
            <span className="max-sm:sr-only">{option.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
