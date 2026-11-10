"use client";

import { useRef } from "react";
import { Lightbulb } from "lucide-react";
import { nextIdeaAction } from "@/app/content/actions/posts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { PendingSubmit } from "@/components/placements/form-utils";
import { useContentAction } from "@/components/content/post/use-content-action";

/** Asked once a post is live: a note for a follow up post, which lands in the Ideas inbox. */
export function NextIdeaPrompt({ slug, postId }: { slug: string; postId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { onSubmit, pending } = useContentAction(nextIdeaAction.bind(null, slug, postId));
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-accent-500/30 bg-accent-100/40 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-brand-900">
        <Lightbulb className="size-4 text-accent-600" aria-hidden="true" />
        This post is live. What is the next idea?
      </p>
      <Textarea name="text" rows={3} maxLength={5000} placeholder="A note for a follow up post" aria-label="Next idea" />
      <div className="flex flex-wrap gap-2">
        <PendingSubmit pending={pending} size="sm">
          Save to inbox
        </PendingSubmit>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            const text = formRef.current?.elements.namedItem("text");
            if (text instanceof HTMLTextAreaElement) text.value = "";
            formRef.current?.requestSubmit();
          }}
        >
          Skip
        </Button>
      </div>
    </form>
  );
}
