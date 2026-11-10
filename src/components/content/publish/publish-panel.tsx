import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatNeedsMedia, requireContentUser, type ContentWorkspace } from "@/lib/content/data";
import { loadPublishData, timeSlots } from "@/lib/content/planning";
import { linkedInText, statusMoves } from "@/lib/content/rules";
import { PublishPanelClient } from "./publish-panel-client";

const SHOWN_IN = ["approved", "scheduled", "published", "measured"];

/**
 * Publish panel of a post: copy text, download media, copy first comment,
 * the checklist, scheduling and the LinkedIn URL. Loads its own data.
 * There is no LinkedIn integration: the reviewer schedules or posts in
 * LinkedIn herself and records it here.
 */
export async function PublishPanel({ workspace, postId }: { workspace: ContentWorkspace; postId: string }) {
  const [user, data] = await Promise.all([requireContentUser(), loadPublishData(postId)]);
  if (!data || !SHOWN_IN.includes(data.post.status)) return null;
  const { post } = data;

  const moves = statusMoves({
    post: {
      status: post.status,
      authorId: post.authorId,
      approvedAt: post.approvedAt,
      publishedAt: post.publishedAt,
      plannedDate: post.plannedDate,
      timeSlot: post.timeSlot,
      linkedinUrl: post.linkedinUrl ?? "pending",
      formatNeedsMedia: formatNeedsMedia(workspace, post.format),
      mediaCount: data.media.length,
      has7dResults: data.has7dResults,
    },
    role: workspace.role,
    userId: user.id,
    statuses: workspace.statuses.filter((s) => !s.archived),
    transitions: workspace.transitions,
    adminApprovalRequired: workspace.adminApprovalRequired,
  });
  // The URL is pasted in the same step, so it is not a reason here.
  const scheduleMove = moves.find((m) => m.to.key === "scheduled");
  const publishMove = moves.find((m) => m.to.key === "published");
  const needsMedia = formatNeedsMedia(workspace, post.format);

  return (
    <Card>
      <CardHeader
        title="Publish"
        description="There is no LinkedIn connection: copy the text and media, schedule or post in LinkedIn, then record it here."
      />
      <CardBody className="space-y-5">
        <PublishPanelClient
          postId={post.id}
          status={post.status}
          text={linkedInText({ hook: post.hook, body: post.body, closingQuestion: post.closingQuestion })}
          firstComment={post.firstComment}
          media={data.media.map((m, i) => ({
            id: m.id,
            fileName: m.fileName,
            href: `/content/files/${m.id}?download=${encodeURIComponent(`${String(i + 1).padStart(2, "0")}-${m.fileName}`)}`,
          }))}
          needsMedia={needsMedia}
          needsBlurCheck={data.needsBlurCheck}
          plannedDate={post.plannedDate}
          timeSlot={post.timeSlot}
          linkedinUrl={post.linkedinUrl}
          slots={timeSlots(workspace, post.timeSlot).map((s) => ({ value: s.value, label: s.label, weekdays: s.weekdays, archived: s.archived }))}
          canEdit={workspace.canWrite}
          schedule={scheduleMove ? { allowed: scheduleMove.allowed, reason: scheduleMove.reason } : null}
          publish={publishMove ? { allowed: publishMove.allowed, reason: publishMove.reason } : null}
        />
      </CardBody>
    </Card>
  );
}
