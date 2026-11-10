"use client";

import { useTransition } from "react";
import { LoaderCircle } from "lucide-react";
import { setPostStatusAction } from "@/app/content/actions/posts";
import { Button } from "@/components/ui/button";
import { runAction } from "@/components/content/post/use-content-action";

export type MoveItem = { key: string; label: string; allowed: boolean; reason?: string };

const forward = new Set(["in_review", "approved", "scheduled", "published", "measured"]);

/**
 * The statuses this user can move the post to. Moves that are not possible
 * yet stay visible with the reason, so it is clear what is missing.
 */
export function StatusBar({ slug, postId, moves }: { slug: string; postId: string; moves: MoveItem[] }) {
  const [pending, startTransition] = useTransition();
  if (moves.length === 0) return null;
  const blocked = moves.filter((m) => !m.allowed);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {moves.map((move) => (
          <Button
            key={move.key}
            size="sm"
            variant={forward.has(move.key) && move.allowed ? "primary" : move.key === "rejected" ? "ghost" : "secondary"}
            disabled={!move.allowed || pending}
            title={move.reason}
            onClick={() => startTransition(async () => void (await runAction(setPostStatusAction(slug, postId, move.key))))}
          >
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {move.label}
          </Button>
        ))}
      </div>
      {blocked.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted">
          {blocked.map((m) => (
            <li key={m.key}>
              <span className="font-medium text-ink">{m.label}:</span> {m.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
