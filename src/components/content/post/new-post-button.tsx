"use client";

import { useTransition } from "react";
import { Plus, LoaderCircle } from "lucide-react";
import { createPostAction } from "@/app/content/actions/posts";
import { Button } from "@/components/ui/button";
import { runAction } from "@/components/content/post/use-content-action";

/** Creates a draft and opens it. */
export function NewPostButton({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button disabled={pending} onClick={() => startTransition(async () => void (await runAction(createPostAction(slug))))}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
      New post
    </Button>
  );
}
