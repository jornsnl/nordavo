import type { ReactNode } from "react";
import Link from "next/link";
import { Briefcase, Building2, Handshake, Users } from "lucide-react";
import { getOverviewStats } from "@/lib/data/stats";

const cards = [
  { key: "activeClients", label: "Actieve klanten", hint: "Status actief", icon: Building2, href: "/dashboard/klanten" },
  { key: "openVacancies", label: "Open vacatures", hint: "Nog niet ingevuld", icon: Briefcase, href: "/dashboard/vacatures" },
  { key: "candidatesInSelection", label: "Kandidaten in selectie", hint: "Nog niet geplaatst of afgewezen", icon: Users, href: "/dashboard/kandidaten" },
  { key: "activePlacements", label: "Lopende plaatsingen", hint: "Actief of in opzegtermijn", icon: Handshake, href: "/dashboard/plaatsingen" },
] as const;

function CardGrid({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="stats-heading" className="mb-10">
      <h2 id="stats-heading" className="sr-only">
        Kerncijfers
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</ul>
    </section>
  );
}

export async function StatCards() {
  const stats = await getOverviewStats();

  return (
    <CardGrid>
      {cards.map(({ key, label, hint, icon: Icon, href }) => (
        <li key={key}>
          <Link
            href={href}
            className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-xs transition hover:border-brand-200 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-100">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <span className="text-sm text-muted">{label}</span>
            <span className="mt-1 font-display text-3xl font-bold text-brand-900 tabular-nums">
              {stats[key]}
            </span>
            <span className="mt-auto pt-3 text-xs text-muted/80">{hint}</span>
          </Link>
        </li>
      ))}
    </CardGrid>
  );
}

export function StatCardsSkeleton() {
  return (
    <CardGrid>
      {cards.map(({ key, label, icon: Icon }) => (
        <li key={key} className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-xs">
          <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <span className="text-sm text-muted">{label}</span>
          <span className="mt-2 block h-8 w-14 animate-pulse rounded-lg bg-brand-100" aria-hidden="true" />
          <span className="mt-4 block h-3 w-28 animate-pulse rounded bg-brand-100/70" aria-hidden="true" />
        </li>
      ))}
    </CardGrid>
  );
}
