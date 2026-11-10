"use client";

import { useTransition, type ReactNode } from "react";
import type { ContentActionState } from "@/lib/content/errors";
import { Bot, Check, X } from "lucide-react";
import { acceptSuggestionAction, decideAllSuggestionsAction, rejectSuggestionAction } from "@/app/content/actions/posts";
import type { ContentTextField } from "@/lib/content/database";
import { fromCodePointOffset } from "@/lib/content/diff";
import { textFields } from "@/lib/content/rules";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { runAction } from "@/components/content/post/use-content-action";

export type SuggestionView = {
  id: string;
  field: ContentTextField;
  /** Code points, as stored. */
  startOffset: number;
  original: string;
  replacement: string;
  note: string | null;
  authorName: string;
  byClaude: boolean;
  createdAt: string;
};

type Placed = SuggestionView & { start: number; end: number };

/**
 * Open suggestions, shown in the text: the original struck through and the
 * replacement highlighted. The author (or an admin) accepts or rejects each,
 * or all at once.
 */
export function SuggestionsPanel({
  slug,
  postId,
  texts,
  suggestions,
  canDecide,
}: {
  slug: string;
  postId: string;
  texts: Record<ContentTextField, string>;
  suggestions: SuggestionView[];
  canDecide: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const run = (promise: Promise<ContentActionState>) =>
    startTransition(async () => void (await runAction(promise)));

  if (suggestions.length === 0) return null;
  return (
    <div className="space-y-4">
      {canDecide && suggestions.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => run(decideAllSuggestionsAction(slug, postId, true))}>
            <Check aria-hidden="true" />
            Accept all ({suggestions.length})
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(decideAllSuggestionsAction(slug, postId, false))}>
            <X aria-hidden="true" />
            Reject all
          </Button>
        </div>
      )}
      {textFields.map(({ value: field, label }) => {
        const text = texts[field];
        const list: Placed[] = suggestions
          .filter((s) => s.field === field)
          .map((s) => {
            const start = fromCodePointOffset(text, s.startOffset);
            return { ...s, start, end: start + s.original.length };
          })
          .sort((a, b) => a.start - b.start);
        if (list.length === 0) return null;
        return (
          <section key={field} className="rounded-2xl border border-border bg-white p-4">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{label}</h3>
            <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">{marked(text, list)}</p>
            <ul className="mt-3 space-y-2 border-t border-border pt-3">
              {list.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="break-words">
                      {s.original && <del className="bg-danger-bg text-danger">{s.original}</del>}
                      {s.original && s.replacement && " → "}
                      {s.replacement && <ins className="bg-emerald-50 text-emerald-800 no-underline">{s.replacement}</ins>}
                      {!s.replacement && <span className="text-muted"> (remove)</span>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {s.byClaude ? (
                        <Badge tone="accent">
                          <Bot className="size-3" aria-hidden="true" />
                          Claude
                        </Badge>
                      ) : (
                        <span>{s.authorName}</span>
                      )}
                      <span>{formatDateTime(s.createdAt)}</span>
                      {s.note && <span className="text-ink">“{s.note}”</span>}
                    </p>
                  </div>
                  {canDecide && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" disabled={pending} onClick={() => run(acceptSuggestionAction(slug, postId, s.id))}>
                        <Check aria-hidden="true" />
                        Accept
                      </Button>
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(rejectSuggestionAction(slug, postId, s.id))}>
                        <X aria-hidden="true" />
                        Reject
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** The text with every suggestion that does not overlap an earlier one marked in place. */
function marked(text: string, list: Placed[]) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const s of list) {
    if (s.start < at || text.slice(s.start, s.end) !== s.original) continue;
    parts.push(text.slice(at, s.start));
    parts.push(
      <span key={s.id}>
        {s.original && <del className="bg-danger-bg text-danger">{s.original}</del>}
        {s.replacement && <ins className="bg-emerald-50 text-emerald-800 no-underline">{s.replacement}</ins>}
      </span>,
    );
    at = s.end;
  }
  parts.push(text.slice(at));
  return parts;
}
