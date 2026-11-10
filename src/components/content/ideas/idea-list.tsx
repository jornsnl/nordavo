"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Archive, ArrowRightCircle, Eye, EyeOff, Inbox, Link2, Merge, Pencil, Star } from "lucide-react";
import {
  ideasToPostAction,
  mergeIdeasAction,
  setIdeaPrivacyAction,
  setIdeaStatusAction,
  updateIdeaAction,
} from "@/app/content/actions/ideas";
import type { IdeaItem, IdeaView } from "@/lib/content/ideas";
import { ideaStatuses, type FieldDef } from "@/lib/content/rules";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PendingSubmit } from "@/components/placements/form-utils";
import { CustomFieldInputs } from "@/components/content/custom-field-inputs";
import { runAction, useContentAction } from "@/components/content/post/use-content-action";

type Choice = { value: string; label: string };

/**
 * The ideas of one view (Inbox, Shortlist or Archive) with their actions:
 * shortlist, archive, share, edit, merge and "Turn into post" (one or
 * several ideas into one draft).
 */
export function IdeaList({
  slug,
  view,
  ideas,
  isAdmin,
  canCreatePosts,
  sources,
  fields,
}: {
  slug: string;
  view: IdeaView;
  ideas: IdeaItem[];
  isAdmin: boolean;
  canCreatePosts: boolean;
  sources: Choice[];
  fields: FieldDef[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<IdeaItem | null>(null);
  const [converting, setConverting] = useState<string[] | null>(null);
  const [merging, setMerging] = useState(false);
  const [pending, startTransition] = useTransition();

  const mayChange = (idea: IdeaItem) => idea.isMine || isAdmin;
  const selectable = ideas.filter((i) => mayChange(i) && i.status !== "converted" && !i.mergedInto);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const act = (promise: Promise<unknown>) => startTransition(async () => void (await promise));

  return (
    <>
      {selected.length > 0 && (
        <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 p-2.5 shadow-sm lg:top-4">
          <span className="px-1 text-sm font-medium text-brand-900">{selected.length} selected</span>
          {canCreatePosts && (
            <Button size="sm" onClick={() => setConverting(selected)}>
              <ArrowRightCircle aria-hidden="true" />
              Turn into post
            </Button>
          )}
          {selected.length > 1 && (
            <Button size="sm" variant="secondary" onClick={() => setMerging(true)}>
              <Merge aria-hidden="true" />
              Merge
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}

      <ul className="space-y-3">
        {ideas.map((idea) => {
          const status = ideaStatuses.find((s) => s.value === idea.status)!;
          const editable = mayChange(idea);
          return (
            <li key={idea.id} className="rounded-2xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-start gap-3">
                {selectable.includes(idea) && (
                  <input
                    type="checkbox"
                    aria-label="Select idea"
                    checked={selected.includes(idea.id)}
                    onChange={() => toggle(idea.id)}
                    className="mt-1 size-5 shrink-0 accent-brand-700"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm whitespace-pre-wrap text-ink">{idea.text}</p>
                  {idea.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage
                    <img src={idea.photoUrl} alt="" className="max-h-48 rounded-xl border border-border object-cover" />
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {view === "archive" && <Badge tone={status.tone}>{status.label}</Badge>}
                    {idea.isPrivate ? <Badge>Private</Badge> : <Badge tone="brand">Shared</Badge>}
                    {idea.tags.map((t) => (
                      <Badge key={t} tone="accent">
                        #{t}
                      </Badge>
                    ))}
                    <span>{formatDate(idea.createdAt)}</span>
                    {!idea.isMine && idea.author && <span>by {idea.author.name}</span>}
                    {idea.link && (
                      <a href={idea.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                        <Link2 className="size-3.5" aria-hidden="true" />
                        Link
                      </a>
                    )}
                    {idea.sourceLabel && <span>Source: {idea.sourceLabel}</span>}
                  </div>
                  {idea.fromPost && (
                    <p className="text-xs text-muted">
                      Next idea after{" "}
                      <Link href={`/content/w/${slug}/posts/${idea.fromPost.id}`} className="font-medium text-brand-700 hover:underline">
                        {idea.fromPost.title}
                      </Link>
                    </p>
                  )}
                  {idea.posts.length > 0 && (
                    <p className="text-xs text-muted">
                      Used in:{" "}
                      {idea.posts.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && ", "}
                          <Link href={`/content/w/${slug}/posts/${p.id}`} className="font-medium text-brand-700 hover:underline">
                            {p.title}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                  {idea.mergedInto && <p className="text-xs text-muted">Merged into another idea.</p>}
                </div>
              </div>

              {editable && !idea.mergedInto && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                  {canCreatePosts && idea.status !== "converted" && (
                    <Button size="sm" onClick={() => setConverting([idea.id])}>
                      <ArrowRightCircle aria-hidden="true" />
                      Turn into post
                    </Button>
                  )}
                  {canCreatePosts && idea.status === "converted" && (
                    <Button size="sm" variant="secondary" onClick={() => setConverting([idea.id])}>
                      <ArrowRightCircle aria-hidden="true" />
                      Another post
                    </Button>
                  )}
                  {idea.status === "new" && (
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(runAction(setIdeaStatusAction(idea.id, "shortlisted")))}>
                      <Star aria-hidden="true" />
                      Shortlist
                    </Button>
                  )}
                  {idea.status !== "new" && idea.status !== "converted" && (
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(runAction(setIdeaStatusAction(idea.id, "new")))}>
                      <Inbox aria-hidden="true" />
                      To inbox
                    </Button>
                  )}
                  {idea.status !== "archived" && idea.status !== "converted" && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(runAction(setIdeaStatusAction(idea.id, "archived")))}>
                      <Archive aria-hidden="true" />
                      Archive
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(runAction(setIdeaPrivacyAction(idea.id, !idea.isPrivate)))}>
                    {idea.isPrivate ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                    {idea.isPrivate ? "Share" : "Make private"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(idea)}>
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {editing && (
        <EditIdeaModal slug={slug} idea={editing} sources={sources} fields={fields} onClose={() => setEditing(null)} />
      )}
      {converting && (
        <ConvertModal
          slug={slug}
          ideas={ideas.filter((i) => converting.includes(i.id))}
          onClose={() => setConverting(null)}
        />
      )}
      {merging && (
        <MergeModal
          ideas={ideas.filter((i) => selected.includes(i.id))}
          onClose={() => setMerging(false)}
          onDone={() => {
            setMerging(false);
            setSelected([]);
          }}
        />
      )}
    </>
  );
}

function EditIdeaModal({
  slug,
  idea,
  sources,
  fields,
  onClose,
}: {
  slug: string;
  idea: IdeaItem;
  sources: Choice[];
  fields: FieldDef[];
  onClose: () => void;
}) {
  const { onSubmit, pending, errors } = useContentAction(updateIdeaAction.bind(null, slug, idea.id), onClose);
  return (
    <Modal open onClose={onClose} title="Edit idea" size="lg">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Idea" htmlFor="idea-text" error={errors.text}>
          <Textarea id="idea-text" name="text" rows={5} defaultValue={idea.text} required maxLength={5000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tags" htmlFor="idea-tags" hint="Separate with commas">
            <Input id="idea-tags" name="tags" defaultValue={idea.tags.join(", ")} />
          </Field>
          <Field label="Link" htmlFor="idea-link" error={errors.link}>
            <Input id="idea-link" name="link" type="url" defaultValue={idea.link ?? ""} />
          </Field>
          <Field label="Source" htmlFor="idea-source" className="sm:col-span-2">
            <Select id="idea-source" name="source_id" defaultValue={idea.sourceId ?? ""}>
              <option value="">None</option>
              {sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <CustomFieldInputs fields={fields} values={idea.customFields} errors={errors} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <PendingSubmit pending={pending} pendingLabel="Saving">
            Save
          </PendingSubmit>
        </div>
      </form>
    </Modal>
  );
}

function ConvertModal({ slug, ideas, onClose }: { slug: string; ideas: IdeaItem[]; onClose: () => void }) {
  const [title, setTitle] = useState(() => ideas[0]?.text.split("\n")[0].slice(0, 120) ?? "");
  const [pending, startTransition] = useTransition();
  return (
    <Modal
      open
      onClose={onClose}
      title="Turn into post"
      description={
        ideas.length > 1
          ? `A draft built from ${ideas.length} ideas. They are linked to the post and set to Converted.`
          : "A new draft, linked to this idea. The idea is set to Converted."
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            await runAction(ideasToPostAction(slug, ideas.map((i) => i.id), title));
          });
        }}
      >
        <Field label="Title of the post" htmlFor="convert-title">
          <Input id="convert-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} autoFocus />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <PendingSubmit pending={pending} pendingLabel="Creating">
            Create draft
          </PendingSubmit>
        </div>
      </form>
    </Modal>
  );
}

function MergeModal({ ideas, onClose, onDone }: { ideas: IdeaItem[]; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState(ideas[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  return (
    <Modal open onClose={onClose} title="Merge ideas" description="Texts and tags are combined into the idea you keep. The others are archived.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            if (await runAction(mergeIdeasAction(target, ideas.map((i) => i.id)))) onDone();
          });
        }}
      >
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium text-ink">Keep</legend>
          {ideas.map((idea) => (
            <label key={idea.id} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 text-sm hover:bg-brand-50">
              <input type="radio" name="target" checked={target === idea.id} onChange={() => setTarget(idea.id)} className="mt-0.5 accent-brand-700" />
              <span className="line-clamp-3">{idea.text}</span>
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <PendingSubmit pending={pending} pendingLabel="Merging">
            Merge {ideas.length} ideas
          </PendingSubmit>
        </div>
      </form>
    </Modal>
  );
}
