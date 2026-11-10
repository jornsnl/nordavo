"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Ban, Check, CircleCheck, ImagePlus, Lightbulb, Plus, Sparkles, Star, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PendingSubmit } from "@/components/placements/form-utils";
import {
  acceptImageBriefAction,
  addImageSuggestionAction,
  addPostMediaAction,
  clearImageBriefAction,
  movePostMediaAction,
  pickImageSuggestionAction,
  rejectAllImageSuggestionsAction,
  rejectImageSuggestionAction,
  removePostMediaAction,
  saveImageBriefAction,
  setImageBriefDoneAction,
} from "@/app/content/actions/media";
import type { ImageSuggestionItem, PickerItem } from "@/lib/content/media";
import type { ContentImageBrief, ContentSuggestedBy } from "@/lib/content/database";
import { imageBriefFields } from "@/lib/content/rules";
import { MediaThumb } from "./media-thumb";
import { useContentButton, useContentForm } from "./use-content-action";

type Suggestion = ImageSuggestionItem & { by: string };

export function PostMediaEditor({
  postId,
  canEdit,
  canEditBrief,
  showMedia,
  showSuggestions,
  chosen,
  suggestions,
  library,
  brief,
  briefBy,
  briefDone,
}: {
  postId: string;
  canEdit: boolean;
  canEditBrief: boolean;
  showMedia: boolean;
  showSuggestions: boolean;
  chosen: (PickerItem & { position: number })[];
  suggestions: Suggestion[];
  library: PickerItem[];
  brief: ContentImageBrief | null;
  briefBy: ContentSuggestedBy | null;
  briefDone: boolean;
}) {
  const [picker, setPicker] = useState<"choose" | "suggest" | null>(null);
  const pending = suggestions.filter((s) => s.status === "pending");

  return (
    <div className="space-y-6">
      {showMedia && (
        <section aria-labelledby={`chosen-${postId}`} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 id={`chosen-${postId}`} className="text-sm font-semibold text-brand-900">
              Chosen media
            </h3>
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={() => setPicker("choose")}>
                <ImagePlus aria-hidden="true" />
                Add media
              </Button>
            )}
          </div>
          <ChosenList postId={postId} chosen={chosen} canEdit={canEdit} />
        </section>
      )}

      {showSuggestions && (
        <section aria-labelledby={`suggest-${postId}`} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`suggest-${postId}`} className="text-sm font-semibold text-brand-900">
              Image suggestions <span className="font-normal text-muted">({pending.length} of 3)</span>
            </h3>
            {canEdit && (
              <div className="flex gap-2">
                {pending.length > 1 && <RejectAll postId={postId} />}
                {pending.length < 3 && showMedia && (
                  <Button size="sm" variant="ghost" onClick={() => setPicker("suggest")}>
                    <Plus aria-hidden="true" />
                    Suggest an image
                  </Button>
                )}
              </div>
            )}
          </div>
          <SuggestionList suggestions={pending} canEdit={canEdit} chosenIds={chosen.map((c) => c.id)} />
          {pending.length === 0 && <p className="text-sm text-muted">No open suggestions.</p>}
        </section>
      )}

      {showSuggestions && <BriefSection postId={postId} brief={brief} briefBy={briefBy} briefDone={briefDone} canEdit={canEditBrief} />}

      <Modal
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === "suggest" ? "Suggest an image" : "Add media"}
        description="From this workspace and the company library."
        size="lg"
      >
        {picker && (
          <Picker
            postId={postId}
            mode={picker}
            library={library}
            chosenIds={chosen.map((c) => c.id)}
            onDone={() => setPicker(null)}
          />
        )}
      </Modal>
    </div>
  );
}

function ChosenList({ postId, chosen, canEdit }: { postId: string; chosen: (PickerItem & { position: number })[]; canEdit: boolean }) {
  const { pending, run } = useContentButton();
  if (chosen.length === 0) return <p className="text-sm text-muted">No media chosen yet.</p>;
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {chosen.map((item, i) => (
        <li key={item.id} className="rounded-2xl border border-border bg-card p-2">
          <div className="relative">
            <MediaThumb url={item.url} kind={item.kind} name={item.fileName} />
            <span className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-brand-900 text-xs font-semibold text-white">
              {i + 1}
            </span>
          </div>
          <p className="mt-1.5 truncate text-xs text-ink">{item.description || item.fileName}</p>
          {item.reuseWarning && <ReuseNote text={item.reuseWarning} />}
          {canEdit && (
            <div className="mt-1.5 flex gap-1">
              <Button size="sm" variant="ghost" aria-label="Move earlier" disabled={pending || i === 0} onClick={() => run(() => movePostMediaAction(postId, item.id, "up"))}>
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Move later"
                disabled={pending || i === chosen.length - 1}
                onClick={() => run(() => movePostMediaAction(postId, item.id, "down"))}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Remove" className="ml-auto" disabled={pending} onClick={() => run(() => removePostMediaAction(postId, item.id))}>
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function ReuseNote({ text }: { text: string }) {
  return (
    <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-800">
      <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

function Score({ score }: { score: number | null }) {
  if (!score) return null;
  return (
    <span className="flex items-center gap-0.5" aria-label={`Score ${score} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={`size-3.5 ${i < score ? "fill-accent-500 text-accent-500" : "text-border"}`} aria-hidden="true" />
      ))}
    </span>
  );
}

function SuggestionList({ suggestions, canEdit, chosenIds }: { suggestions: Suggestion[]; canEdit: boolean; chosenIds: string[] }) {
  const { pending, run } = useContentButton();
  if (suggestions.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {suggestions.map((s) => (
        <li key={s.id} className="rounded-2xl border border-border bg-card p-2">
          <MediaThumb url={s.url} kind={s.kind} name={s.fileName} />
          <div className="mt-2 flex items-center justify-between gap-2">
            <Score score={s.score} />
            <Badge tone={s.suggestedBy === "claude" ? "accent" : "neutral"}>
              {s.suggestedBy === "claude" && <Sparkles className="size-3" aria-hidden="true" />}
              {s.by}
            </Badge>
          </div>
          {s.reason && <p className="mt-1 text-xs text-ink">{s.reason}</p>}
          {s.reuseWarning && <ReuseNote text={s.reuseWarning} />}
          {canEdit && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={pending || chosenIds.includes(s.mediaId)} onClick={() => run(() => pickImageSuggestionAction(s.id))}>
                <Check aria-hidden="true" />
                {chosenIds.includes(s.mediaId) ? "Chosen" : "Pick"}
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => rejectImageSuggestionAction(s.id))}>
                <Ban aria-hidden="true" />
                Reject
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function RejectAll({ postId }: { postId: string }) {
  const { pending, run } = useContentButton();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => rejectAllImageSuggestionsAction(postId))}>
      <Ban aria-hidden="true" />
      Reject all
    </Button>
  );
}

function Picker({
  postId,
  mode,
  library,
  chosenIds,
  onDone,
}: {
  postId: string;
  mode: "choose" | "suggest";
  library: PickerItem[];
  chosenIds: string[];
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<"all" | "workspace" | "company">("all");
  const [selected, setSelected] = useState<PickerItem | null>(null);
  const { pending, run } = useContentButton();
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return library.filter(
      (item) =>
        (source === "all" || item.library === source) &&
        (!needle ||
          item.fileName.toLowerCase().includes(needle) ||
          (item.description ?? "").toLowerCase().includes(needle) ||
          (item.folder ?? "").toLowerCase().includes(needle) ||
          item.tags.some((t) => t.includes(needle)) ||
          item.people.some((p) => p.toLowerCase().includes(needle))),
    );
  }, [library, q, source]);

  if (mode === "suggest" && selected) {
    return <SuggestForm postId={postId} item={selected} onBack={() => setSelected(null)} onDone={onDone} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="picker-q">
          Search
        </label>
        <Input id="picker-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description, tags, people, folder" className="min-w-0 flex-1" />
        <div className="w-44">
          <label className="sr-only" htmlFor="picker-source">
            Library
          </label>
          <Select id="picker-source" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">Both libraries</option>
            <option value="workspace">This workspace</option>
            <option value="company">Company library</option>
          </Select>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted">No files match. Add files in the media library first.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visible.map((item) => {
            const isChosen = chosenIds.includes(item.id);
            return (
              <li key={item.id} className={`rounded-2xl border p-2 ${item.doNotUse ? "border-danger/30" : "border-border"}`}>
                <MediaThumb url={item.url} kind={item.kind} name={item.fileName} className={item.doNotUse ? "opacity-50" : ""} />
                <p className="mt-1.5 truncate text-xs text-ink">{item.description || item.fileName}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.library === "company" && <Badge tone="neutral">Company</Badge>}
                  {item.doNotUse && <Badge tone="danger">Do not use</Badge>}
                </div>
                {item.reuseWarning && <ReuseNote text={item.reuseWarning} />}
                <Button
                  size="sm"
                  variant={mode === "choose" ? "primary" : "secondary"}
                  className="mt-2 w-full"
                  disabled={pending || (mode === "choose" && isChosen) || item.doNotUse}
                  onClick={() => (mode === "choose" ? run(() => addPostMediaAction(postId, item.id)) : setSelected(item))}
                >
                  {mode === "choose" ? (isChosen ? "Chosen" : "Add") : "Suggest"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SuggestForm({ postId, item, onBack, onDone }: { postId: string; item: PickerItem; onBack: () => void; onDone: () => void }) {
  const { state, formAction, pending } = useContentForm(addImageSuggestionAction.bind(null, postId), onDone);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="media_id" value={item.id} />
      <div className="flex items-center gap-3">
        <div className="w-24">
          <MediaThumb url={item.url} kind={item.kind} name={item.fileName} />
        </div>
        <p className="text-sm">{item.description || item.fileName}</p>
      </div>
      <Field label="Why this image" htmlFor="suggest-reason">
        <Input id="suggest-reason" name="reason" maxLength={500} placeholder="Shows the team in Bangalore, fits the story" />
      </Field>
      <Field label="Score" htmlFor="suggest-score">
        <Select id="suggest-score" name="score" defaultValue="4">
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} of 5
            </option>
          ))}
        </Select>
      </Field>
      {state.error && <FormMessage error={state.error} />}
      <div className="flex gap-2">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          Add suggestion
        </PendingSubmit>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  );
}

function BriefSection({
  postId,
  brief,
  briefBy,
  briefDone,
  canEdit,
}: {
  postId: string;
  brief: ContentImageBrief | null;
  briefBy: ContentSuggestedBy | null;
  briefDone: boolean;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { pending, run } = useContentButton();
  const fromClaude = briefBy === "claude";

  return (
    <section aria-labelledby={`brief-${postId}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`brief-${postId}`} className="flex items-center gap-2 text-sm font-semibold text-brand-900">
          <Lightbulb className="size-4 text-accent-600" aria-hidden="true" />
          Image brief
          {brief && (briefDone ? <Badge tone="success">Done</Badge> : <Badge tone="warning">Open for the reviewer</Badge>)}
          {fromClaude && (
            <Badge tone="accent">
              <Sparkles className="size-3" aria-hidden="true" />
              Suggested by Claude
            </Badge>
          )}
        </h3>
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {brief ? "Edit brief" : "Write a brief"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">When no existing photo fits: describe the image that should go with this post.</p>

      {editing ? (
        <BriefForm postId={postId} brief={brief} onDone={() => setEditing(false)} />
      ) : brief ? (
        <>
          <dl className={`grid gap-x-4 gap-y-2 rounded-2xl p-4 text-sm sm:grid-cols-2 ${fromClaude ? "border border-accent-500/30 bg-accent-100/40" : "bg-surface"}`}>
            {imageBriefFields
              .filter((f) => brief[f.key])
              .map((f) => (
                <div key={f.key}>
                  <dt className="text-xs font-medium text-muted uppercase">{f.label}</dt>
                  <dd className="text-ink">{brief[f.key]}</dd>
                </div>
              ))}
          </dl>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {fromClaude && (
                <Button size="sm" disabled={pending} onClick={() => run(() => acceptImageBriefAction(postId))}>
                  <CircleCheck aria-hidden="true" />
                  Accept brief
                </Button>
              )}
              {briefDone ? (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setImageBriefDoneAction(postId, false))}>
                  <Undo2 aria-hidden="true" />
                  Open again
                </Button>
              ) : (
                !fromClaude && (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setImageBriefDoneAction(postId, true))}>
                    <Check aria-hidden="true" />
                    Image is there
                  </Button>
                )
              )}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => clearImageBriefAction(postId))}>
                <Trash2 aria-hidden="true" />
                {fromClaude ? "Reject" : "Remove"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">No brief.</p>
      )}
    </section>
  );
}

function BriefForm({ postId, brief, onDone }: { postId: string; brief: ContentImageBrief | null; onDone: () => void }) {
  const { state, formAction, pending } = useContentForm(saveImageBriefAction.bind(null, postId), onDone);
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {imageBriefFields.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`brief-${postId}-${f.key}`} className={f.key === "what" ? "sm:col-span-2" : ""}>
            {f.key === "what" ? (
              <Textarea id={`brief-${postId}-${f.key}`} name={f.key} rows={2} maxLength={500} placeholder={f.placeholder} defaultValue={brief?.[f.key] ?? ""} />
            ) : (
              <Input id={`brief-${postId}-${f.key}`} name={f.key} maxLength={500} placeholder={f.placeholder} defaultValue={brief?.[f.key] ?? ""} />
            )}
          </Field>
        ))}
      </div>
      {state.error && <FormMessage error={state.error} />}
      <div className="flex gap-2">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          Save brief
        </PendingSubmit>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
