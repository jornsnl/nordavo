import type { Metadata } from "next";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listMyContentWorkspaces } from "@/lib/content/data";
import { loadReviewerCounts, monthLabel, parseMonth } from "@/lib/content/results";

export const metadata: Metadata = { title: "Reviewer count" };

type Search = Record<string, string | string[] | undefined>;

export default function ReviewerCountPage({ searchParams }: PageProps<"/content/reviewer-count">) {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <ReviewerCount searchParams={searchParams} />
    </Suspense>
  );
}

async function ReviewerCount({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const raw = Array.isArray(search.month) ? search.month[0] : search.month;
  const month = parseMonth(raw);
  const workspaces = (await listMyContentWorkspaces()).filter(
    (w) => (w.role === "admin" || w.role === "reviewer") && w.modules.reviewer_count,
  );
  if (workspaces.length === 0) notFound();
  const rows = await loadReviewerCounts(month, workspaces);

  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Reviewer count"
        description="Posts the reviewer reviewed and published, per month and per workspace: the basis for the invoice. Monthly totals only."
        actions={
          <ButtonLink href={`/content/reviewer-count/export?month=${month}`} variant="secondary">
            <Download aria-hidden="true" />
            Export CSV
          </ButtonLink>
        }
      />
      <form className="mb-6 flex flex-wrap items-end gap-3" action="/content/reviewer-count">
        <Field label="Month" htmlFor="month">
          <Input id="month" name="month" type="month" defaultValue={month} />
        </Field>
        <button type="submit" className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-brand-900 hover:bg-brand-50">
          Show
        </button>
      </form>
      <Card>
        <CardBody className="overflow-x-auto">
          <h2 className="mb-3 font-display text-base font-semibold text-brand-900">{monthLabel(month)}</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">No reviews or publications in this month.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1.5 pr-3 font-medium">Workspace</th>
                  <th className="py-1.5 pr-3 font-medium">Reviewer</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Reviewed</th>
                  <th className="py-1.5 text-right font-medium">Published</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={`${r.workspaceId}-${r.reviewerId}`}>
                    <td className="py-2 pr-3 font-medium text-ink">{r.workspaceName}</td>
                    <td className="py-2 pr-3">{r.reviewerName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.reviewed}</td>
                    <td className="py-2 text-right tabular-nums">{r.published}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-xs text-muted">
            Reviewed: posts the reviewer suggested on, commented on or moved out of review this month. Published: posts the reviewer set to Published this month.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
