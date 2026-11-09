"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { recordBlockView } from "@/app/academy/actions";
import { explanationHtml } from "@/lib/academy/blocks/types";
import { sanitizeHtml } from "@/lib/academy/sanitize";
import type { BlockViewerProps } from "./types";

/**
 * Hook for block viewers whose completion is "seen" (explanation, and the
 * document block once it is built): records the view once the block's end
 * is on screen, then refreshes the page so checks and progress update.
 */
export function useRecordViewWhenSeen(blockId: string, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const sent = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node || sent.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (sent.current || !entries.some((e) => e.isIntersecting)) return;
        sent.current = true;
        observer.disconnect();
        void recordBlockView(blockId).then((result) => {
          if (result.ok) router.refresh();
        });
      },
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [blockId, enabled, router]);

  return ref;
}

export function ExplanationViewer({ block, done, preview }: BlockViewerProps) {
  const html = useMemo(() => sanitizeHtml(explanationHtml(block.content)), [block.content]);
  const endRef = useRecordViewWhenSeen(block.id, !done && !preview);

  return (
    <div>
      <div className="academy-prose text-[15px]" dangerouslySetInnerHTML={{ __html: html }} />
      {/* The end of the text: seen once this is on screen. */}
      <div ref={endRef} aria-hidden="true" className="h-px" />
    </div>
  );
}
