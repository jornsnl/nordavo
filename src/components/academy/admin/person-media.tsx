import Link from "next/link";
import { Award, ClipboardList } from "lucide-react";
import { listPersonCertificates, listPersonWorksheets } from "@/lib/academy/media/server";
import { answerText, normalizeAnswers } from "@/lib/academy/media/worksheet";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ReopenWorksheetButton } from "./document-forms";

// Media area on the person page (/dashboard/academy/people/[id]):
// certificates and worksheet answers of one person.

export async function PersonCertificates({ profileId }: { profileId: string }) {
  const certificates = await listPersonCertificates(profileId);
  return (
    <Card>
      <CardHeader title="Certificates" description="Issued automatically when a course is completed." />
      <CardBody>
        {certificates.length === 0 ? (
          <p className="text-sm text-muted">No course completed yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {certificates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <Award className="size-4 shrink-0 text-accent-600" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{c.courseTitle}</span>
                  <span className="block text-xs text-muted">
                    {c.number} · {formatDateTime(c.issued_at)}
                  </span>
                </span>
                <a href={`/academy/certificates/${c.id}?view=1`} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                  PDF
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export async function PersonWorksheets({ profileId }: { profileId: string }) {
  const worksheets = await listPersonWorksheets(profileId);
  return (
    <Card>
      <CardHeader title="Worksheets" description="This person's answers. Only Nordavo sees them." />
      <CardBody>
        {worksheets.length === 0 ? (
          <p className="text-sm text-muted">No worksheet started yet.</p>
        ) : (
          <ul className="space-y-3">
            {worksheets.map((w) => {
              const values = normalizeAnswers(w.fields, w.answers);
              return (
                <li key={w.id}>
                  <details className="rounded-xl border border-border px-4 py-3">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                      <ClipboardList className="size-4 text-brand-600" aria-hidden="true" />
                      <span className="font-medium text-brand-900">{w.title}</span>
                      {w.submittedAt ? <Badge tone="success">Submitted {formatDateTime(w.submittedAt)}</Badge> : <Badge tone="warning">In progress</Badge>}
                    </summary>
                    <dl className="mt-3 space-y-2 text-sm">
                      {w.fields.map((f) => (
                        <div key={f.key}>
                          <dt className="text-xs font-medium text-muted">{f.label}</dt>
                          <dd className="whitespace-pre-line">{answerText(f, values[f.key]) || "-"}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={`/dashboard/academy/documents/${w.documentId}`} className="text-xs font-medium text-brand-700 hover:underline">
                        All answers to this worksheet
                      </Link>
                      {w.submittedAt && <ReopenWorksheetButton answerId={w.id} />}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
