import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { ContentWorkspace } from "@/lib/content/data";
import { loadPostResults } from "@/lib/content/results";
import { dueMeasurements, engagement, isSuccess, measuredAfter } from "@/lib/content/rules";
import type { ContentMeasuredAfter } from "@/lib/content/database";
import { ResultForm } from "@/components/content/results/result-form";

/** Results of a published post after 48 hours and 7 days, green or red. Loads its own data. */
export async function PostResultsPanel({ workspace, postId }: { workspace: ContentWorkspace; postId: string }) {
  if (!workspace.modules.results) return null;
  const { post, results } = await loadPostResults(postId);
  if (!post || !post.publishedAt) return null;
  const done = Object.keys(results) as ContentMeasuredAfter[];
  const due = dueMeasurements(post.publishedAt, done);
  const success = isSuccess(results["7d"], workspace.successThreshold);

  return (
    <Card>
      <CardHeader
        title="Results"
        description={`Success: at least ${workspace.successThreshold} likes plus comments after 7 days.`}
        actions={
          success === null ? null : success ? <Badge tone="success">Success</Badge> : <Badge tone="danger">Below threshold</Badge>
        }
      />
      <CardBody className="grid gap-6 md:grid-cols-2">
        {measuredAfter.map((m) => {
          const result = results[m.value];
          const isDue = due.includes(m.value);
          const ready = Boolean(result) || isDue;
          return (
            <div key={m.value}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{m.label}</h3>
                {result ? (
                  <span className="text-xs text-muted">{engagement(result)} likes plus comments</span>
                ) : isDue ? (
                  <Badge tone="warning">Due</Badge>
                ) : (
                  <span className="text-xs text-muted">Not due yet</span>
                )}
              </div>
              {ready || workspace.role === "admin" ? (
                <ResultForm
                  postId={postId}
                  measuredAfter={m.value}
                  initial={result ?? null}
                  canEdit={workspace.canWrite}
                  offerMeasured={m.value === "7d" && post.status === "published"}
                />
              ) : (
                <p className="text-sm text-muted">You can fill this in {m.value === "48h" ? "48 hours" : "7 days"} after publishing.</p>
              )}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
