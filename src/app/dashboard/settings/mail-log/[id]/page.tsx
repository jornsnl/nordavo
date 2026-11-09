import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { getMailLogEntry, mailLogStatuses } from "@/lib/data/mail-log";
import { formatDateTime } from "@/lib/format";
import { mailCategoryLabel } from "@/lib/notify/categories";

export const metadata: Metadata = {
  title: "Mail",
};

export default function Page({ params }: PageProps<"/dashboard/settings/mail-log/[id]">) {
  return (
    <>
      <Link
        href="/dashboard/settings/mail-log"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Mail log
      </Link>
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Entry params={params} />
      </Suspense>
    </>
  );
}

async function Entry({ params }: { params: PageProps<"/dashboard/settings/mail-log/[id]">["params"] }) {
  const { id } = await params;
  const entry = await getMailLogEntry(id);
  if (!entry) notFound();
  const status = mailLogStatuses.find((s) => s.value === entry.status);

  return (
    <>
      <PageHeader eyebrow={mailCategoryLabel(entry.category)} title={entry.subject} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" />
          <CardBody className="py-5">
            <DetailList
              items={[
                { label: "Status", value: <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? entry.status}</Badge> },
                { label: "Time", value: formatDateTime(entry.created_at) },
                { label: "From", value: entry.from_address ?? "Not set" },
                { label: "To", value: entry.to_addresses.join(", ") || "No recipient" },
                ...(entry.cc_addresses.length > 0 ? [{ label: "CC", value: entry.cc_addresses.join(", ") }] : []),
                ...(entry.reply_to ? [{ label: "Reply to", value: entry.reply_to }] : []),
                ...(entry.resend_id
                  ? [{ label: "Resend id", value: <code className="text-xs break-all">{entry.resend_id}</code> }]
                  : []),
                ...(entry.error
                  ? [{ label: "Error", value: <span className="break-words text-danger">{entry.error}</span> }]
                  : []),
              ]}
            />
          </CardBody>
        </Card>

        {entry.html && (
          <Card>
            <CardHeader title="Preview" description="The mail as it was sent. Links in the preview are disabled." />
            <div>
              {/* Empty sandbox: no scripts, no forms, links do not navigate. */}
              <iframe
                title={`Preview of ${entry.subject}`}
                srcDoc={entry.html}
                sandbox=""
                className="block h-[720px] w-full rounded-b-2xl border-0 bg-brand-50"
              />
            </div>
          </Card>
        )}

        {entry.text_body && (
          <Card>
            <CardHeader title="Plain text version" />
            <CardBody className="py-5">
              <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap break-words text-ink">{entry.text_body}</pre>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
