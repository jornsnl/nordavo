"use client";

import { useState, useTransition } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toaster";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { useWorkAction, type WorkAction } from "@/components/work/forms";
import { closeMeetingAction } from "@/app/work/meeting-actions";
import { meetingVisibilities } from "@/lib/work/meeting-labels";
import type { WorkMeetingVisibility } from "@/lib/work/database";

export type MeetingWorkspaceOption = {
  id: string;
  name: string;
  /** Who can be picked in this workspace (everyone except you). */
  people: { id: string; name: string }[];
};

/**
 * Make a meeting, or change one: a name, who sees it, and, for "only people I
 * pick", who. In a private workspace the choice is among the people you
 * invited there.
 */
export function MeetingForm({
  action,
  workspaces,
  defaults,
  currentUserId,
  showArchive = false,
  submitLabel,
}: {
  action: WorkAction;
  /** One workspace to pick from; with a fixed workspace (editing) just one entry. */
  workspaces: MeetingWorkspaceOption[];
  defaults?: { workspaceId: string; name: string; visibility: WorkMeetingVisibility; picked: string[]; archived?: boolean };
  currentUserId: string;
  showArchive?: boolean;
  submitLabel: string;
}) {
  const { state, formAction, pending, errors } = useWorkAction(action);
  const [workspaceId, setWorkspaceId] = useState(defaults?.workspaceId ?? workspaces[0]?.id ?? "");
  const [visibility, setVisibility] = useState<WorkMeetingVisibility>(defaults?.visibility ?? "workspace");
  const people = (workspaces.find((w) => w.id === workspaceId)?.people ?? []).filter((p) => p.id !== currentUserId);
  const editing = Boolean(defaults);

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      {!editing && (
        <Field label="Workspace" htmlFor="meeting_workspace" required error={errors.workspace_id}>
          <Select id="meeting_workspace" name="workspace_id" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Name" htmlFor="meeting_name" required error={errors.name} hint="For example Weekly with Floris, or Team meeting.">
        <Input id="meeting_name" name="name" required maxLength={120} defaultValue={defaults?.name} autoFocus={!editing} />
      </Field>
      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink">Who sees it</legend>
        <div className="space-y-2">
          {meetingVisibilities.map((v) => (
            <label key={v.value} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-white p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
              <input type="radio" name="visibility" value={v.value} checked={visibility === v.value} onChange={() => setVisibility(v.value)} className="mt-0.5" />
              <span>
                <span className="block font-medium">{v.label}</span>
                <span className="block text-xs text-muted">{v.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {visibility === "invited" && (
        <fieldset>
          <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink">
            <Lock className="size-3.5" aria-hidden="true" />
            Who else is in (you always are)
          </legend>
          {people.length === 0 ? (
            <p className="text-xs text-muted">Nobody else is in this workspace yet. Invite people from Manage, then pick them here.</p>
          ) : (
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-border bg-white p-2">
              {people.map((p) => (
                <label key={`${workspaceId}-${p.id}`} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-brand-50 pointer-coarse:min-h-10">
                  <input type="checkbox" name="members" value={p.id} defaultChecked={defaults?.picked.includes(p.id)} className="size-4 rounded border-border text-brand-700" />
                  <span className="flex-1">{p.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {showArchive && (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" name="archived" defaultChecked={defaults?.archived} className="size-4 rounded border-border text-brand-700" />
          Archive this meeting (it leaves the list; the agenda stays)
        </label>
      )}
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          {submitLabel}
        </PendingSubmit>
      </div>
    </form>
  );
}

/** Close the meeting: what was not discussed moves on to the next round. */
export function CloseMeetingButton({ meetingId, openPoints }: { meetingId: string; openPoints: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() => {
        const moved =
          openPoints === 0
            ? "Nothing moves on."
            : `${openPoints} open ${openPoints === 1 ? "point moves" : "points move"} on to the next meeting.`;
        if (!window.confirm(`Close this meeting? ${moved}`)) return;
        startTransition(async () => {
          const result = await closeMeetingAction(meetingId);
          if ("error" in result) toast(result.error, { tone: "error" });
          else toast(openPoints === 0 ? "Meeting closed." : "Meeting closed. Open points moved on.");
        });
      }}
    >
      {pending ? "Closing" : "Close meeting"}
    </Button>
  );
}
