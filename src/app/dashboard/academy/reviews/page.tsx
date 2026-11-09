import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { REVIEW_PAGE, type ReviewFilter, listReviewQueue } from "@/lib/academy/learn/admin";
import { hasClaude } from "@/lib/ai/claude";
import { formatDateTime, formatRelativeDays } from "@/lib/format";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { SubmissionStatusBadge } from "@/components/academy/learn/review-badges";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Academy reviews" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const filters: { value: ReviewFilter; label: string }[] = [
  { value: "waiting", label: "Waiting for Nordavo" },
  { value: "changes", label: "Changes requested" },
  { value: "approved", label: "Approved" },
  { value: "all", label: "All" },
];

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="Reviews"
        description="Assignments handed in by learners. Approve or ask for changes with feedback; the learner gets a notification and can hand in again. The AI score is only a proposal."
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filter = filters.find((f) => f.value === params.status)?.value ?? "waiting";
  const items = await listReviewQueue(filter);
  return (
    <section className="space-y-4">
      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f.value}
            href={f.value === "waiting" ? "/dashboard/academy/reviews" : `/dashboard/academy/reviews?status=${f.value}`}
            aria-current={f.value === filter ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              f.value === filter ? "border-brand-500 bg-brand-50 text-brand-900" : "border-border text-muted hover:border-brand-200"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {!hasClaude() && (
        <p className="text-xs text-muted">Claude makes the AI proposal through the MCP in its next run of claude-requests; until then it says pending.</p>
      )}
      {items.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing here" description={filter === "waiting" ? "No assignment is waiting for a review." : "No assignments with this status."} />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Person</TH>
                <TH>Assignment</TH>
                <TH>Status</TH>
                <TH>AI proposal</TH>
                <TH>Score</TH>
                <TH>Handed in</TH>
              </tr>
            </THead>
            <TBody>
              {items.map((item) => (
                <TR key={item.submission.id}>
                  <TD>
                    <Link href={`/dashboard/academy/reviews/${item.submission.id}`} className="font-semibold text-brand-800 hover:underline">
                      {item.personName ?? item.personEmail ?? "Unknown"}
                    </Link>
                    <span className="block text-xs text-muted">{item.personEmail}</span>
                  </TD>
                  <TD>
                    <span className="block text-sm font-medium">{item.blockTitle}</span>
                    <span className="block text-xs text-muted">
                      {item.lessonTitle}
                      {item.submission.attempt > 1 && ` · attempt ${item.submission.attempt}`}
                    </span>
                  </TD>
                  <TD>
                    <SubmissionStatusBadge status={item.submission.status} />
                  </TD>
                  <TD className="text-sm">
                    {item.aiStatus === "ready" && item.aiTotal !== null ? (
                      <Badge tone="brand">{item.aiTotal}/100</Badge>
                    ) : item.aiStatus === "pending" ? (
                      <span className="text-muted">Working…</span>
                    ) : item.aiStatus === "failed" ? (
                      <span className="text-danger">Failed</span>
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </TD>
                  <TD className="text-sm">{item.submission.final_score !== null ? `${item.submission.final_score}/100` : <span className="text-muted">Not set</span>}</TD>
                  <TD className="whitespace-nowrap text-sm text-muted" title={formatDateTime(item.submission.submitted_at)}>
                    {formatRelativeDays(item.submission.submitted_at)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {items.length >= REVIEW_PAGE && <p className="text-xs text-muted">The first {REVIEW_PAGE} are shown.</p>}
        </>
      )}
    </section>
  );
}
