"use client";

import { useTransition } from "react";
import { History } from "lucide-react";
import { restoreVersionAction } from "@/app/content/actions/posts";
import { Button } from "@/components/ui/button";
import { runAction } from "@/components/content/post/use-content-action";

/** Bring back an older version; it is saved as a new version, nothing is lost. */
export function RestoreVersionButton({ slug, postId, version }: { slug: string; postId: string; version: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Restore version ${version}? It becomes the newest version.`)) return;
        startTransition(async () => void (await runAction(restoreVersionAction(slug, postId, version))));
      }}
    >
      <History aria-hidden="true" />
      Restore version {version}
    </Button>
  );
}
