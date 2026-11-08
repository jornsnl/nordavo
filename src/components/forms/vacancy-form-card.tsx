import { Suspense } from "react";
import { ClipboardList, Send, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/talent/copy-button";
import { env } from "@/lib/env";
import { getFormSummary } from "@/lib/forms/data";
import { applyUrl } from "@/lib/forms/mail-content";

/** Vacancy page: the application form at a glance, with links to edit, send and see responses. */
export function VacancyFormCard({ vacancyId }: { vacancyId: string }) {
  return (
    <Suspense fallback={<ListSkeleton rows={2} />}>
      <FormCard vacancyId={vacancyId} />
    </Suspense>
  );
}

async function FormCard({ vacancyId }: { vacancyId: string }) {
  const summary = await getFormSummary(vacancyId);
  const base = `/dashboard/vacancies/${vacancyId}`;

  if (summary.status === "none") {
    return (
      <Card>
        <CardHeader
          title="Application form"
          description="No form yet. Candidates fill in the form with their CV, video and compensation."
          actions={
            <ButtonLink href={`${base}/form`} size="sm">
              <ClipboardList aria-hidden="true" />
              Create form
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  const siteUrl = env.siteUrl();
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Application form
            {summary.status === "published" ? <Badge tone="success">Published</Badge> : <Badge>Not live</Badge>}
            {summary.hasUnpublishedChanges && summary.status === "published" && <Badge tone="warning">Unpublished changes</Badge>}
          </span>
        }
        description={`${summary.sent} sent, ${summary.completed} filled in, ${summary.responses} responses.`}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`${base}/form`} variant="secondary" size="sm">
            <ClipboardList aria-hidden="true" />
            Edit form
          </ButtonLink>
          <ButtonLink href={`${base}/form/tracking`} variant="secondary" size="sm">
            <Send aria-hidden="true" />
            Send & track
          </ButtonLink>
          <ButtonLink href={`${base}/responses`} variant="secondary" size="sm">
            <Table2 aria-hidden="true" />
            Responses
          </ButtonLink>
        </div>
        {summary.status === "published" && summary.publicToken && summary.headhuntedToken && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1 text-muted">
              General link <CopyButton text={applyUrl(siteUrl, summary.publicToken)} label="general link" />
            </span>
            <span className="inline-flex items-center gap-1 text-muted">
              Headhunted link <CopyButton text={applyUrl(siteUrl, summary.headhuntedToken)} label="headhunted link" />
            </span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Pipeline page header: to the form pages of this vacancy. */
export function FormPipelineLinks({ vacancyId }: { vacancyId: string }) {
  const base = `/dashboard/vacancies/${vacancyId}`;
  return (
    <>
      <ButtonLink href={`${base}/form/tracking`} variant="secondary" size="sm">
        <Send aria-hidden="true" />
        Send form
      </ButtonLink>
      <ButtonLink href={`${base}/responses`} variant="secondary" size="sm">
        <Table2 aria-hidden="true" />
        Responses
      </ButtonLink>
    </>
  );
}
