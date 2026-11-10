"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Check, ClipboardCopy, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";
import { publishPostAction, savePlanningAction } from "@/app/content/actions/planning";
import type { ContentActionState } from "@/lib/content/errors";
import { characterCount, weekday } from "@/lib/content/rules";

type Move = { allowed: boolean; reason?: string } | null;

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied.`, { tone: "success" });
  } catch {
    toast(`Could not copy the ${what.toLowerCase()}. Select it and copy by hand.`, { tone: "error" });
  }
}

function useToastResult(state: ContentActionState) {
  useEffect(() => {
    if (state.ok && state.message) toast(state.message, { tone: "success" });
    else if (state.error) toast(state.error, { tone: "error" });
  }, [state]);
}

export function PublishPanelClient({
  postId,
  status,
  text,
  firstComment,
  media,
  needsMedia,
  needsBlurCheck,
  plannedDate,
  timeSlot,
  linkedinUrl,
  slots,
  canEdit,
  schedule,
  publish,
}: {
  postId: string;
  status: string;
  text: string;
  firstComment: string;
  media: { id: string; fileName: string; href: string }[];
  needsMedia: boolean;
  needsBlurCheck: boolean;
  plannedDate: string | null;
  timeSlot: string | null;
  linkedinUrl: string | null;
  slots: { value: string; label: string; weekdays: number[]; archived: boolean }[];
  canEdit: boolean;
  schedule: Move;
  publish: Move;
}) {
  const ids = useId();
  const [planState, planAction] = useActionState(savePlanningAction.bind(null, postId), {} as ContentActionState);
  const [urlState, urlAction] = useActionState(publishPostAction.bind(null, postId), {} as ContentActionState);
  useToastResult(planState);
  useToastResult(urlState);
  const [date, setDate] = useState(plannedDate ?? "");
  const live = status === "published" || status === "measured";

  const checklist = [
    { key: "text", label: "Text pasted" },
    ...(media.length > 0 || needsMedia ? [{ key: "media", label: "Media added" }] : []),
    { key: "date", label: "Date and time correct" },
    ...(needsBlurCheck ? [{ key: "blur", label: "Names blurred on the screenshot" }] : []),
  ];
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const allChecked = checklist.every((c) => checked[c.key]);
  const daySlots = date ? slots.filter((s) => s.weekdays.length === 0 || s.weekdays.includes(weekday(date))) : slots;

  function downloadAll() {
    // One file after the other, in order; browsers may ask to allow several downloads.
    media.forEach((m, i) => {
      window.setTimeout(() => {
        const a = document.createElement("a");
        a.href = m.href;
        a.rel = "noopener";
        document.body.append(a);
        a.click();
        a.remove();
      }, i * 600);
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => copy(text, "Text")} disabled={!text}>
          <ClipboardCopy aria-hidden="true" />
          Copy text
        </Button>
        <Button variant="secondary" onClick={downloadAll} disabled={media.length === 0}>
          <Download aria-hidden="true" />
          Download media{media.length > 0 ? ` (${media.length})` : ""}
        </Button>
        <Button variant="secondary" onClick={() => copy(firstComment, "First comment")} disabled={!firstComment.trim()}>
          <ClipboardCopy aria-hidden="true" />
          Copy first comment
        </Button>
      </div>
      <p className="text-xs text-muted">
        {characterCount(text)} characters, copied exactly as it appears on LinkedIn.
        {needsMedia && media.length === 0 && " This format needs media: choose it in the media panel."}
      </p>
      {media.length > 0 && (
        <ol className="space-y-1 text-sm">
          {media.map((m, i) => (
            <li key={m.id}>
              <a href={m.href} className="inline-flex items-center gap-1.5 text-brand-700 hover:underline">
                <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                {m.fileName}
              </a>
            </li>
          ))}
        </ol>
      )}

      {!live && (
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium text-ink">Checklist</legend>
          <ul className="space-y-1.5">
            {checklist.map((item) => (
              <li key={item.key}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-700"
                    checked={Boolean(checked[item.key])}
                    onChange={(e) => setChecked((c) => ({ ...c, [item.key]: e.target.checked }))}
                  />
                  {item.label}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {canEdit && !live && (
        <form action={planAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date" htmlFor={`${ids}-date`} error={planState.fieldErrors?.planned_date}>
              <Input id={`${ids}-date`} name="planned_date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Time slot" htmlFor={`${ids}-slot`}>
              <Select id={`${ids}-slot`} name="time_slot" defaultValue={timeSlot ?? ""} key={date}>
                <option value="">No slot</option>
                {daySlots.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                    {s.archived ? " (archived)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton variant="secondary" name="intent" value="save" pendingLabel="Saving">
              Save date
            </SubmitButton>
            {schedule && status !== "scheduled" && (
              <SubmitButton name="intent" value="schedule" disabled={!schedule.allowed} pendingLabel="Scheduling">
                <Check aria-hidden="true" />
                Set to Scheduled
              </SubmitButton>
            )}
            {schedule && !schedule.allowed && status !== "scheduled" && <span className="text-xs text-muted">{schedule.reason}</span>}
            {status !== "scheduled" && schedule?.allowed && !allChecked && (
              <span className="text-xs text-muted">Tick the checklist once it is scheduled in LinkedIn.</span>
            )}
          </div>
        </form>
      )}

      {canEdit && (status === "scheduled" || live || publish !== null) && (
        <form action={urlAction} className="space-y-2">
          <Field
            label="LinkedIn URL"
            htmlFor={`${ids}-url`}
            hint={live ? "The link of the live post." : "Paste the link once the post is live: it moves to Published."}
            error={urlState.fieldErrors?.linkedin_url}
          >
            <Input id={`${ids}-url`} name="linkedin_url" type="url" inputMode="url" placeholder="https://www.linkedin.com/feed/update/..." defaultValue={linkedinUrl ?? ""} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton disabled={!live && publish !== null && !publish.allowed} pendingLabel="Saving">
              {live ? "Update link" : "Mark as published"}
            </SubmitButton>
            {!live && publish && !publish.allowed && <span className="text-xs text-muted">{publish.reason}</span>}
          </div>
        </form>
      )}

      {linkedinUrl && (
        <a href={linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
          <ExternalLink className="size-4" aria-hidden="true" />
          Open on LinkedIn
        </a>
      )}
    </>
  );
}
