"use client";

import { startTransition, useActionState, useState } from "react";
import { FileText, LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import type { Seniority } from "@/lib/database.types";
import { seniorities } from "@/lib/labels";
import type { IntakeState, TalentActionState } from "@/lib/talent/types";
import { ActionFeedback } from "./action-button";

export type RequirementValues = {
  stack: string[];
  seniority: Seniority;
  hours: number | null;
  timezone_overlap: string | null;
  budget_min: number | null;
  budget_max: number | null;
  client_contact_required: boolean | null;
  must_haves: string[];
  nice_to_haves: string[];
  unclear: string[];
};

type Mode = "closed" | "paste" | "edit";

/**
 * T1 Read vacancy: paste the vacancy text, let Claude extract the fixed
 * requirements, then check and edit them before saving.
 */
export function IntakePanel({
  extractAction,
  saveAction,
  current,
  defaultText,
  hasClaude,
  proposal,
  proposalPending = false,
}: {
  extractAction: (prev: IntakeState, formData: FormData) => Promise<IntakeState>;
  saveAction: (prev: TalentActionState, formData: FormData) => Promise<TalentActionState>;
  current: RequirementValues;
  defaultText: string;
  hasClaude: boolean;
  /** Claude's reading through the MCP, waiting to be checked and saved. */
  proposal?: { values: RequirementValues; rawText: string } | null;
  /** The vacancy text was sent to Claude and is not read yet. */
  proposalPending?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("closed");
  const [draft, setDraft] = useState<{ values: RequirementValues; rawText?: string; key: number } | null>(null);
  const [extractState, extract, extracting] = useActionState(async (prev: IntakeState, formData: FormData) => {
    const result = await extractAction(prev, formData);
    if (result.extraction) {
      setDraft({ values: result.extraction, rawText: result.rawText, key: Date.now() });
      setMode("edit");
    }
    if (result.queued) setMode("closed");
    return result;
  }, {} as IntakeState);

  if (mode === "closed") {
    return (
      <div className="space-y-3">
        {proposal && (
          <div className="flex flex-col gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900 sm:flex-row sm:items-center sm:justify-between">
            <p>Claude has read the vacancy. Check its reading and save it.</p>
            <Button
              size="sm"
              onClick={() => {
                setDraft({ values: proposal.values, rawText: proposal.rawText, key: Date.now() });
                setMode("edit");
              }}
            >
              <Sparkles aria-hidden="true" />
              Check Claude&apos;s reading
            </Button>
          </div>
        )}
        {!proposal && proposalPending && (
          <p className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900" role="status">
            Waiting for Claude to read the vacancy (its next run of claude-requests).
          </p>
        )}
        <FormMessage success={extractState.queued ? extractState.message : undefined} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("paste")} size="sm">
            <Sparkles aria-hidden="true" />
            Read vacancy
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraft({ values: current, key: Date.now() });
              setMode("edit");
            }}
          >
            Edit fixed requirements
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "paste") {
    return (
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(() => extract(formData));
        }}
      >
        <Field
          label="Vacancy text"
          htmlFor="raw_text"
          error={extractState.fieldErrors?.raw_text}
          hint="Paste the vacancy as the client sent it, or the text of the vacancy page."
        >
          <Textarea id="raw_text" name="raw_text" rows={10} defaultValue={extractState.rawText ?? defaultText} />
        </Field>
        {!hasClaude && (
          <p className="text-sm text-muted">
            Claude reads the text through the MCP in its next run of claude-requests; you check its reading before it is saved.
          </p>
        )}
        <FormMessage error={extractState.error} />
        <div className="flex gap-2 max-sm:*:flex-1 sm:justify-end">
          <Button variant="secondary" size="sm" onClick={() => setMode("closed")}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={extracting} aria-busy={extracting}>
            {extracting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <FileText aria-hidden="true" />}
            {extracting ? (hasClaude ? "Claude is reading the vacancy" : "Sending") : hasClaude ? "Read with Claude" : "Send to Claude"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <RequirementsForm
      key={draft?.key}
      values={draft?.values ?? current}
      rawText={draft?.rawText}
      fromClaude={Boolean(draft?.rawText)}
      action={saveAction}
      onDone={() => setMode("closed")}
    />
  );
}

function RequirementsForm({
  values,
  rawText,
  fromClaude,
  action,
  onDone,
}: {
  values: RequirementValues;
  rawText?: string;
  fromClaude: boolean;
  action: (prev: TalentActionState, formData: FormData) => Promise<TalentActionState>;
  onDone: () => void;
}) {
  const [contact, setContact] = useState(
    values.client_contact_required === true ? "ja" : values.client_contact_required === false ? "nee" : "",
  );
  const [state, formAction, pending] = useActionState(async (prev: TalentActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok && !result.warning) onDone();
    return result;
  }, {} as TalentActionState);
  const errors = state.fieldErrors ?? {};
  const invalid = (name: string) => (errors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      {fromClaude && (
        <p className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-900">
          This is what Claude took from the text. Check everything and adjust where needed, then save the fixed requirements.
        </p>
      )}
      {rawText !== undefined && <input type="hidden" name="raw_text" value={rawText} />}
      <FormMessage error={state.error} />

      {contact === "ja" && (
        <p role="alert" className="flex gap-2 rounded-xl border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          The developer must have direct contact with the client&apos;s customers. That is a no go for Nordavo: discuss this with the client before you start searching.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stack" htmlFor="req-stack" error={errors.stack} hint="Separate with commas" className="sm:col-span-2">
          <Input id="req-stack" name="stack" defaultValue={values.stack.join(", ")} {...invalid("stack")} />
        </Field>
        <Field label="Seniority" htmlFor="req-seniority" required error={errors.seniority}>
          <Select id="req-seniority" name="seniority" defaultValue={values.seniority}>
            {seniorities.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Hours per week" htmlFor="req-hours" error={errors.hours}>
          <Input id="req-hours" name="hours" inputMode="numeric" defaultValue={values.hours ?? ""} {...invalid("hours")} />
        </Field>
        <Field label="Time zone overlap" htmlFor="req-overlap" error={errors.timezone_overlap} className="sm:col-span-2">
          <Input id="req-overlap" name="timezone_overlap" defaultValue={values.timezone_overlap ?? ""} {...invalid("timezone_overlap")} />
        </Field>
        <Field label="Minimum budget per month (EUR)" htmlFor="req-budget-min" error={errors.budget_min}>
          <Input id="req-budget-min" name="budget_min" inputMode="decimal" defaultValue={values.budget_min ?? ""} {...invalid("budget_min")} />
        </Field>
        <Field label="Maximum budget per month (EUR)" htmlFor="req-budget-max" error={errors.budget_max}>
          <Input id="req-budget-max" name="budget_max" inputMode="decimal" defaultValue={values.budget_max ?? ""} {...invalid("budget_max")} />
        </Field>
        <Field label="Direct contact with the client's customers" htmlFor="req-contact" className="sm:col-span-2">
          <Select id="req-contact" name="client_contact_required" value={contact} onChange={(e) => setContact(e.target.value)}>
            <option value="">Not known yet</option>
            <option value="nee">No</option>
            <option value="ja">Yes</option>
          </Select>
        </Field>
        <Field label="Must haves" htmlFor="req-must" error={errors.must_haves} hint="One requirement per line">
          <Textarea id="req-must" name="must_haves" rows={6} defaultValue={values.must_haves.join("\n")} {...invalid("must_haves")} />
        </Field>
        <Field label="Nice to haves" htmlFor="req-nice" error={errors.nice_to_haves} hint="One point per line">
          <Textarea id="req-nice" name="nice_to_haves" rows={6} defaultValue={values.nice_to_haves.join("\n")} {...invalid("nice_to_haves")} />
        </Field>
        <Field label="Still to ask" htmlFor="req-unclear" error={errors.unclear} hint="One question per line" className="sm:col-span-2">
          <Textarea id="req-unclear" name="unclear" rows={4} defaultValue={values.unclear.join("\n")} {...invalid("unclear")} />
        </Field>
      </div>

      <ActionFeedback state={state.error ? {} : state} />

      <div className="flex gap-2 border-t border-border pt-4 max-sm:*:flex-1 sm:justify-end">
        <Button variant="secondary" size="sm" onClick={onDone}>
          {state.ok ? "Close" : "Cancel"}
        </Button>
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Saving" : "Save fixed requirements"}
        </Button>
      </div>
    </form>
  );
}
