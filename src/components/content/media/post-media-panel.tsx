import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatNeedsMedia, personName, type ContentWorkspace } from "@/lib/content/data";
import { loadPostMedia } from "@/lib/content/media";
import { PostMediaEditor } from "./post-media-editor";

/**
 * Chosen media of a post (in order), image suggestions and the image brief.
 * Loads its own data; rendered on the post page. Follows the modules media
 * and image_suggestions of the workspace.
 */
export async function PostMediaPanel({ workspace, postId }: { workspace: ContentWorkspace; postId: string }) {
  const showMedia = workspace.modules.media;
  const showSuggestions = workspace.modules.image_suggestions;
  if (!showMedia && !showSuggestions) return null;
  const data = await loadPostMedia(workspace, postId);
  if (!data) return null;
  const locked = ["published", "measured"].includes(data.post.status);
  const needsMedia = formatNeedsMedia(workspace, data.post.format);

  return (
    <Card>
      <CardHeader
        title="Media"
        description={
          needsMedia && data.chosen.length === 0
            ? "This format needs media before the post can be scheduled."
            : "Chosen media goes on LinkedIn in this order."
        }
      />
      <CardBody>
        <PostMediaEditor
          postId={postId}
          canEdit={workspace.canWrite && !locked}
          canEditBrief={workspace.canWrite}
          showMedia={showMedia}
          showSuggestions={showSuggestions}
          chosen={data.chosen}
          suggestions={data.suggestions.map((s) => ({
            ...s,
            by: s.suggestedBy === "claude" ? "Claude" : personName(data.people, s.createdBy),
          }))}
          library={data.library}
          brief={data.post.imageBrief}
          briefBy={data.post.imageBriefBy}
          briefDone={data.post.imageBriefDone}
        />
      </CardBody>
    </Card>
  );
}
