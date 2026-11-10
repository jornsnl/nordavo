import type { ContentWorkspace } from "@/lib/content/data";

/** Results of a published post after 48 hours and 7 days, green or red. Loads its own data. */
export async function PostResultsPanel({ workspace, postId }: { workspace: ContentWorkspace; postId: string }) {
  void workspace;
  void postId;
  return null;
}
