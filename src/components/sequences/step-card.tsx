"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Check, Mail, MessageSquare, Pencil, Phone, Sparkles, Trash2, X } from "lucide-react";
import { ActionButton } from "@/components/sales/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-state";
import type { SequenceStep } from "@/lib/data/sequences";
import { formatDateTime } from "@/lib/format";
import type { SequenceChannel } from "@/lib/sales/database";
import { sequenceChannels } from "@/lib/sales/labels";
import { channelLabel } from "./channel";

const channelIcon = { mail: Mail, linkedin: MessageSquare, call: Phone } as const;

/** Fields of one step, for adding and editing. */
export function StepFields({
  prefix,
  defaults,
  errors,
}: {
  prefix: string;
  defaults?: { channel: SequenceChannel; dayOffset: number; subject: string | null; body: string | null };
  errors?: Record<string, string>;
}) {
  const [channel, setChannel] = useState<SequenceChannel>(defaults?.channel ?? "mail");
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Channel" htmlFor={`${prefix}-channel`} required error={errors?.channel}>
          <Select
            id={`${prefix}-channel`}
            name="channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as SequenceChannel)}
          >
            {sequenceChannels.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Day" htmlFor={`${prefix}-day`} required hint="Days after the start; 0 is the first day." error={errors?.day_offset}>
          <Input
            id={`${prefix}-day`}
            name="day_offset"
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            required
            defaultValue={defaults?.dayOffset ?? 0}
          />
        </Field>
      </div>
      {channel === "mail" && (
        <Field label="Subject" htmlFor={`${prefix}-subject`} error={errors?.subject}>
          <Input id={`${prefix}-subject`} name="subject" maxLength={500} defaultValue={defaults?.subject ?? ""} />
        </Field>
      )}
      <Field
        label={channel === "call" ? "Call script (optional)" : "Text"}
        htmlFor={`${prefix}-body`}
        hint={
          channel === "call"
            ? "Shown with the call step. Calls need no approval."
            : "Saving a text you wrote yourself counts as approved by you. Placeholders: {first_name}, {company}, {opening_line}."
        }
        error={errors?.body}
      >
        <Textarea id={`${prefix}-body`} name="body" rows={channel === "call" ? 3 : 7} maxLength={20000} defaultValue={defaults?.body ?? ""} />
      </Field>
    </div>
  );
}

export function StepCard({
  step,
  index,
  isFirst,
  isLast,
  updateAction,
  approveAction,
  rejectAction,
  moveUpAction,
  moveDownAction,
  deleteAction,
}: {
  step: SequenceStep;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  updateAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  approveAction: () => Promise<ActionState>;
  rejectAction: () => Promise<ActionState>;
  moveUpAction: () => Promise<ActionState>;
  moveDownAction: () => Promise<ActionState>;
  deleteAction: () => Promise<ActionState>;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await updateAction(prev, formData);
    if (result.ok) setEditing(false);
    return result;
  }, initialActionState);
  const Icon = channelIcon[step.channel];
  const needsApproval = step.channel !== "call";
  const hasDraft = Boolean(step.draftBody || step.draftSubject);

  return (
    <li className="rounded-2xl border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <p className="font-display font-semibold text-brand-900">
            Step {index + 1}: {channelLabel(step.channel)} on day {step.dayOffset}
          </p>
          {needsApproval &&
            (step.approvedAt ? (
              <Badge tone="success">Approved</Badge>
            ) : (
              <Badge tone="warning">Not approved</Badge>
            ))}
          {hasDraft && <Badge tone="accent">Concept waiting</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <ActionButton action={moveUpAction} variant="ghost" ariaLabel="Move step up" showMessage={false}>
            <ArrowUp aria-hidden="true" className={isFirst ? "opacity-30" : ""} />
          </ActionButton>
          <ActionButton action={moveDownAction} variant="ghost" ariaLabel="Move step down" showMessage={false}>
            <ArrowDown aria-hidden="true" className={isLast ? "opacity-30" : ""} />
          </ActionButton>
          {!editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label="Edit step" title="Edit step">
              <Pencil aria-hidden="true" />
            </Button>
          )}
          <ActionButton
            action={deleteAction}
            variant="ghost"
            ariaLabel="Remove step"
            className="text-danger hover:bg-danger-bg"
            confirm="Remove this step?"
          >
            <Trash2 aria-hidden="true" />
          </ActionButton>
        </div>
      </header>

      <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-2">
        <section aria-label="Approved text" className="min-w-0">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            {needsApproval ? "Approved text, used in the sequence" : "Call script"}
          </h3>
          {editing ? (
            <form action={formAction} className="space-y-4">
              <StepFields
                prefix={`step-${step.id}`}
                defaults={{ channel: step.channel, dayOffset: step.dayOffset, subject: step.subject, body: step.body }}
                errors={state.fieldErrors}
              />
              <div className="flex flex-wrap gap-2">
                <SubmitButton size="sm" pendingLabel="Saving" className="pointer-coarse:min-h-11">
                  Save
                </SubmitButton>
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)} className="pointer-coarse:min-h-11">
                  Cancel
                </Button>
              </div>
              <FormMessage error={state.error} />
            </form>
          ) : step.body || step.subject ? (
            <div className="rounded-xl border border-border bg-surface/60 p-3 text-sm">
              {step.subject && <p className="mb-2 font-medium text-ink">Subject: {step.subject}</p>}
              <p className="whitespace-pre-wrap break-words text-ink">{step.body}</p>
              {step.approvedAt && (
                <p className="mt-2 text-xs text-muted">
                  Approved by {step.approvedBy ?? "the team"} on {formatDateTime(step.approvedAt)}
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-brand-200 p-3 text-sm text-muted">
              {needsApproval ? "No text yet. Write it yourself or let Claude write a concept." : "No script. That is fine for a call."}
            </p>
          )}
          {!editing && state.ok && state.message && <p className="mt-2 text-xs text-emerald-700">{state.message}</p>}
        </section>

        <section aria-label="Concept" className="min-w-0">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Concept</h3>
          {hasDraft ? (
            <div className="rounded-xl border border-accent-500/40 bg-accent-100/50 p-3 text-sm">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-accent-600">
                <Sparkles className="size-3.5" aria-hidden="true" />
                {step.draftSource === "claude" ? "Written by Claude" : "Concept"}
                {step.draftAt ? `, ${formatDateTime(step.draftAt)}` : ""}
              </p>
              {step.draftSubject && <p className="mb-2 font-medium text-ink">Subject: {step.draftSubject}</p>}
              <p className="whitespace-pre-wrap break-words text-ink">{step.draftBody}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton action={approveAction} variant="primary" className="pointer-coarse:min-h-11">
                  <Check aria-hidden="true" />
                  Approve
                </ActionButton>
                <ActionButton action={rejectAction} className="pointer-coarse:min-h-11" confirm="Reject this concept?">
                  <X aria-hidden="true" />
                  Reject
                </ActionButton>
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-brand-200 p-3 text-sm text-muted">
              No concept waiting. Claude writes concepts with the MCP tool draft_sequence_text.
            </p>
          )}
        </section>
      </div>
      {step.tasks > 0 && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted sm:px-5">
          {step.tasks} {step.tasks === 1 ? "task" : "tasks"} for enrolled companies.
        </p>
      )}
    </li>
  );
}
