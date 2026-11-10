import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { ResultForm } from "@/components/content/results/result-form";
import { DimensionTables, MonthBars } from "@/components/content/results/dashboard";
import { formatDay } from "@/components/content/planning/meters";
import { getContentWorkspace, requireModule } from "@/lib/content/data";
import { dashboardDimensions, listOpenMeasurements, loadDashboardPosts, publishedPerMonth, recentResults } from "@/lib/content/results";
import { dayKey, engagement, isSuccess } from "@/lib/content/rules";

export const metadata: Metadata = { title: "Results" };

export default function ResultsPage({ params }: PageProps<"/content/w/[slug]/results">) {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Results params={params} />
    </Suspense>
  );
}

async function Results({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const workspace = await getContentWorkspace(slug);
  requireModule(workspace, "results");
  const [open, posts] = await Promise.all([listOpenMeasurements(workspace.id), loadDashboardPosts([workspace.id])]);
  const [dimensions] = await Promise.all([dashboardDimensions(workspace, posts)]);
  const months = publishedPerMonth(posts, workspace.rhythmGoal);
  const recent = recentResults(posts, workspace.successThreshold);
  const latest = posts.filter((p) => p.result7d).slice(0, 10);

  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Results"
        description={`A post is a success with at least ${workspace.successThreshold} likes plus comments after 7 days.`}
      />

      <Card className="mb-6">
        <CardHeader
          title={`Open measurements (${open.length})`}
          description="Everything that is due, so you can fill it in in one go. Numbers from the LinkedIn post analytics."
        />
        <CardBody>
          {open.length === 0 ? (
            <p className="text-sm text-muted">Nothing to measure right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {open.map((m) => (
                <li key={`${m.postId}-${m.measuredAfter}`} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/content/w/${slug}/posts/${m.postId}`} className="font-medium text-ink hover:underline">
                      {m.title}
                    </Link>
                    <Badge tone="warning">{m.measuredAfter === "48h" ? "After 48 hours" : "After 7 days"}</Badge>
                    <span className="text-xs text-muted">Published {formatDay(dayKey(new Date(m.publishedAt)))}</span>
                    {m.linkedinUrl && (
                      <a href={m.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        LinkedIn
                      </a>
                    )}
                  </div>
                  <ResultForm
                    postId={m.postId}
                    measuredAfter={m.measuredAfter}
                    initial={null}
                    canEdit={workspace.canWrite}
                    offerMeasured={m.measuredAfter === "7d" && m.status === "published"}
                    inline
                  />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Published per month" description={`Against the rhythm goal of ${workspace.rhythmGoal} a week.`} />
          <CardBody>
            <MonthBars months={months} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Last 30 days" description="7 day results of posts published in the last 30 days." />
          <CardBody className="grid grid-cols-3 gap-4">
            <Stat label="Measured" value={String(recent.measured)} />
            <Stat label="Avg likes + comments" value={recent.avgEngagement === null ? "–" : String(recent.avgEngagement)} />
            <Stat label="Success rate" value={recent.successRate === null ? "–" : `${recent.successRate}%`} />
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Latest measured posts" />
        <CardBody>
          {latest.length === 0 ? (
            <p className="text-sm text-muted">No 7 day results yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {latest.map((p) => {
                const success = isSuccess(p.result7d, workspace.successThreshold);
                return (
                  <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                    <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${success ? "bg-emerald-500" : "bg-danger"}`} />
                    <Link href={`/content/w/${slug}/posts/${p.id}`} className="min-w-0 flex-1 truncate font-medium text-ink hover:underline">
                      {p.title}
                    </Link>
                    <span className="text-muted tabular-nums">{p.result7d?.impressions ?? "–"} impressions</span>
                    <span className={`font-semibold tabular-nums ${success ? "text-emerald-700" : "text-danger"}`}>{engagement(p.result7d)}</span>
                    <span className="sr-only">{success ? "success" : "below threshold"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <DimensionTables dimensions={dimensions} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-brand-900">{value}</p>
    </div>
  );
}
