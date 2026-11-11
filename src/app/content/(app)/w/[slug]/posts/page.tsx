import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { FileText, MessageSquareDiff } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageTabs } from "@/components/work/page-tabs";
import { StatusBadge } from "@/components/content/status-badge";
import { NewPostButton } from "@/components/content/post/new-post-button";
import { getContentWorkspace, optionLabel, statusLabel, type ContentWorkspace } from "@/lib/content/data";
import { listPosts, listSeriesChoices, type PostListItem } from "@/lib/content/posts";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Posts" };

export default function PostsPage({ params, searchParams }: PageProps<"/content/w/[slug]/posts">) {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Posts params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function one(value: string | string[] | undefined) {
  return typeof value === "string" && value ? value : undefined;
}

async function Posts({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const workspace = await getContentWorkspace(slug);
  const filters = { status: one(query.status), series: one(query.series), q: one(query.q) };
  const board = query.view === "board";
  const archived = query.view === "archived";
  const [posts, series] = await Promise.all([
    listPosts(workspace, { ...filters, archived }),
    workspace.modules.series ? listSeriesChoices(workspace.id) : Promise.resolve([]),
  ]);
  const canCreate = workspace.role === "author" || workspace.role === "admin" || workspace.role === "reviewer";
  const base = `/content/w/${slug}/posts`;
  const keep = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])));
  const listHref = keep.size ? `${base}?${keep}` : base;
  const boardParams = new URLSearchParams(keep);
  boardParams.set("view", "board");
  const archivedParams = new URLSearchParams(keep);
  archivedParams.set("view", "archived");

  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Posts"
        description={
          workspace.role === "reviewer"
            ? "Posts that were sent to review, and the ones you started. Drafts of the author stay with the author."
            : "Every post moves through one flow that only ends when it is live and measured."
        }
        actions={canCreate && <NewPostButton slug={slug} />}
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search">
        {(board || archived) && <input type="hidden" name="view" value={board ? "board" : "archived"} />}
        <Input name="q" type="search" placeholder="Search title and text" defaultValue={filters.q ?? ""} className="w-full sm:w-64" aria-label="Search posts" />
        <Select name="status" defaultValue={filters.status ?? ""} aria-label="Status" className="w-full sm:w-48">
          <option value="">All statuses</option>
          {workspace.statuses
            .filter((s) => !s.archived)
            .map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
        </Select>
        {series.length > 0 && (
          <Select name="series" defaultValue={filters.series ?? ""} aria-label="Series" className="w-full sm:w-48">
            <option value="">All series</option>
            {series.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      <div className="mb-4">
        <PageTabs
          label="View"
          tabs={[
            { label: "List", href: listHref, active: !board && !archived },
            { label: "Board", href: `${base}?${boardParams}`, active: board },
            { label: "Archived", href: `${base}?${archivedParams}`, active: archived },
          ]}
        />
      </div>

      {posts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={archived ? "No archived posts" : "No posts"}
          description={
            archived
              ? "Posts you archive land here. Nothing is deleted."
              : canCreate
                ? "Start a post, or turn an idea into one."
                : "Nothing matches, or nothing was sent to review yet."
          }
        />
      ) : board ? (
        <Board workspace={workspace} posts={posts} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
          {posts.map((post) => (
            <li key={post.id}>
              <PostRow workspace={workspace} post={post} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PostRow({ workspace, post }: { workspace: ContentWorkspace; post: PostListItem }) {
  return (
    <Link
      href={`/content/w/${workspace.slug}/posts/${post.id}`}
      className="flex flex-col gap-1.5 px-4 py-3 hover:bg-brand-50/50 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-brand-900">{post.title}</span>
        <span className="mt-0.5 block text-xs text-muted">
          {[optionLabel(workspace, "format", post.format), post.author?.name].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {post.openSuggestions > 0 && (
          <span className="inline-flex items-center gap-1 text-accent-600" title="Open suggestions">
            <MessageSquareDiff className="size-3.5" aria-hidden="true" />
            {post.openSuggestions}
          </span>
        )}
        <span>
          {post.plannedDate ? formatDate(post.plannedDate) : "No date"}
          {post.timeSlot ? ` · ${optionLabel(workspace, "time_slot", post.timeSlot)}` : ""}
        </span>
        <StatusBadge status={post.status} label={statusLabel(workspace, post.status)} />
      </span>
    </Link>
  );
}

function Board({ workspace, posts }: { workspace: ContentWorkspace; posts: PostListItem[] }) {
  const columns = workspace.statuses.filter((s) => !s.archived || posts.some((p) => p.status === s.key));
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-3">
        {columns.map((column) => {
          const items = posts.filter((p) => p.status === column.key);
          return (
            <section key={column.key} className="w-64 shrink-0 rounded-2xl border border-border bg-surface p-2.5">
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-brand-900">
                {column.label}
                <span className="text-xs font-medium text-muted">{items.length}</span>
              </h2>
              <ul className="space-y-2">
                {items.map((post) => (
                  <li key={post.id}>
                    <Link
                      href={`/content/w/${workspace.slug}/posts/${post.id}`}
                      className="block rounded-xl border border-border bg-card p-3 text-sm shadow-xs hover:border-brand-200"
                    >
                      <span className="block font-medium text-brand-900">{post.title}</span>
                      <span className="mt-1 block text-xs text-muted">{post.plannedDate ? formatDate(post.plannedDate) : "No date"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
