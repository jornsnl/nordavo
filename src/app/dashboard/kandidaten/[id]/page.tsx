import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText, KanbanSquare, Mail, Pencil, Phone, Video } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EntityExtras } from "@/components/entity/entity-extras";
import { QuickActions, telHref, type QuickAction } from "@/components/entity/quick-actions";
import { DeleteCandidateButton, LinkVacancyButton } from "@/components/candidates/candidate-actions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { PRESENTED_STAGES } from "@/components/pipeline/stages";
import { listCandidateApplications, listOpenVacancyOptions } from "@/lib/data/applications";
import { getCandidate } from "@/lib/data/candidates";
import { formatDate } from "@/lib/format";
import {
  applicationStages,
  candidateStatuses,
  clientDecisions,
  optionFor,
} from "@/lib/labels";

export const metadata: Metadata = {
  title: "Kandidaat",
};

export default function Page({ params }: PageProps<"/dashboard/kandidaten/[id]">) {
  return (
    <>
      <Link
        href="/dashboard/kandidaten"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 active:text-brand-700 pointer-coarse:mb-2 pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Alle kandidaten
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <CandidateDetail params={params} />
      </Suspense>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Laden">
      <Skeleton className="mb-8 h-12 w-72" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ListSkeleton rows={4} />
          <ListSkeleton rows={3} />
        </div>
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}

async function CandidateDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await getCandidate(id);
  if (!candidate) notFound();

  const [applications, vacancies] = await Promise.all([
    listCandidateApplications(id),
    listOpenVacancyOptions(),
  ]);
  const status = optionFor(candidateStatuses, candidate.status);

  // Phones: the usual next step (call, mail, read the cv) right under the name.
  const quickActions: QuickAction[] = [];
  if (candidate.phone) {
    quickActions.push({ label: "Bellen", href: telHref(candidate.phone), icon: Phone, ariaLabel: `Bel ${candidate.full_name}` });
  }
  if (candidate.email) {
    quickActions.push({ label: "Mailen", href: `mailto:${candidate.email}`, icon: Mail, ariaLabel: `Mail ${candidate.full_name}` });
  }
  if (candidate.cv_path) {
    quickActions.push({ label: "Cv", href: `/dashboard/kandidaten/${id}/cv`, icon: FileText, external: true, ariaLabel: "Cv openen" });
  }
  if (candidate.linkedin_url) {
    quickActions.push({ label: "LinkedIn", href: candidate.linkedin_url, icon: ExternalLink, external: true, ariaLabel: "LinkedIn-profiel" });
  }

  return (
    <>
      <PageHeader
        eyebrow="Kandidaat"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={candidate.full_name} />
            {candidate.full_name}
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
        description={candidate.current_title ?? undefined}
        actions={
          <>
            <ButtonLink href={`/dashboard/kandidaten/${id}/bewerken`} variant="secondary">
              <Pencil aria-hidden="true" />
              Bewerken
            </ButtonLink>
            <DeleteCandidateButton candidateId={id} name={candidate.full_name} />
          </>
        }
      />

      <QuickActions label={`Snel contact met ${candidate.full_name}`} actions={quickActions} />

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 sm:space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Profiel" />
            <CardBody className="space-y-6">
              <DetailList
                items={[
                  { label: "Functie", value: candidate.current_title },
                  { label: "Locatie", value: candidate.location },
                  {
                    label: "Ervaring",
                    value:
                      candidate.years_experience !== null
                        ? `${candidate.years_experience} jaar`
                        : null,
                  },
                  { label: "Eigenaar", value: candidate.owner?.full_name ?? candidate.owner?.email ?? null },
                  {
                    label: "E-mail",
                    value: candidate.email ? (
                      <a className="text-brand-700 hover:underline" href={`mailto:${candidate.email}`}>
                        {candidate.email}
                      </a>
                    ) : null,
                  },
                  {
                    label: "Telefoon",
                    value: candidate.phone ? (
                      <a className="text-brand-700 hover:underline" href={telHref(candidate.phone)}>
                        {candidate.phone}
                      </a>
                    ) : null,
                  },
                ]}
              />
              <div>
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Skills</h3>
                {candidate.skills.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {candidate.skills.map((skill) => (
                      <li key={skill}>
                        <Badge tone="brand">{skill}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted">Nog geen skills ingevuld.</p>
                )}
              </div>
              <div>
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Samenvatting</h3>
                <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink">
                  {candidate.summary ?? <span className="text-muted">Nog geen samenvatting.</span>}
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Vacatures"
              description="Alle pipelines waar deze kandidaat in staat."
              actions={
                <LinkVacancyButton
                  candidateId={id}
                  vacancies={vacancies}
                  linkedVacancyIds={applications.flatMap((a) => (a.vacancy ? [a.vacancy.id] : []))}
                />
              }
            />
            {applications.length === 0 ? (
              <CardBody>
                <p className="text-sm text-muted">
                  Nog niet gekoppeld aan een vacature. Koppel de kandidaat om de selectie te starten.
                </p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {applications.map((application) => {
                  const stage = optionFor(applicationStages, application.stage);
                  const decision = optionFor(clientDecisions, application.client_decision);
                  const presented = PRESENTED_STAGES.includes(application.stage);
                  return (
                    <li key={application.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                      <div className="min-w-0 flex-1">
                        {application.vacancy ? (
                          <Link
                            href={`/dashboard/vacatures/${application.vacancy.id}`}
                            className="font-medium text-brand-900 hover:text-brand-700 hover:underline"
                          >
                            {application.vacancy.title}
                          </Link>
                        ) : (
                          <span className="font-medium text-muted">Onbekende vacature</span>
                        )}
                        <p className="text-sm text-muted">
                          {application.vacancy?.client?.name ?? "Onbekende klant"}
                          {" · "}
                          sinds {formatDate(application.created_at)}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge tone={stage.tone}>{stage.label}</Badge>
                          {presented && <Badge tone={decision.tone}>{decision.label}</Badge>}
                          <span className="text-xs text-muted">
                            Techniek {application.technical_score ?? "nvt"}, Engels{" "}
                            {application.english_score ?? "nvt"}
                          </span>
                        </div>
                      </div>
                      {application.vacancy && (
                        <ButtonLink
                          href={`/dashboard/vacatures/${application.vacancy.id}/pipeline?application=${application.id}`}
                          variant="secondary"
                          size="sm"
                        >
                          <KanbanSquare aria-hidden="true" />
                          Pipeline
                        </ButtonLink>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-6">
          <Card>
            <CardHeader title="Documenten en links" />
            <CardBody>
              <ul className="space-y-3 text-sm">
                <li>
                  {candidate.cv_path ? (
                    <a
                      href={`/dashboard/kandidaten/${id}/cv`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 font-medium text-brand-700 hover:underline active:text-brand-900 pointer-coarse:min-h-10"
                    >
                      <FileText className="size-4 shrink-0" aria-hidden="true" />
                      Cv openen
                    </a>
                  ) : (
                    <span className="flex items-center gap-2 text-muted pointer-coarse:min-h-10">
                      <FileText className="size-4 shrink-0" aria-hidden="true" />
                      Nog geen cv geüpload
                    </span>
                  )}
                </li>
                <li>
                  {candidate.video_url ? (
                    <a
                      href={candidate.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 font-medium text-brand-700 hover:underline active:text-brand-900 pointer-coarse:min-h-10"
                    >
                      <Video className="size-4 shrink-0" aria-hidden="true" />
                      Video-intro bekijken
                    </a>
                  ) : (
                    <span className="flex items-center gap-2 text-muted pointer-coarse:min-h-10">
                      <Video className="size-4 shrink-0" aria-hidden="true" />
                      Nog geen video-intro
                    </span>
                  )}
                </li>
                <li>
                  {candidate.linkedin_url ? (
                    <a
                      href={candidate.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 font-medium text-brand-700 hover:underline active:text-brand-900 pointer-coarse:min-h-10"
                    >
                      <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                      LinkedIn-profiel
                    </a>
                  ) : (
                    <span className="flex items-center gap-2 text-muted pointer-coarse:min-h-10">
                      <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                      Geen LinkedIn
                    </span>
                  )}
                </li>
              </ul>
            </CardBody>
          </Card>

          <Suspense fallback={<ListSkeleton rows={3} />}>
            <EntityExtras entityType="candidate" entityId={id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}
