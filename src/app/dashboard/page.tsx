import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Briefcase, Building2, Handshake, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Overzicht",
};

const stats = [
  { label: "Actieve klanten", icon: Building2, href: "/dashboard/klanten" },
  { label: "Open vacatures", icon: Briefcase, href: "/dashboard/vacatures" },
  { label: "Kandidaten in selectie", icon: Users, href: "/dashboard/kandidaten" },
  { label: "Lopende plaatsingen", icon: Handshake, href: "/dashboard/plaatsingen" },
];

const process = [
  {
    step: "01",
    title: "Functieprofiel",
    text: "De klant levert de functieomschrijving aan. Wij vertalen die naar een helder profiel.",
  },
  {
    step: "02",
    title: "Sourcing en screening",
    text: "Vakinhoudelijke test door onze specialist en een communicatie-interview in het Engels.",
  },
  {
    step: "03",
    title: "Drie kandidaten",
    text: "Binnen 2 tot 3 weken: drie profielen met video-intro en assessmentuitslagen.",
  },
  {
    step: "04",
    title: "Plaatsing",
    text: "De klant kiest. Wij regelen contract, payroll en onboarding in Bangalore.",
  },
];

export default function DashboardPage() {
  return (
    <>
      <Suspense fallback={<GreetingSkeleton />}>
        <Greeting />
      </Suspense>

      <section aria-labelledby="stats-heading" className="mb-10">
        <h2 id="stats-heading" className="sr-only">
          Kerncijfers
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map(({ label, icon: Icon, href }) => (
            <li key={label}>
              <Link
                href={href}
                className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-xs transition hover:border-brand-200 hover:shadow-md"
              >
                <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-100">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="text-sm text-muted">{label}</span>
                <span className="mt-1 font-display text-3xl font-bold text-brand-900">
                  —
                </span>
                <span className="mt-auto pt-3 text-xs text-muted/80">
                  Nog niet gekoppeld
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="process-heading"
        className="rounded-2xl border border-border bg-card p-6 shadow-xs sm:p-8"
      >
        <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="process-heading"
              className="font-display text-xl font-semibold text-brand-900"
            >
              Zo werkt Nordavo
            </h2>
            <p className="mt-1 text-sm text-muted">
              Van vacature tot developer in jouw team. Dit is het proces dat we
              hier stap voor stap gaan ondersteunen.
            </p>
          </div>
          <Link
            href="/dashboard/vacatures"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-800"
          >
            Naar vacatures
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {process.map(({ step, title, text }) => (
            <li key={step} className="rounded-xl bg-surface p-5">
              <span className="font-display text-sm font-bold text-accent-600">
                {step}
              </span>
              <p className="mt-2 font-display font-semibold text-brand-900">
                {title}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

async function Greeting() {
  const user = await getCurrentUser();
  const firstName = user.name.split(" ")[0];
  const hour = Number(
    new Intl.DateTimeFormat("nl-NL", {
      hour: "numeric",
      hour12: false,
      timeZone: "Europe/Amsterdam",
    }).format(new Date()),
  );
  const greeting =
    hour < 12 ? "Goedemorgen" : hour < 18 ? "Goedemiddag" : "Goedenavond";

  return (
    <header className="mb-8">
      <p className="mb-1.5 text-xs font-semibold tracking-wider text-accent-600 uppercase">
        Overzicht
      </p>
      <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">
        {greeting}, {firstName}
      </h1>
      <p className="mt-2 text-muted">
        Hier zie je straks in één oogopslag hoe het ervoor staat met klanten,
        vacatures en kandidaten.
      </p>
    </header>
  );
}

function GreetingSkeleton() {
  return (
    <div className="mb-8 space-y-3" aria-hidden="true">
      <span className="block h-3 w-20 animate-pulse rounded bg-brand-100" />
      <span className="block h-8 w-64 animate-pulse rounded bg-brand-100" />
      <span className="block h-4 w-96 max-w-full animate-pulse rounded bg-brand-100" />
    </div>
  );
}
