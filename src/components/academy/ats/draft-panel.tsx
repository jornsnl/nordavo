"use client";

import { useActionState } from "react";
import { Check, Sparkles, Trash2 } from "lucide-react";
import { acceptDraftBlock, discardDraftBlock, generateLessonDraft } from "@/app/dashboard/academy/lessons/[id]/draft-actions";
import { initialActionState } from "@/lib/action-state";
import { useAction } from "@/components/academy/admin/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type Props = {
  lessonId: string;
  claude: boolean;
  videos: { id: string; title: string; transcriptChars: number; transcriptStatus: string }[];
  drafts: { id: string; type: string; title: string | null; source: "ai" | "transcript" }[];
};

/**
 * Draft from a video transcript: explanation, tasks and a knowledge check,
 * added as draft blocks (hidden from learners) that Nordavo edits in the
 * blocks below and then accepts.
 */
export function LessonDraftPanel({ lessonId, claude, videos, drafts }: Props) {
  const [state, action] = useActionState(generateLessonDraft.bind(null, lessonId), initialActionState);
  const block = useAction();
  const withTranscript = videos.filter((v) => v.transcriptChars >= 50);
  return (
    <section className="mb-6 rounded-2xl border border-accent-500/30 bg-accent-100/30 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold text-brand-900">
        <Sparkles className="size-4 text-accent-600" aria-hidden="true" />
        Draft from the transcript
      </h2>
      <p className="mt-1 text-sm text-muted">
        {claude
          ? "Claude writes an explanation, tasks and a knowledge check of three questions from the transcript. They are added at the end as drafts: learners do not see them until you accept them."
          : "Claude writes an explanation, tasks and a knowledge check of three questions from the transcript through the MCP, in its next run of claude-requests. They are added at the end as drafts: learners do not see them until you accept them."}
      </p>
      <form action={action} className="mt-3 space-y-3">
        <FormMessage error={state.error} success={state.message} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Video" htmlFor={`draft-video-${lessonId}`} hint={videos.length === 0 ? "This lesson has no video block yet." : undefined}>
            <Select id={`draft-video-${lessonId}`} name="video_id" defaultValue={withTranscript[0]?.id ?? ""}>
              <option value="">Paste a transcript instead</option>
              {videos.map((v) => (
                <option key={v.id} value={v.id} disabled={v.transcriptChars < 50}>
                  {v.title}
                  {v.transcriptChars < 50 ? ` (no transcript: ${v.transcriptStatus})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Or paste a transcript" htmlFor={`draft-text-${lessonId}`}>
            <Textarea id={`draft-text-${lessonId}`} name="transcript" rows={3} maxLength={60000} placeholder="Used when no video is chosen" />
          </Field>
        </div>
        <SubmitButton size="sm" pendingLabel={claude ? "Claude is writing…" : "Making the draft…"}>
          <Sparkles aria-hidden="true" />
          Make a draft
        </SubmitButton>
      </form>
      {drafts.length > 0 && (
        <div className="mt-4 border-t border-accent-500/20 pt-3">
          <FormMessage error={block.result.error} success={block.result.message} />
          <p className="text-sm font-medium text-ink">Drafts in this lesson (edit them in the blocks below)</p>
          <ul className="mt-2 space-y-1.5">
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="accent">{d.source === "ai" ? "AI draft" : "Transcript draft"}</Badge>
                <span className="min-w-0 flex-1 truncate">{d.title ?? d.type}</span>
                <Button size="sm" variant="secondary" disabled={block.pending} onClick={() => block.run(() => acceptDraftBlock(d.id))}>
                  <Check aria-hidden="true" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={block.pending}
                  onClick={() => block.run(() => discardDraftBlock(d.id), { confirm: "Throw this draft block away?" })}
                >
                  <Trash2 aria-hidden="true" />
                  Discard
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
