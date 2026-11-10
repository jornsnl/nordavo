"use client";

import { useRef, useState } from "react";
import { MessageSquarePlus, PenLine, Save, Send } from "lucide-react";
import { addCommentAction, savePostTextAction, sendSuggestionsAction } from "@/app/content/actions/posts";
import type { ContentTextField } from "@/lib/content/database";
import { toCodePointOffset } from "@/lib/content/diff";
import { LINKEDIN_LIMIT, characterCount, linkedInText, textFields } from "@/lib/content/rules";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PendingSubmit } from "@/components/placements/form-utils";
import { LinkedInPreview } from "@/components/content/post/linkedin-preview";
import { useContentAction } from "@/components/content/post/use-content-action";

export type PostTexts = Record<ContentTextField, string>;

type Mode = "edit" | "suggest" | "read";
type Selection = { field: ContentTextField; start: number; end: number; quote: string };

const rows: Record<ContentTextField, number> = { title: 1, hook: 3, body: 12, closing_question: 2, first_comment: 3 };
const hints: Partial<Record<ContentTextField, string>> = {
  hook: "The first lines: what people see before \"see more\".",
  first_comment: "Posted as the first comment, for example the link.",
};

/**
 * The one text of a post. The author edits it (every save is a version);
 * a reviewer edits a copy in suggestion mode, and each change becomes a
 * separate suggestion for the author. Anyone who may work on the post can
 * select text and comment on it. Remount with key={version} so a new
 * version on the server replaces the local copy.
 */
export function PostEditor({
  slug,
  postId,
  version,
  texts,
  authorName,
  canEdit,
  canSuggest,
  canComment,
  locked,
}: {
  slug: string;
  postId: string;
  version: number;
  texts: PostTexts;
  authorName: string;
  /** Author or admin: edits the text directly. */
  canEdit: boolean;
  /** Reviewer, or an admin who is not the author: suggests. */
  canSuggest: boolean;
  canComment: boolean;
  /** Published posts no longer take suggestions. */
  locked: boolean;
}) {
  const initialMode: Mode = canEdit ? "edit" : canSuggest && !locked ? "suggest" : "read";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [values, setValues] = useState<PostTexts>(texts);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [commenting, setCommenting] = useState<Selection | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const save = useContentAction(savePostTextAction.bind(null, slug, postId));
  const suggest = useContentAction(sendSuggestionsAction.bind(null, slug, postId));
  const active = mode === "suggest" ? suggest : save;
  const errors = active.errors;

  const full = linkedInText({ hook: values.hook, body: values.body, closingQuestion: values.closing_question });
  const count = characterCount(full);
  const dirty = textFields.some((f) => values[f.value] !== texts[f.value]);

  function onSelect(field: ContentTextField, el: HTMLTextAreaElement | HTMLInputElement) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const quote = el.value.slice(start, end);
    setSelection(quote.trim() ? { field, start, end, quote } : null);
  }

  return (
    <div className="space-y-4">
      {(canEdit || canSuggest) && (
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && canSuggest && (
            <div className="inline-flex rounded-xl border border-border bg-white p-1" role="group" aria-label="Editing mode">
              {(["edit", "suggest"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  disabled={m === "suggest" && locked}
                  onClick={() => {
                    setMode(m);
                    setValues(texts);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium pointer-coarse:min-h-9 disabled:opacity-50 ${
                    mode === m ? "bg-brand-700 text-white" : "text-muted hover:bg-brand-50"
                  }`}
                >
                  {m === "edit" ? "Edit" : "Suggest changes"}
                </button>
              ))}
            </div>
          )}
          {mode === "suggest" && (
            <p className="flex items-center gap-1.5 text-sm text-accent-600">
              <PenLine className="size-4" aria-hidden="true" />
              Suggestion mode: your changes go to the author as suggestions.
            </p>
          )}
        </div>
      )}

      <form ref={formRef} onSubmit={active.onSubmit} className="space-y-4">
        <input type="hidden" name="version" value={version} />
        {textFields.map(({ value: field, label }) => {
          const name = mode === "suggest" ? `edit_${field}` : field;
          const common = {
            id: `post-${field}`,
            name,
            value: values[field],
            readOnly: mode === "read",
            onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [field]: e.target.value })),
            "aria-invalid": errors[field] ? true : undefined,
          };
          return (
            <Field key={field} label={label} htmlFor={`post-${field}`} hint={hints[field]} error={errors[field]}>
              {field === "title" ? (
                <Input {...common} maxLength={300} required onSelect={(e) => onSelect(field, e.currentTarget)} />
              ) : (
                <Textarea {...common} rows={rows[field]} onSelect={(e) => onSelect(field, e.currentTarget)} />
              )}
            </Field>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`text-sm font-medium ${count > LINKEDIN_LIMIT ? "text-danger" : count > LINKEDIN_LIMIT * 0.9 ? "text-amber-700" : "text-muted"}`}>
            {count.toLocaleString("en-GB")} / {LINKEDIN_LIMIT.toLocaleString("en-GB")} characters
            {count > LINKEDIN_LIMIT && " · too long for LinkedIn"}
          </p>
          <div className="flex flex-wrap gap-2">
            {canComment && (
              <Button
                variant="secondary"
                size="sm"
                disabled={!selection}
                title={selection ? undefined : "Select a piece of text first"}
                onClick={() => setCommenting(selection)}
              >
                <MessageSquarePlus aria-hidden="true" />
                Comment on selection
              </Button>
            )}
            {mode === "edit" && (
              <PendingSubmit pending={save.pending} pendingLabel="Saving" size="sm" disabled={!dirty}>
                <Save aria-hidden="true" />
                Save text
              </PendingSubmit>
            )}
            {mode === "suggest" && (
              <PendingSubmit pending={suggest.pending} pendingLabel="Sending" size="sm" disabled={!dirty}>
                <Send aria-hidden="true" />
                Send suggestions
              </PendingSubmit>
            )}
          </div>
        </div>
        {mode === "suggest" && dirty && (
          <Field label="Note with your suggestions (optional)" htmlFor="suggest-note">
            <Input id="suggest-note" name="note" maxLength={2000} placeholder="Why these changes" />
          </Field>
        )}
      </form>

      <details className="rounded-2xl border border-border bg-surface p-4" open>
        <summary className="cursor-pointer text-sm font-semibold text-brand-900">LinkedIn preview</summary>
        <div className="mt-3">
          <LinkedInPreview text={full} authorName={authorName} firstComment={values.first_comment} />
        </div>
      </details>

      {commenting && (
        <CommentModal
          slug={slug}
          postId={postId}
          selection={commenting}
          original={texts[commenting.field]}
          onClose={() => setCommenting(null)}
        />
      )}
    </div>
  );
}

function CommentModal({
  slug,
  postId,
  selection,
  original,
  onClose,
}: {
  slug: string;
  postId: string;
  selection: Selection;
  original: string;
  onClose: () => void;
}) {
  const { onSubmit, pending, errors } = useContentAction(addCommentAction.bind(null, slug, postId), onClose);
  // Offsets refer to the saved text; in suggestion mode the copy may differ.
  const found = original.indexOf(selection.quote);
  const start = original.slice(selection.start, selection.end) === selection.quote ? selection.start : found;
  return (
    <Modal open onClose={onClose} title="Comment on selection" description="Feedback stays next to the text, never in it.">
      <form onSubmit={onSubmit} className="space-y-4">
        <input type="hidden" name="field" value={selection.field} />
        <input type="hidden" name="quote" value={selection.quote} />
        <input type="hidden" name="start_offset" value={start >= 0 ? toCodePointOffset(original, start) : ""} />
        <blockquote className="rounded-xl border-l-4 border-accent-500 bg-accent-100/40 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
          {selection.quote}
        </blockquote>
        <Field label="Comment" htmlFor="comment-body" error={errors.body}>
          <Textarea id="comment-body" name="body" rows={4} autoFocus required maxLength={5000} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <PendingSubmit pending={pending} pendingLabel="Saving">
            Comment
          </PendingSubmit>
        </div>
      </form>
    </Modal>
  );
}
