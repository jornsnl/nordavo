"use client";

import { useTransition } from "react";
import { Archive, ArchiveRestore, LoaderCircle } from "lucide-react";
import { archivePostAction } from "@/app/content/actions/posts";
import { Button } from "@/components/ui/button";
import { runAction } from "@/components/content/post/use-content-action";

/** Archive a post that is no longer needed (nothing is deleted), or bring it back. */
export function ArchivePostButton({ slug, postId, archived }: { slug: string; postId: string; archived: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() => {
        if (!archived && !window.confirm("Archive this post? It leaves the lists and the calendar. You can restore it later.")) return;
        startTransition(async () => void (await runAction(archivePostAction(slug, postId, !archived))));
      }}
    >
      {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
      {archived ? "Restore" : "Archive"}
    </Button>
  );
}
