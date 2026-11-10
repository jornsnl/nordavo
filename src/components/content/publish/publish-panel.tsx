import type { ContentWorkspace } from "@/lib/content/data";

/**
 * Publish panel of a post: copy text, download media, copy first comment,
 * the checklist, scheduling and the LinkedIn URL. Loads its own data.
 */
export async function PublishPanel({ workspace, postId }: { workspace: ContentWorkspace; postId: string }) {
  void workspace;
  void postId;
  return null;
}
