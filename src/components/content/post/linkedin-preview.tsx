"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { seeMoreCut } from "@/lib/content/rules";

/**
 * How the post looks in the LinkedIn feed, on mobile or desktop, cut where
 * LinkedIn shows "...see more", so you can see whether the hook works.
 */
export function LinkedInPreview({ text, authorName, firstComment }: { text: string; authorName: string; firstComment?: string }) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [expanded, setExpanded] = useState(false);
  const { visible, cut } = seeMoreCut(text, device);

  return (
    <div>
      <div className="mb-3 inline-flex rounded-xl border border-border bg-white p-1" role="group" aria-label="Preview size">
        {(["mobile", "desktop"] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={device === d}
            onClick={() => {
              setDevice(d);
              setExpanded(false);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium pointer-coarse:min-h-9 ${
              device === d ? "bg-brand-700 text-white" : "text-muted hover:bg-brand-50"
            }`}
          >
            {d === "mobile" ? <Smartphone className="size-4" aria-hidden="true" /> : <Monitor className="size-4" aria-hidden="true" />}
            {d === "mobile" ? "Mobile" : "Desktop"}
          </button>
        ))}
      </div>
      <div
        className={`rounded-xl border border-slate-200 bg-white p-4 font-[system-ui] text-[14px] leading-[1.45] text-slate-900 shadow-xs ${
          device === "mobile" ? "max-w-[375px]" : "max-w-[555px]"
        }`}
      >
        <div className="mb-3 flex items-center gap-2.5">
          <Avatar name={authorName} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{authorName}</p>
            <p className="text-xs text-slate-500">Now · 🌐</p>
          </div>
        </div>
        {text ? (
          <p className="break-words whitespace-pre-wrap">
            {expanded || !cut ? text : visible}
            {cut && !expanded && (
              <>
                {"… "}
                <button type="button" onClick={() => setExpanded(true)} className="font-medium text-slate-500 hover:text-blue-700 hover:underline">
                  see more
                </button>
              </>
            )}
          </p>
        ) : (
          <p className="text-slate-400">Write a hook to see the preview.</p>
        )}
        {firstComment && (
          <div className="mt-4 border-t border-slate-200 pt-3 text-[13px]">
            <p className="mb-1 text-xs font-semibold text-slate-500">First comment</p>
            <p className="whitespace-pre-wrap">{firstComment}</p>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        LinkedIn cuts after about {device === "mobile" ? "140" : "210"} characters or the third line. The exact point differs per screen.
      </p>
    </div>
  );
}
