import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, CircleCheck, Handshake } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { ContactCard } from "@/components/portal/contact-card";
import { VacancyCard } from "@/components/portal/vacancy-card";
import { portalStageLabels } from "@/components/portal/labels";
import { requireClient } from "@/lib/auth";
import {
  getPendingReviews,
  getPortalCompany,
  getPortalPlacements,
  getPortalVacancies,
} from "@/lib/data/portal";
import { formatDate } from "@/lib/format";

export default function PortalOverviewPage() {
  return (
    <>
      <Suspense fallback={<GreetingSkeleton />}>
        <Greeting />
      </Suspense>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <Suspense fallback={<ListSkeleton rows={2} />}>
            <PendingReviews />
          </Suspense>

          <section aria-labelledby="vacancies-heading">
            <h2 id="vacancies-heading" className="mb-4 font-display text-lg font-semibold text-brand-900">
              Jouw vacatures
            </h2>
            <Suspense fallback={<VacancyGridSkeleton />}>
              <VacancyGrid />
            </Suspense>
          </section>
        </div>

        <aside className="space-y-6">
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <PlacementsSummary />
          </Suspense>
          <ContactCard />
        </aside>
      </div>
    </>
  );
}

async function Greeting() {
  const [user, company] = await Promise.all([requireClient(), getPortalCompany()]);
  const firstName = user.name.split(" ")[0];
  const hour = Number(
    new Intl.DateTimeFormat("nl-NL", { hour: "numeric", hour12: false, timeZone: "Europe/Amsterdam" }).format(
      new Date(),
    ),
  );
  const greeting = hour < 12 ? "Goedemorgen" : hour < 18 ? "Goedemiddag" : "Goedenavond";

  return (
    <header className="mb-8">
      {company && (
        <p className="mb-1.5 text-xs font-semibold tracking-wider text-accent-600 uppercase">{company.name}</p>
      )}
      <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">
        {greeting}, {firstName}
      </h1>
      <p className="mt-2 max-w-2xl text-muted">
        Hier volg je jouw vacatures en de kandidaten die we voor je hebben geselecteerd.
      </p>
    </header>
  );
}

function GreetingSkeleton() {
  return (
    <div className="mb-8 space-y-3" aria-hidden="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

async function PendingReviews() {
  const pending = await getPendingReviews();
  if (!pending.length) return null;

  return (
    <section aria-labelledby="pending-heading" className="rounded-2xl border border-accent-500/40 bg-accent-100/50 p-5 shadow-xs">
      <h2 id="pending-heading" className="font-display text-lg font-semibold text-brand-900">
        Wacht op jouw reactie
      </h2>
      <p className="mt-1 text-sm text-muted">
        {pending.length === 1
          ? "Er staat één kandidaat voor je klaar. Laat ons weten wat je ervan vindt."
          : `Er staan ${pending.length} kandidaten voor je klaar. Laat ons weten wat je ervan vindt.`}
      </p>
      <ul className="mt-4 divide-y divide-accent-500/20 overflow-hidden rounded-xl border border-accent-500/20 bg-white">
        {pending.map((item) => {
          const stage = portalStageLabels[item.stage];
          return (
            <li key={item.applicationId}>
              <Link
                href={`/portaal/vacatures/${item.vacancyId}#kandidaat-${item.applicationId}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-brand-50/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-brand-900">{item.candidateName}</p>
                  <p className="truncate text-sm text-muted">
                    {item.candidateTitle ? `${item.candidateTitle}, voor ` : "Voor "}
                    {item.vacancyTitle}
                  </p>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  {stage && <Badge tone={stage.tone}>{stage.label}</Badge>}
                  {item.presentedAt && <span className="text-xs text-muted">{formatDate(item.presentedAt)}</span>}
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function VacancyGrid() {
  const vacancies = await getPortalVacancies();

  if (!vacancies.length) {
    return (
      <EmptyState
        icon={BriefcaseBusiness}
        title="Nog geen vacatures"
        description="Zodra we samen het functieprofiel hebben opgesteld, zie je de vacature hier. Binnen 2 tot 3 weken stellen we drie kandidaten aan je voor, met video intro en assessmentuitslagen."
      />
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {vacancies.map((vacancy) => (
        <li key={vacancy.id}>
          <VacancyCard vacancy={vacancy} />
        </li>
      ))}
    </ul>
  );
}

function VacancyGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Laden">
      <Skeleton className="h-44" />
      <Skeleton className="h-44" />
    </div>
  );
}

async function PlacementsSummary() {
  const placements = await getPortalPlacements();
  const current = placements.filter((p) => p.status !== "ended");

  return (
    <Card>
      <CardHeader
        title="Plaatsingen"
        description={
          current.length === 1
            ? "1 developer werkt nu in je team."
            : current.length > 1
              ? `${current.length} developers werken nu in je team.`
              : undefined
        }
      />
      <CardBody>
        {current.length === 0 ? (
          <div className="flex items-start gap-3 text-sm text-muted">
            <Handshake className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
            <p>
              Nog geen lopende plaatsingen. Kies je een kandidaat, dan regelen wij contract, payroll en onboarding.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {current.slice(0, 4).map((p) => (
              <li key={p.id} className="flex items-start gap-3">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-brand-900">{p.candidateName ?? "Developer"}</p>
                  <p className="truncate text-muted">
                    {p.status === "notice" ? "Opgezegd" : `Gestart op ${formatDate(p.startDate)}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {placements.length > 0 && (
          <Link
            href="/portaal/plaatsingen"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-800"
          >
            Alle plaatsingen
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </CardBody>
    </Card>
  );
}
