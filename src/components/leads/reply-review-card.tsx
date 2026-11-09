"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Check, Sparkles, X } from "lucide-react";
import { ActionButton } from "@/components/sales/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { activityChannels, activityOutcomes, optionFor } from "@/lib/labels";
import type { ReplyToReview } from "@/lib/sales/replies";
import { labelOf, leadStatuses, pipelineStages } from "@/lib/sales/labels";

const replyOutcomes = ["reply_positief", "reply_neutraal", "reply_negatief", "afgemeld"] as const;

const sources: Record<string, string> = { instantly: "Instantly", seleqt: "Seleqt", claude: "Claude", handmatig: "By hand" };

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(value));
}

/** One reply with Claude's suggestion: accept, reject, or accept with another outcome. */
export function ReplyReviewCard({
  reply,
  acceptAction,
  rejectAction,
  otherAction,
}: {
  reply: ReplyToReview;
  acceptAction: () => Promise<ActionState>;
  rejectAction: () => Promise<ActionState>;
  otherAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [other, setOther] = useState(false);
  const [state, formAction] = useActionState(otherAction, initialActionState);
  const [stage, setStage] = useState(reply.suggestion.pipeline_stage ?? "");
  const s = reply.suggestion;
  const hasSuggestion = Boolean(s.outcome || s.lead_status || s.pipeline_stage || s.contact_status || s.classification);
  const id = reply.id.slice(0, 8);

  if (state.ok) {
    return (
      <li className="rounded-2xl border border-emerald-600/20 bg-emerald-50 px-5 py-4 text-sm text-emerald-800" role="status">
        {reply.company?.name ?? "Reply"}: {state.message}
      </li>
    );
  }

  return (
    <li className="rounded-2xl border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="font-display font-semibold text-brand-900">
            {reply.company ? (
              <Link href={`/dashboard/leads/${reply.company.id}`} className="hover:text-brand-600 hover:underline">
                {reply.company.name}
              </Link>
            ) : (
              "Unknown company"
            )}
          </p>
          <p className="text-sm text-muted">
            {reply.contact ? `${reply.contact.name}${reply.contact.title ? `, ${reply.contact.title}` : ""}` : "No contact"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="brand">{optionFor(activityChannels, reply.channel).label}</Badge>
          <Badge tone="neutral">{sources[reply.source] ?? reply.source}</Badge>
          <span className="text-xs text-muted">{dateTime(reply.date)}</span>
        </div>
      </header>

      <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-2">
        <section aria-label="Reply" className="min-w-0">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Reply</h3>
          <p className="max-h-72 overflow-y-auto rounded-xl border border-border bg-surface/60 p-3 text-sm whitespace-pre-wrap break-words text-ink">
            {reply.notes ?? "No text."}
          </p>
          {reply.company && (
            <p className="mt-2 text-xs text-muted">
              Now: {labelOf(leadStatuses, reply.company.leadStatus)}
              {reply.company.pipelineStage ? `, ${labelOf(pipelineStages, reply.company.pipelineStage)}` : ""}
            </p>
          )}
        </section>

        <section aria-label="Claude's suggestion" className="min-w-0">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            <Sparkles className="size-3.5 text-accent-600" aria-hidden="true" />
            Claude suggests
          </h3>
          {hasSuggestion ? (
            <dl className="space-y-1.5 rounded-xl border border-accent-500/40 bg-accent-100/50 p-3 text-sm">
              {s.classification && (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted">Classification</dt>
                  <dd className="font-medium text-ink">{s.classification}</dd>
                </div>
              )}
              {s.outcome && (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted">Outcome</dt>
                  <dd className="text-ink">{optionFor(activityOutcomes, s.outcome).label}</dd>
                </div>
              )}
              {s.lead_status && (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted">Lead status</dt>
                  <dd className="text-ink">{labelOf(leadStatuses, s.lead_status)}</dd>
                </div>
              )}
              {s.pipeline_stage && (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted">Stage</dt>
                  <dd className="text-ink">
                    {labelOf(pipelineStages, s.pipeline_stage)}
                    {s.lost_reason ? `: ${s.lost_reason}` : ""}
                  </dd>
                </div>
              )}
              {s.reason && <p className="pt-1 text-muted">{s.reason}</p>}
            </dl>
          ) : (
            <p className="rounded-xl border border-dashed border-brand-200 p-3 text-sm text-muted">
              No suggestion. Accept keeps the reply as it is; choose another outcome to change the company.
            </p>
          )}
        </section>
      </div>

      <div className="space-y-3 border-t border-border px-4 py-3 sm:px-5">
        <div className="flex flex-wrap gap-2">
          <ActionButton action={acceptAction} variant="primary" className="pointer-coarse:min-h-11">
            <Check aria-hidden="true" />
            Accept
          </ActionButton>
          <Button variant="secondary" size="sm" onClick={() => setOther((o) => !o)} aria-expanded={other} className="pointer-coarse:min-h-11">
            Other outcome
          </Button>
          <ActionButton action={rejectAction} className="pointer-coarse:min-h-11">
            <X aria-hidden="true" />
            Reject
          </ActionButton>
        </div>
        {other && (
          <form action={formAction} className="grid gap-4 rounded-xl bg-surface/60 p-3 sm:grid-cols-2">
            <Field label="What the reply means" htmlFor={`${id}-outcome`} required error={state.fieldErrors?.outcome}>
              <Select id={`${id}-outcome`} name="outcome" defaultValue={s.outcome ?? "reply_neutraal"}>
                {replyOutcomes.map((o) => (
                  <option key={o} value={o}>
                    {optionFor(activityOutcomes, o).label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lead status" htmlFor={`${id}-lead`} error={state.fieldErrors?.lead_status}>
              <Select id={`${id}-lead`} name="lead_status" defaultValue={s.lead_status ?? ""}>
                <option value="">Keep as it is</option>
                {leadStatuses.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Pipeline stage" htmlFor={`${id}-stage`} error={state.fieldErrors?.pipeline_stage}>
              <Select id={`${id}-stage`} name="pipeline_stage" value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">Keep as it is</option>
                {pipelineStages.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            {stage === "lost" && (
              <Field label="Lost reason" htmlFor={`${id}-lost`} required error={state.fieldErrors?.lost_reason}>
                <Input id={`${id}-lost`} name="lost_reason" maxLength={2000} defaultValue={s.lost_reason ?? ""} required />
              </Field>
            )}
            <div className="sm:col-span-2">
              <SubmitButton size="sm" pendingLabel="Saving" className="max-sm:w-full pointer-coarse:min-h-11">
                Accept with this outcome
              </SubmitButton>
              <div className="mt-2">
                <FormMessage error={state.error} />
              </div>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}
