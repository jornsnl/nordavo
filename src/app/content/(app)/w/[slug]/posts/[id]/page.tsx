import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/content/status-badge";
import { StatusBar } from "@/components/content/post/status-bar";
import { PostEditor } from "@/components/content/post/post-editor";
import { SuggestionsPanel } from "@/components/content/post/suggestions-panel";
import { CommentsPanel } from "@/components/content/post/comments-panel";
import { PostFieldsForm } from "@/components/content/post/fields-form";
import { NextIdeaPrompt } from "@/components/content/post/next-idea";
import { PostMediaPanel } from "@/components/content/media/post-media-panel";
import { PublishPanel } from "@/components/content/publish/publish-panel";
import { PostResultsPanel } from "@/components/content/publish/post-results-panel";
import { activeOptions, getContentWorkspace, requireContentUser, statusLabel } from "@/lib/content/data";
import { getPostDetail, listSeriesChoices, mediaChoices, relationChoices } from "@/lib/content/posts";
import { listSourceChoices } from "@/lib/content/ideas";
import { statusMoves } from "@/lib/content/rules";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Post" };

export default function PostPage({ params }: PageProps<"/content/w/[slug]/posts/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Post params={params} />
    </Suspense>
  );
}

async function Post({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const [{ slug, id }, user] = await Promise.all([params, requireContentUser()]);
  const workspace = await getContentWorkspace(slug);
  const detail = await getPostDetail(workspace, id);
  const { post } = detail;

  const fields = workspace.fields.post.filter((f) => !f.archived);
  const needsRelations = fields.some((f) => f.type === "relation" || f.type === "file");
  const [series, sources, relations, files] = await Promise.all([
    workspace.modules.series ? listSeriesChoices(workspace.id) : Promise.resolve(null),
    workspace.modules.sources ? listSourceChoices(workspace.id) : Promise.resolve(null),
    needsRelations ? relationChoices(workspace.id) : Promise.resolve(null),
    needsRelations && fields.some((f) => f.type === "file") ? mediaChoices(workspace.id) : Promise.resolve([]),
  ]);
  const choices: Record<string, { value: string; label: string }[]> = {};
  for (const f of fields) {
    if (f.type === "file") choices[f.key] = files;
    if (f.type === "relation" && f.target) {
      choices[f.key] =
        f.target === "series" ? (series ?? []) : f.target === "source" ? (sources ?? []) : (relations?.[f.target] ?? []);
    }
  }

  const role = workspace.role;
  const isAuthor = post.author_id === user.id;
  const canEdit = role === "admin" || role === "author";
  const canSuggest = role === "reviewer" || (canEdit && !isAuthor);
  const canDecide = role === "admin" || (role === "author" && isAuthor);
  const locked = post.status === "published" || post.status === "measured";
  const moves = statusMoves({
    post: detail.rules,
    role,
    userId: user.id,
    statuses: workspace.statuses.filter((s) => !s.archived),
    transitions: workspace.transitions,
    adminApprovalRequired: workspace.adminApprovalRequired,
  }).map((m) => ({ key: m.to.key, label: m.to.label, allowed: m.allowed, reason: m.reason }));
  const texts = {
    title: post.title,
    hook: post.hook,
    body: post.body,
    closing_question: post.closing_question,
    first_comment: post.first_comment,
  };
  const optionLists = {
    channel: activeOptions(workspace, "channel", post.channel),
    language: activeOptions(workspace, "language", post.language),
    time_slot: activeOptions(workspace, "time_slot", post.time_slot),
    audience: activeOptions(workspace, "audience", post.audience),
    theme: activeOptions(workspace, "theme", post.theme),
    angle: activeOptions(workspace, "angle", post.angle),
    format: activeOptions(workspace, "format", post.format),
    priority: activeOptions(workspace, "priority", post.priority),
  };

  return (
    <>
      <Link href={`/content/w/${slug}/posts`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand-900">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Posts
      </Link>
      <PageHeader
        eyebrow={workspace.name}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {post.title}
            <StatusBadge status={post.status} label={statusLabel(workspace, post.status)} />
          </span>
        }
        description={[detail.author ? `By ${detail.author.name}` : null, `Version ${post.version}`].filter(Boolean).join(" · ")}
        actions={
          <ButtonLink href={`/content/w/${slug}/posts/${id}/versions`} variant="secondary">
            <History aria-hidden="true" />
            Versions
          </ButtonLink>
        }
      />

      <div className="mb-6">
        <StatusBar slug={slug} postId={id} moves={moves} />
      </div>

      {post.published_at && !post.next_idea_done_at && canEdit && workspace.modules.ideas && (
        <div className="mb-6">
          <NextIdeaPrompt slug={slug} postId={id} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Text" description="One text per post. Every save is a version." />
            <CardBody>
              <PostEditor
                key={post.version}
                slug={slug}
                postId={id}
                version={post.version}
                texts={texts}
                authorName={detail.author?.name ?? "Author"}
                canEdit={canEdit}
                canSuggest={canSuggest}
                canComment={workspace.canWrite}
                locked={locked}
              />
            </CardBody>
          </Card>

          {detail.suggestions.length > 0 && (
            <Card>
              <CardHeader
                title={`Suggestions (${detail.suggestions.length})`}
                description={canDecide ? "Accept or reject each change, or all at once." : "Waiting for the author."}
              />
              <CardBody>
                <SuggestionsPanel
                  slug={slug}
                  postId={id}
                  texts={texts}
                  canDecide={canDecide}
                  suggestions={detail.suggestions.map((s) => ({
                    id: s.id,
                    field: s.field,
                    startOffset: s.start_offset,
                    original: s.original_text,
                    replacement: s.replacement_text,
                    note: s.note,
                    authorName: s.authorName,
                    byClaude: s.suggested_by === "claude",
                    createdAt: s.created_at,
                  }))}
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Comments" />
            <CardBody>
              <CommentsPanel
                slug={slug}
                postId={id}
                canComment={workspace.canWrite}
                comments={detail.comments.map((c) => ({
                  id: c.id,
                  field: c.field,
                  quote: c.quote,
                  body: c.body,
                  authorName: c.authorName,
                  createdAt: c.created_at,
                  resolved: Boolean(c.resolved_at),
                  replies: c.replies.map((r) => ({ id: r.id, body: r.body, authorName: r.authorName, createdAt: r.created_at })),
                }))}
              />
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <PublishPanel workspace={workspace} postId={id} />
          </Suspense>
          {workspace.modules.media && (
            <Suspense fallback={<ListSkeleton rows={3} />}>
              <PostMediaPanel workspace={workspace} postId={id} />
            </Suspense>
          )}
          {workspace.modules.results && (
            <Suspense fallback={<ListSkeleton rows={2} />}>
              <PostResultsPanel workspace={workspace} postId={id} />
            </Suspense>
          )}

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <PostFieldsForm
                slug={slug}
                postId={id}
                editable={canEdit}
                values={{
                  channel: post.channel,
                  language: post.language,
                  planned_date: post.planned_date,
                  time_slot: post.time_slot,
                  audience: post.audience,
                  theme: post.theme,
                  angle: post.angle,
                  format: post.format,
                  priority: post.priority,
                  series_id: post.series_id,
                  source_id: post.source_id,
                  notes: post.notes,
                }}
                options={optionLists}
                series={series}
                sources={sources}
                fields={fields}
                custom={detail.customFields}
                choices={choices}
              />
              {detail.ideas.length > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Built from ideas</h3>
                  <ul className="space-y-1.5 text-sm">
                    {detail.ideas.map((idea) => (
                      <li key={idea.id} className="line-clamp-2 text-ink">
                        {idea.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <details>
              <summary className="cursor-pointer px-4 py-3.5 font-display text-base font-semibold text-brand-900 sm:px-5">
                Status history ({detail.log.length})
              </summary>
              <ol className="space-y-2 px-4 pb-4 text-sm sm:px-5">
                {detail.log.map((entry) => (
                  <li key={entry.id} className="flex flex-col">
                    <span className="text-ink">
                      {entry.from_status ? `${statusLabel(workspace, entry.from_status)} → ` : "Created as "}
                      <span className="font-medium">{statusLabel(workspace, entry.to_status)}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {entry.actorName} · {formatDateTime(entry.created_at)}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          </Card>
        </div>
      </div>
    </>
  );
}
