import type { ContentWorkspace } from "@/lib/content/data";

/**
 * Chosen media of a post (in order), image suggestions and the image brief.
 * Loads its own data; rendered on the post page.
 */
export async function PostMediaPanel({ workspace, postId }: { workspace: ContentWorkspace; postId: string }) {
  void workspace;
  void postId;
  return null;
}
