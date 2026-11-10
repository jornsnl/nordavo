"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ExternalLink, EyeOff, MessageSquare, Pencil, Plus, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PendingSubmit } from "@/components/placements/form-utils";
import { archiveSourceAction, createSourceAction, updateSourceAction } from "@/app/content/actions/sources";
import type { SourceItem } from "@/lib/content/sources";
import { statusTone } from "@/lib/content/rules";
import { useContentButton, useContentForm } from "@/components/content/media/use-content-action";

type Option = { value: string; label: string };

export function SourceList({
  workspaceId,
  slug,
  sources,
  platforms,
  statusLabels,
  canEdit,
  showIdeas,
}: {
  workspaceId: string;
  slug: string;
  sources: SourceItem[];
  platforms: Option[];
  statusLabels: Record<string, string>;
  canEdit: boolean;
  showIdeas: boolean;
}) {
  const [editing, setEditing] = useState<SourceItem | "new" | null>(null);
  const { pending, run } = useContentButton();
  const platformLabel = (value: string | null) => platforms.find((p) => p.value === value)?.label ?? value;

  return (
    <>
      {canEdit && (
        <div className="mb-4">
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            New source
          </Button>
        </div>
      )}
      {sources.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-brand-200 bg-card px-5 py-10 text-center text-sm text-muted">
          No sources yet. Save a Reddit thread, an X post or a news article to build posts on.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {sources.map((source) => (
            <li key={source.id} className={`rounded-2xl border border-border bg-card p-4 shadow-xs ${source.archived ? "opacity-60" : ""}`}>
              <div className="flex gap-3">
                {source.screenshotUrl && (
                  <a href={`/content/files/${source.id}?kind=source`} target="_blank" rel="noreferrer" className="w-20 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={source.screenshotUrl} alt="Screenshot" className="aspect-square w-full rounded-lg bg-surface object-cover" />
                  </a>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {source.platform && <Badge tone="brand">{platformLabel(source.platform)}</Badge>}
                    {source.namesBlurred ? (
                      <Badge tone="success">
                        <EyeOff className="size-3" aria-hidden="true" />
                        Names blurred
                      </Badge>
                    ) : (
                      source.hasScreenshot && <Badge tone="warning">Names not blurred</Badge>
                    )}
                    {source.archived && <Badge tone="neutral">Archived</Badge>}
                  </div>
                  <h2 className="mt-1.5 font-medium text-brand-900">
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                        {source.title || source.url}
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                      </a>
                    ) : (
                      source.title
                    )}
                  </h2>
                  <p className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
                    {source.sourceDate && <span>{source.sourceDate}</span>}
                    {source.upvotes !== null && (
                      <span className="inline-flex items-center gap-1">
                        <ThumbsUp className="size-3" aria-hidden="true" />
                        {source.upvotes}
                      </span>
                    )}
                    {source.commentsCount !== null && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="size-3" aria-hidden="true" />
                        {source.commentsCount}
                      </span>
                    )}
                  </p>
                  {source.screenshotInstruction && <p className="mt-2 text-sm text-ink">Screenshot: {source.screenshotInstruction}</p>}
                </div>
              </div>
              {(source.posts.length > 0 || (showIdeas && source.ideas.length > 0)) && (
                <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                  {source.posts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <Link href={`/content/w/${slug}/posts/${p.id}`} className="min-w-0 truncate text-brand-700 hover:underline">
                        Post: {p.label}
                      </Link>
                      <Badge tone={statusTone(p.status)}>{statusLabels[p.status] ?? p.status}</Badge>
                    </li>
                  ))}
                  {showIdeas &&
                    source.ideas.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2">
                        <Link href={`/content/w/${slug}/ideas`} className="min-w-0 truncate text-brand-700 hover:underline">
                          Idea: {i.label}
                        </Link>
                        <Badge tone="neutral">{i.status}</Badge>
                      </li>
                    ))}
                </ul>
              )}
              {canEdit && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(source)}>
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => archiveSourceAction(source.id, !source.archived))}>
                    {source.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                    {source.archived ? "Restore" : "Archive"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New source" : "Edit source"}>
        {editing && (
          <SourceForm
            key={editing === "new" ? "new" : editing.id}
            source={editing === "new" ? null : editing}
            workspaceId={workspaceId}
            platforms={platforms}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

function SourceForm({
  source,
  workspaceId,
  platforms,
  onDone,
}: {
  source: SourceItem | null;
  workspaceId: string;
  platforms: Option[];
  onDone: () => void;
}) {
  const action = source ? updateSourceAction.bind(null, source.id) : createSourceAction.bind(null, workspaceId);
  const { state, formAction, pending, errors } = useContentForm(action, onDone);
  return (
    <form action={formAction} className="space-y-4">
      <Field label="Link" htmlFor="source-url" error={errors.url}>
        <Input id="source-url" name="url" type="url" defaultValue={source?.url ?? ""} placeholder="https://www.reddit.com/r/..." />
      </Field>
      <Field label="Title" htmlFor="source-title" error={errors.title}>
        <Input id="source-title" name="title" maxLength={300} defaultValue={source?.title ?? ""} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Platform" htmlFor="source-platform">
          <Select id="source-platform" name="platform" defaultValue={source?.platform ?? ""}>
            <option value="">None</option>
            {platforms.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="source-date" error={errors.source_date}>
          <Input id="source-date" name="source_date" type="date" defaultValue={source?.sourceDate ?? ""} />
        </Field>
        <Field label="Upvotes" htmlFor="source-upvotes" error={errors.upvotes}>
          <Input id="source-upvotes" name="upvotes" inputMode="numeric" defaultValue={source?.upvotes ?? ""} />
        </Field>
        <Field label="Comments" htmlFor="source-comments" error={errors.comments_count}>
          <Input id="source-comments" name="comments_count" inputMode="numeric" defaultValue={source?.commentsCount ?? ""} />
        </Field>
      </div>
      <Field label="Screenshot" htmlFor="source-screenshot" hint="An image, at most 10 MB.">
        <Input id="source-screenshot" name="screenshot" type="file" accept="image/*" />
      </Field>
      {source?.hasScreenshot && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="remove_screenshot" className="size-4 accent-brand-700" />
          Remove the current screenshot
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="names_blurred" defaultChecked={source?.namesBlurred} className="size-4 accent-brand-700" />
        Names are blurred
      </label>
      <Field label="Screenshot instruction" htmlFor="source-instruction" hint="What to crop, blur or highlight.">
        <Textarea id="source-instruction" name="screenshot_instruction" rows={2} maxLength={2000} defaultValue={source?.screenshotInstruction ?? ""} />
      </Field>
      {state.error && <FormMessage error={state.error} />}
      <PendingSubmit pending={pending} pendingLabel="Saving">
        {source ? "Save" : "Add source"}
      </PendingSubmit>
    </form>
  );
}
