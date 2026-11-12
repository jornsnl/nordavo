import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, ExternalLink, FileText, KanbanSquare, Mail, Pencil, Phone } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EntityExtras } from "@/components/entity/entity-extras";
import { QuickActions, telHref, type QuickAction } from "@/components/entity/quick-actions";
import { DeleteCandidateButton, LinkVacancyButton } from "@/components/candidates/candidate-actions";
import { MatchingProfileCard } from "@/components/candidates/matching-profile-card";
import { RecordLayout } from "@/components/custom-fields/record-layout";
import { CandidateTabs } from "@/components/candidates/candidate-tabs";
import { VideoIntro } from "@/components/candidates/video-intro";
import { RecruitmentPanel } from "@/components/candidates/recruitment-panel";
import { AcademyCandidateCard } from "@/components/academy/ats/candidate-card";
import { WspCandidateCard } from "@/components/wsp/candidate-card";
import { InterviewsCard } from "@/components/interviews/interviews-card";
import { CompensationCard } from "@/components/forms/compensation-card";
import { CandidateScreeningCard } from "@/components/screening/candidate-screening-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { PRESENTED_STAGES } from "@/components/pipeline/stages";
import { listCandidateApplications, listOpenVacancyOptions } from "@/lib/data/applications";
import { getCandidate, getNextInterview, listCandidateVideos } from "@/lib/data/candidates";
import { getRecordLayout } from "@/lib/custom-fields/data";
import { applyFieldLayout, blockLabel, coreField, findBlock } from "@/lib/custom-fields/layout";
import { ctcBreakdown, formatInr } from "@/lib/forms/compensation";
import { formatDate, formatDateTime } from "@/lib/format";
import { mainApplication, nextStepFor, noticePeriodLabel, videoEmbed } from "@/lib/recruitment/candidate-fields";
import { interviewKindLabel } from "@/lib/recruitment/interviews";
import {
  applicationStages,
  candidateStatuses,
  clientDecisions,
  optionFor,
} from "@/lib/labels";

export const metadata: Metadata = {
  title: "Candidate",
};

// Read CV and CV scoring call Claude from this page.
export const maxDuration = 300;

export default function Page({ params, searchParams }: PageProps<"/dashboard/candidates/[id]">) {
  return (
    <>
      <Link
        href="/dashboard/candidates"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 active:text-brand-700 pointer-coarse:mb-2 pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All candidates
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <CandidateDetail params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
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

async function CandidateDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const candidate = await getCandidate(id);
  if (!candidate) notFound();

  const [applications, vacancies, layout, videos] = await Promise.all([
    listCandidateApplications(id),
    listOpenVacancyOptions(),
    getRecordLayout("candidate"),
    listCandidateVideos(id),
  ]);
  const status = optionFor(candidateStatuses, candidate.status);
  const tabs = layout.tabs.length > 0 ? layout.tabs : [{ key: "overview", label: "Overview" }];
  const rawTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab = tabs.some((t) => t.key === rawTab) ? (rawTab as string) : tabs[0].key;

  // Always at the top: status, the vacancy the candidate is in and the next step.
  const main = mainApplication(applications, applicationStages.map((s) => s.value));
  const nextInterview = await getNextInterview(applications.map((a) => a.id));
  const nextStep = nextInterview?.starts_at
    ? `${interviewKindLabel(nextInterview.kind)} on ${formatDateTime(nextInterview.starts_at)}`
    : nextStepFor(main?.stage ?? null, main?.client_decision);
  const mainStage = main ? optionFor(applicationStages, main.stage) : null;
  const otherVacancies = applications.length - (main ? 1 : 0);

  // Phones: the usual next step (call, mail, read the cv) right under the name.
  const quickActions: QuickAction[] = [];
  if (candidate.phone) {
    quickActions.push({ label: "Call", href: telHref(candidate.phone), icon: Phone, ariaLabel: `Call ${candidate.full_name}` });
  }
  if (candidate.email) {
    quickActions.push({ label: "Email", href: `mailto:${candidate.email}`, icon: Mail, ariaLabel: `Email ${candidate.full_name}` });
  }
  if (candidate.cv_path) {
    quickActions.push({ label: "CV", href: `/dashboard/candidates/${id}/cv`, icon: FileText, external: true, ariaLabel: "Open CV" });
  }
  if (candidate.linkedin_url) {
    quickActions.push({ label: "LinkedIn", href: candidate.linkedin_url, icon: ExternalLink, external: true, ariaLabel: "LinkedIn profile" });
  }

  const profileBlock = findBlock(layout, "profile");
  const skillsField = coreField(profileBlock, "skills", "Skills");
  const summaryField = coreField(profileBlock, "summary", "Summary");

  return (
    <>
      <PageHeader
        eyebrow="Candidate"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={candidate.full_name} />
            {candidate.full_name}
          </span>
        }
        description={candidate.current_title ?? undefined}
        actions={
          <>
            <ButtonLink href={`/dashboard/candidates/${id}/edit`} variant="secondary">
              <Pencil aria-hidden="true" />
              Edit
            </ButtonLink>
            <DeleteCandidateButton candidateId={id} name={candidate.full_name} />
          </>
        }
      />

      <QuickActions label={`Quick contact with ${candidate.full_name}`} actions={quickActions} />

      <section
        aria-label="Where this candidate stands"
        className="mb-4 grid gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-xs sm:mb-6 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-6 sm:px-5"
      >
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Status</p>
          <p className="mt-1">
            <Badge tone={status.tone}>{status.label}</Badge>
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Vacancy</p>
          {main?.vacancy ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Link href={`/dashboard/vacancies/${main.vacancy.id}/pipeline?application=${main.id}`} className="font-medium text-brand-800 hover:underline">
                {main.vacancy.title}
              </Link>
              <span className="text-muted">{main.vacancy.client?.name ?? "No client yet"}</span>
              {mainStage && <Badge tone={mainStage.tone}>{mainStage.label}</Badge>}
              {otherVacancies > 0 && (
                <Link href={`/dashboard/candidates/${id}?tab=selection`} className="text-xs text-muted hover:text-brand-700 hover:underline">
                  +{otherVacancies} more
                </Link>
              )}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">Not in a vacancy yet</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Next step</p>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-ink">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
            {nextStep}
          </p>
        </div>
      </section>

      <CandidateTabs candidateId={id} tabs={tabs} active={tab} />

      <RecordLayout
        entity="candidate"
        recordId={id}
        layout={layout}
        tab={tab}
        gridClassName="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3"
        mainClassName="min-w-0 space-y-4 sm:space-y-6 lg:col-span-2"
        sideClassName="min-w-0 space-y-4 sm:space-y-6"
        blocks={{
          profile: (
            <Card>
              <CardHeader title={blockLabel(layout, "profile", "Profile")} />
              <CardBody className="space-y-6">
                <DetailList
                  items={applyFieldLayout(profileBlock, [
                    { key: "role", label: "Role", value: candidate.current_title },
                    { key: "location", label: "Location", value: candidate.location },
                    {
                      key: "experience",
                      label: "Experience",
                      value:
                        candidate.years_experience !== null
                          ? `${candidate.years_experience} ${candidate.years_experience === 1 ? "year" : "years"}`
                          : null,
                    },
                    { key: "notice_period", label: "Notice period", value: noticePeriodLabel(candidate.notice_period) },
                    { key: "owner", label: "Owner", value: candidate.owner?.full_name ?? candidate.owner?.email ?? null },
                    {
                      key: "email",
                      label: "Email",
                      value: candidate.email ? (
                        <a className="text-brand-700 hover:underline" href={`mailto:${candidate.email}`}>
                          {candidate.email}
                        </a>
                      ) : null,
                    },
                    {
                      key: "phone",
                      label: "Phone",
                      value: candidate.phone ? (
                        <a className="text-brand-700 hover:underline" href={telHref(candidate.phone)}>
                          {candidate.phone}
                        </a>
                      ) : null,
                    },
                  ])}
                />
                {!skillsField.hidden && (
                  <div>
                    <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{skillsField.label}</h3>
                    {candidate.skills.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {candidate.skills.map((skill) => (
                          <li key={skill}>
                            <Badge tone="brand">{skill}</Badge>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-sm text-muted">No skills filled in yet.</p>
                    )}
                  </div>
                )}
                {!summaryField.hidden && (
                  <div>
                    <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{summaryField.label}</h3>
                    <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink">
                      {candidate.summary ?? <span className="text-muted">No summary yet.</span>}
                    </p>
                  </div>
                )}
              </CardBody>
            </Card>
          ),
          documents: (
            <>
              <Card>
                <CardHeader title={blockLabel(layout, "documents", "Documents and links")} />
                <CardBody>
                  <ul className="space-y-3 text-sm">
                    <li>
                      {candidate.cv_path ? (
                        <a
                          href={`/dashboard/candidates/${id}/cv`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 font-medium text-brand-700 hover:underline active:text-brand-900 pointer-coarse:min-h-10"
                        >
                          <FileText className="size-4 shrink-0" aria-hidden="true" />
                          Open CV
                        </a>
                      ) : (
                        <span className="flex items-center gap-2 text-muted pointer-coarse:min-h-10">
                          <FileText className="size-4 shrink-0" aria-hidden="true" />
                          No CV uploaded yet
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
                          LinkedIn profile
                        </a>
                      ) : (
                        <span className="flex items-center gap-2 text-muted pointer-coarse:min-h-10">
                          <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                          No LinkedIn
                        </span>
                      )}
                    </li>
                  </ul>
                </CardBody>
              </Card>
              <Card>
                <div id="video" className="scroll-mt-24" />
                <CardHeader title="Video intro" description="Watch it here. Keep a copy in the portal so it stays available." />
                <CardBody>
                  <VideoIntro candidateId={id} videoUrl={candidate.video_url} embed={videoEmbed(candidate.video_url)} files={videos} />
                </CardBody>
              </Card>
            </>
          ),
          vacancies: (
            <Card>
              <CardHeader
                title={blockLabel(layout, "vacancies", "Vacancies")}
                description="All pipelines this candidate is in."
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
                  <p className="text-sm text-muted">Not linked to a vacancy yet. Link the candidate to start the selection.</p>
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
                              href={`/dashboard/vacancies/${application.vacancy.id}`}
                              className="font-medium text-brand-900 hover:text-brand-700 hover:underline"
                            >
                              {application.vacancy.title}
                            </Link>
                          ) : (
                            <span className="font-medium text-muted">Unknown vacancy</span>
                          )}
                          <p className="text-sm text-muted">
                            {application.vacancy?.client?.name ?? "Unknown client"}
                            {" · "}
                            since {formatDate(application.created_at)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge tone={stage.tone}>{stage.label}</Badge>
                            {presented && <Badge tone={decision.tone}>{decision.label}</Badge>}
                            <span className="text-xs text-muted">
                              Technical {application.technical_score ?? "n/a"}, English {application.english_score ?? "n/a"}
                            </span>
                          </div>
                        </div>
                        {application.vacancy && (
                          <ButtonLink
                            href={`/dashboard/vacancies/${application.vacancy.id}/pipeline?application=${application.id}`}
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
          ),
          recruitment: (
            <Suspense fallback={<ListSkeleton rows={3} />}>
              <RecruitmentPanel candidateId={id} />
            </Suspense>
          ),
          interviews: (
            <Suspense fallback={<ListSkeleton rows={2} />}>
              <InterviewsCard candidateId={id} />
            </Suspense>
          ),
          screening: (
            <Suspense fallback={<ListSkeleton rows={3} />}>
              <CandidateScreeningCard candidateId={id} />
            </Suspense>
          ),
          matching: (
            <Suspense fallback={<ListSkeleton rows={3} />}>
              <MatchingProfileCard candidate={candidate} />
            </Suspense>
          ),
          wsp: (
            <Suspense fallback={<ListSkeleton rows={2} />}>
              <WspCandidateCard candidateId={id} />
            </Suspense>
          ),
          compensation: (
            <>
              <CandidateCtcCard current={candidate.current_ctc_inr_year} expected={candidate.expected_ctc_inr_year} />
              <CompensationCard candidateId={id} />
            </>
          ),
          academy: (
            <Suspense fallback={<ListSkeleton rows={3} />}>
              <AcademyCandidateCard candidateId={id} hasEmail={Boolean(candidate.email)} />
            </Suspense>
          ),
          extras: (
            <Suspense fallback={<ListSkeleton rows={3} />}>
              <EntityExtras entityType="candidate" entityId={id} />
            </Suspense>
          ),
        }}
      />
    </>
  );
}

/** Current and expected CTC the candidate gave us, apart from any vacancy (INR per year). */
function CandidateCtcCard({ current, expected }: { current: number | null; expected: number | null }) {
  const line = (value: number | null) => {
    if (value === null) return null;
    const b = ctcBreakdown(Number(value));
    return `${formatInr(b.perYearInr)} per year (${formatInr(b.perMonthInr)} per month)`;
  };
  return (
    <Card>
      <CardHeader title="CTC" description="As the candidate told us. Per vacancy amounts are below. Internal only." />
      <CardBody>
        <DetailList
          items={[
            { label: "Current CTC", value: line(current) },
            { label: "Expected CTC", value: line(expected) },
          ]}
        />
      </CardBody>
    </Card>
  );
}
