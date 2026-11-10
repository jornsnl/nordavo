"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, MessageSquare, RotateCcw } from "lucide-react";
import { addCommentAction, resolveCommentAction } from "@/app/content/actions/posts";
import type { ContentTextField } from "@/lib/content/database";
import { textFields } from "@/lib/content/rules";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { PendingSubmit } from "@/components/placements/form-utils";
import { runAction, useContentAction } from "@/components/content/post/use-content-action";

export type CommentView = {
  id: string;
  field: ContentTextField | null;
  quote: string | null;
  body: string;
  authorName: string;
  createdAt: string;
  resolved: boolean;
  replies: { id: string; body: string; authorName: string; createdAt: string }[];
};

/** Comments on pieces of the text, with replies and resolve. Start one by selecting text in the editor. */
export function CommentsPanel({
  slug,
  postId,
  comments,
  canComment,
}: {
  slug: string;
  postId: string;
  comments: CommentView[];
  canComment: boolean;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const open = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);
  const shown = showResolved ? comments : open;

  return (
    <div className="space-y-3">
      {comments.length === 0 && (
        <p className="text-sm text-muted">No comments yet. {canComment ? "Select a piece of text in the editor to comment on it." : ""}</p>
      )}
      <GeneralComment slug={slug} postId={postId} canComment={canComment} />
      {shown.map((comment) => (
        <Thread key={comment.id} slug={slug} postId={postId} comment={comment} canComment={canComment} />
      ))}
      {resolved.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? "Hide resolved" : `Show ${resolved.length} resolved`}
        </Button>
      )}
    </div>
  );
}

function GeneralComment({ slug, postId, canComment }: { slug: string; postId: string; canComment: boolean }) {
  const [open, setOpen] = useState(false);
  const { onSubmit, pending } = useContentAction(addCommentAction.bind(null, slug, postId), () => setOpen(false));
  if (!canComment) return null;
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <MessageSquare aria-hidden="true" />
        General comment
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Textarea name="body" rows={3} autoFocus required maxLength={5000} aria-label="Comment" />
      <div className="flex gap-2">
        <PendingSubmit pending={pending} size="sm">
          Comment
        </PendingSubmit>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Thread({ slug, postId, comment, canComment }: { slug: string; postId: string; comment: CommentView; canComment: boolean }) {
  const [replying, setReplying] = useState(false);
  const [pending, startTransition] = useTransition();
  const reply = useContentAction(addCommentAction.bind(null, slug, postId), () => setReplying(false));
  const fieldLabel = textFields.find((f) => f.value === comment.field)?.label;

  return (
    <article className={`rounded-2xl border border-border bg-white p-4 ${comment.resolved ? "opacity-60" : ""}`}>
      {comment.quote && (
        <blockquote className="mb-2 rounded-lg border-l-4 border-accent-500 bg-accent-100/40 px-3 py-1.5 text-sm whitespace-pre-wrap text-ink">
          {fieldLabel && <span className="mr-1.5 text-xs font-semibold text-muted uppercase">{fieldLabel}</span>}
          {comment.quote}
        </blockquote>
      )}
      <Message name={comment.authorName} at={comment.createdAt} body={comment.body} />
      {comment.replies.length > 0 && (
        <ul className="mt-3 space-y-2 border-l-2 border-border pl-3">
          {comment.replies.map((r) => (
            <li key={r.id}>
              <Message name={r.authorName} at={r.createdAt} body={r.body} />
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {!comment.resolved && !replying && (
            <Button size="sm" variant="ghost" onClick={() => setReplying(true)}>
              Reply
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => startTransition(async () => void (await runAction(resolveCommentAction(slug, postId, comment.id, !comment.resolved))))}
          >
            {comment.resolved ? <RotateCcw aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            {comment.resolved ? "Reopen" : "Resolve"}
          </Button>
        </div>
      )}
      {replying && (
        <form onSubmit={reply.onSubmit} className="mt-2 space-y-2">
          <input type="hidden" name="parent_id" value={comment.id} />
          <Textarea name="body" rows={2} autoFocus required maxLength={5000} aria-label="Reply" />
          <div className="flex gap-2">
            <PendingSubmit pending={reply.pending} size="sm">
              Reply
            </PendingSubmit>
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </article>
  );
}

function Message({ name, at, body }: { name: string; at: string; body: string }) {
  return (
    <div>
      <p className="text-xs text-muted">
        <span className="font-semibold text-ink">{name}</span> · {formatDateTime(at)}
      </p>
      <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink">{body}</p>
    </div>
  );
}
