import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { z } from "zod";
import { CATEGORY_OPTIONS } from "@/lib/academy/media/files";
import { getDocumentDetail, listWorksheetAnswers } from "@/lib/academy/media/server";
import { answerText, normalizeAnswers, normalizeFields } from "@/lib/academy/media/worksheet";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { DocumentSettingsForm, ReopenWorksheetButton, WorkbookModules } from "@/components/academy/admin/document-forms";
import { DocumentVersions } from "@/components/academy/media/document-parts";
import { WorksheetFieldsEditor } from "@/components/academy/media/worksheet-fields-editor";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Academy document" };

type Props = PageProps<"/dashboard/academy/documents/[id]">;

export default function Page({ params }: Props) {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <DocumentPage params={params} />
    </Suspense>
  );
}

async function DocumentPage({ params }: Pick<Props, "params">) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const detail = await getDocumentDetail(id);
  if (!detail) notFound();
  const { document, versions, use, modules } = detail;
  const worksheet = document.kind === "worksheet";
  const fields = normalizeFields(document.worksheet_fields);
  const answers = worksheet ? await listWorksheetAnswers(id) : [];
  const submitted = answers.filter((a) => a.submittedAt).length;

  return (
    <>
      <Link href="/dashboard/academy/documents" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Documents
      </Link>
      <PageHeader
        eyebrow={worksheet ? "Academy · Worksheet" : "Academy · Document"}
        title={document.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{CATEGORY_OPTIONS.find((c) => c.value === document.category)?.label}</Badge>
            {worksheet ? <Badge tone="brand">{fields.length} fields</Badge> : <Badge tone="neutral">{document.current_version ? `Version ${document.current_version}` : "No file yet"}</Badge>}
            <span className="text-xs">
              {use.blocks.length + use.modules.length === 0 ? "Not used yet" : `Used ${use.blocks.length + use.modules.length}×`}
            </span>
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {worksheet ? (
            <Card>
              <CardHeader title="Fields" description="What the participant fills in. Saved per person; autosaved while typing, then submitted." />
              <CardBody>
                <WorksheetFieldsEditor documentId={document.id} fields={fields} answered={answers.length} />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="File and versions" description="PDF, Word or Excel, up to 20 MB. A new version replaces the file in every lesson; older versions stay here." />
              <CardBody>
                <DocumentVersions document={document} versions={versions} />
              </CardBody>
            </Card>
          )}

          {worksheet && (
            <Card>
              <CardHeader
                title={`Answers (${submitted} submitted, ${answers.length - submitted} in progress)`}
                description="Only Nordavo sees these. Participants see their own; clients and readers never see answers."
                actions={
                  answers.length > 0 ? (
                    <a href={`/dashboard/academy/documents/${document.id}/answers`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                      <Download aria-hidden="true" />
                      CSV
                    </a>
                  ) : undefined
                }
              />
              <CardBody>
                {answers.length === 0 ? (
                  <p className="text-sm text-muted">Nobody has started this worksheet yet.</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Person</TH>
                        <TH>Status</TH>
                        {fields.map((f) => (
                          <TH key={f.key} className="min-w-40">
                            {f.label}
                          </TH>
                        ))}
                        <TH>
                          <span className="sr-only">Actions</span>
                        </TH>
                      </TR>
                    </THead>
                    <TBody>
                      {answers.map((a) => {
                        const values = normalizeAnswers(fields, a.answers);
                        return (
                          <TR key={a.id}>
                            <TD>
                              <Link href={`/dashboard/academy/people/${a.profileId}`} className="font-medium text-brand-800 hover:underline">
                                {a.name}
                              </Link>
                              <p className="text-xs text-muted">{a.email}</p>
                            </TD>
                            <TD>
                              {a.submittedAt ? (
                                <Badge tone="success">Submitted {formatDateTime(a.submittedAt)}</Badge>
                              ) : (
                                <Badge tone="warning">In progress, {formatDateTime(a.updatedAt)}</Badge>
                              )}
                            </TD>
                            {fields.map((f) => (
                              <TD key={f.key} className="align-top text-sm whitespace-pre-line">
                                {answerText(f, values[f.key]) || <span className="text-muted">-</span>}
                              </TD>
                            ))}
                            <TD>{a.submittedAt && <ReopenWorksheetButton answerId={a.id} />}</TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Settings" />
            <CardBody>
              <DocumentSettingsForm document={document} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Used in lessons" description="Add it to a lesson with a document or worksheet block (Use one from the library)." />
            <CardBody>
              {use.blocks.length === 0 ? (
                <p className="text-sm text-muted">No lesson uses it.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {use.blocks.map((b, i) => (
                    <li key={`${b.lessonId}-${i}`}>
                      <Link href={`/dashboard/academy/lessons/${b.lessonId}`} className="text-brand-800 hover:underline">
                        {b.lessonTitle}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Module workbook" description="A workbook belongs to all lessons of a module and is shown on the course page." />
            <CardBody>
              <WorkbookModules documentId={document.id} modules={modules} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
