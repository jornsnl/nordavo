"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyEdits } from "./actions";
import { TriageBar } from "./triage-bar";

/** Prio reason, follow toggle and "Send to" for one lead. Every change goes through the logged write paths. */
export function LeadFlowControls({ companyId, prioReason, followed }: { companyId: string; prioReason: string | null; followed: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState(prioReason ?? "");
  const [isFollowed, setFollowed] = useState(followed);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (fields: Record<string, string | boolean | null>, done: string) =>
    startTransition(async () => {
      const result = await applyEdits([{ entity: "company", ids: [companyId], fields }]);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: done });
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-ink">Reason for the prio</span>
        <span className="flex gap-2">
          <input
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-white px-2"
            maxLength={500}
            value={reason}
            placeholder="For example: three open data roles, CTO knows us"
            onChange={(e) => setReason(e.target.value)}
          />
          <Button size="sm" variant="secondary" disabled={pending || reason === (prioReason ?? "")} onClick={() => save({ prio_reason: reason.trim() || null }, "Prio reason saved.")}>
            Save
          </Button>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={isFollowed ? "primary" : "secondary"}
          disabled={pending}
          onClick={() => {
            const next = !isFollowed;
            setFollowed(next);
            save({ followed: next }, next ? "Following: you get a task when a new dev or data vacancy appears." : "No longer following.");
          }}
          title="A task for the owner when a new dev or data vacancy appears"
        >
          {isFollowed ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
          {isFollowed ? "Unfollow" : "Follow vacancies"}
        </Button>
        <TriageBar companyIds={[companyId]} onDone={(text) => { setMessage({ tone: "ok", text }); router.refresh(); }} />
      </div>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-danger" : "text-emerald-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
