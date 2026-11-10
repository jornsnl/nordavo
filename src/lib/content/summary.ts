// What the Monday summary says about a post (src/lib/content/notify.ts). Pure, unit tested.

export type SummaryPost = {
  title: string;
  status: string;
  plannedDate: string | null;
  timeSlot: string | null;
  formatNeedsMedia: boolean;
  mediaCount: number;
};

const READY = ["approved", "scheduled", "published", "measured"];

/** What is still missing before a post can go live. Pure, unit tested. */
export function missingFor(post: SummaryPost): string[] {
  const missing: string[] = [];
  if (!READY.includes(post.status)) missing.push("not approved");
  if (!post.timeSlot) missing.push("no time slot");
  if (post.formatNeedsMedia && post.mediaCount === 0) missing.push("no media");
  return missing;
}
