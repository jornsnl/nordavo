import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { CandidateCard } from "@/components/portal/candidate-card";
import { ContactCard } from "@/components/portal/contact-card";
import { daysOpen, presentedLabel } from "@/components/portal/vacancy-card";
import { getPortalVacancy } from "@/lib/data/portal";
import { formatDate } from "@/lib/format";
import { optionFor, seniorities, vacancyStatuses } from "@/lib/labels";

export default function PortalVacancyPage({ params }: PageProps<"/portaal/vacatures/[id]">) {
  return (
    <>
      <Link
        href="/portaal"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-900"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Terug naar overzicht
      </Link>
      <Suspense fallback={<VacancySkeleton />}>
        <VacancyDetail params={params} />
      </Suspense>
    </>
  );
}

async function VacancyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vacancy = await getPortalVacancy(id);
  if (!vacancy) notFound();

  const status = optionFor(vacancyStatuses, vacancy.status);
  const isOpen = vacancy.status === "open" || vacancy.status === "on_hold";
  const days = daysOpen(vacancy.openedAt, vacancy.closedAt);

  return (
    <>
      <PageHeader
        eyebrow="Vacature"
        title={vacancy.title}
        description={presentedLabel(vacancy.candidates.length)}
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />

      <div className="grid gap-8 lg:grid-cols-3">
        <section aria-labelledby="candidates-heading" className="space-y-6 lg:col-span-2">
          <div>
            <h2 id="candidates-heading" className="font-display text-lg font-semibold text-brand-900">
              Voorgestelde kandidaten
            </h2>
            <p className="mt-1 text-sm text-muted">
              Geef per kandidaat aan of je verder wilt. Na je akkoord plannen wij de eindgesprekken, ongeveer
              drie keer 45 minuten. Kies je iemand, dan regelen wij contract, payroll en onboarding.
            </p>
          </div>

          {vacancy.candidates.length === 0 ? (
            <EmptyState
              icon={Search}
              title="We zijn nog aan het selecteren"
              description="Iedere kandidaat doet eerst een technische test en een interview in het Engels. Binnen 2 tot 3 weken na de start stellen we drie kandidaten aan je voor. Je ziet ze dan hier."
            />
          ) : (
            <ul className="space-y-6">
              {vacancy.candidates.map((item) => (
                <li key={item.applicationId}>
                  <CandidateCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Over de vacature" />
            <CardBody className="space-y-5">
              <DetailList
                items={[
                  { label: "Niveau", value: optionFor(seniorities, vacancy.seniority).label },
                  { label: "Geopend", value: formatDate(vacancy.openedAt) },
                  {
                    label: isOpen ? "Open sinds" : "Gesloten",
                    value: isOpen
                      ? `${days} ${days === 1 ? "dag" : "dagen"}`
                      : formatDate(vacancy.closedAt, "Onbekend"),
                  },
                  { label: "Gewenste start", value: formatDate(vacancy.desiredStartDate, "In overleg") },
                ]}
              />
              {vacancy.stack.length > 0 && (
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">Stack</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {vacancy.stack.map((item) => (
                      <li key={item}>
                        <Badge tone="brand">{item}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {vacancy.description && (
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">Omschrijving</p>
                  <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink">{vacancy.description}</p>
                </div>
              )}
            </CardBody>
          </Card>
          <ContactCard />
        </aside>
      </div>
    </>
  );
}

function VacancySkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Laden">
      <div className="space-y-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-72 max-w-full" />
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ListSkeleton rows={4} />
        </div>
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
