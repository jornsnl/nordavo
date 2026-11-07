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

export default function PortalVacancyPage({ params }: PageProps<"/portal/vacancies/[id]">) {
  return (
    <>
      <Link
        href="/portal"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-900 active:text-brand-900 max-sm:-my-2 max-sm:mb-4 max-sm:min-h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to overview
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
        eyebrow="Vacancy"
        title={vacancy.title}
        description={presentedLabel(vacancy.candidates.length)}
        // The wrapper takes the full width on phones, the badge keeps its size.
        actions={
          <div>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-3">
        <section aria-labelledby="candidates-heading" className="min-w-0 space-y-6 lg:col-span-2">
          <div>
            <h2 id="candidates-heading" className="font-display text-lg font-semibold text-brand-900">
              Presented candidates
            </h2>
            <p className="mt-1 text-sm text-muted">
              Tell us for each candidate whether you want to continue. Once you approve, we schedule the final
              interviews, about three times 45 minutes. Once you choose someone, we arrange the contract, payroll and onboarding.
            </p>
          </div>

          {vacancy.candidates.length === 0 ? (
            <EmptyState
              icon={Search}
              title="We are still selecting"
              description="Every candidate first takes a technical test and an interview in English. Within 2 to 3 weeks of the start we present three candidates to you. You will see them here."
            />
          ) : (
            <ul className="space-y-4 sm:space-y-6">
              {vacancy.candidates.map((item) => (
                <li key={item.applicationId}>
                  <CandidateCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="About the vacancy" />
            <CardBody className="space-y-5">
              <DetailList
                items={[
                  { label: "Level", value: optionFor(seniorities, vacancy.seniority).label },
                  { label: "Opened", value: formatDate(vacancy.openedAt) },
                  {
                    label: isOpen ? "Open for" : "Closed",
                    value: isOpen
                      ? `${days} ${days === 1 ? "day" : "days"}`
                      : formatDate(vacancy.closedAt, "Unknown"),
                  },
                  { label: "Desired start", value: formatDate(vacancy.desiredStartDate, "To be agreed") },
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
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">Description</p>
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
    <div className="space-y-8" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ListSkeleton rows={4} />
        </div>
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
