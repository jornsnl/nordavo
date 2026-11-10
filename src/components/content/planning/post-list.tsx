import Link from "next/link";
import { StatusBadge } from "@/components/content/status-badge";
import { formatDay } from "@/components/content/planning/meters";

export type PostListItem = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  href: string;
  plannedDate?: string | null;
  slotLabel?: string | null;
  meta?: string | null;
};

/** A compact list of posts with date, slot and status. */
export function PostList({ posts, empty }: { posts: PostListItem[]; empty: string }) {
  if (posts.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {posts.map((post) => (
        <li key={`${post.id}-${post.meta ?? ""}`}>
          <Link href={post.href} className="flex items-center gap-3 py-2.5 hover:bg-brand-50/50 max-sm:min-h-12">
            <span className="w-24 shrink-0 text-xs text-muted tabular-nums">
              {post.plannedDate ? formatDay(post.plannedDate) : "No date"}
              {post.slotLabel && <span className="block font-semibold text-brand-700">{post.slotLabel}</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{post.title}</span>
              {post.meta && <span className="block truncate text-xs text-muted">{post.meta}</span>}
            </span>
            <StatusBadge status={post.status} label={post.statusLabel} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
