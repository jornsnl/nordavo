"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { ActionFeedback } from "@/components/talent/action-button";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { SCREENING_MODELS } from "@/lib/screening/scoring";
import type { TalentActionState } from "@/lib/talent/types";
import { comparePromptAction, createPromptAction } from "@/app/dashboard/vacancies/screening-actions";

export function NewPromptForm({ defaultInstructions }: { defaultInstructions: string }) {
  const [state, action] = useActionState(createPromptAction, {} as TalentActionState);
  return (
    <form action={action} className="space-y-4">
      <Field
        label="Instructions"
        htmlFor="prompt-instructions"
        hint="What Claude is told about Nordavo and how to judge a CV. The output format (requirements, match percentage, verdict, summary) is added by the system and cannot break."
      >
        <Textarea id="prompt-instructions" name="instructions" rows={16} defaultValue={defaultInstructions} maxLength={20000} required />
      </Field>
      <Field label="What changed" htmlFor="prompt-notes" hint="For example: stricter on years of Python, less weight on certificates.">
        <Input id="prompt-notes" name="notes" maxLength={2000} />
      </Field>
      <SubmitButton pendingLabel="Saving">Save as new version</SubmitButton>
      <ActionFeedback state={state} />
    </form>
  );
}

export function CompareForm({ promptId, vacancies }: { promptId: string | null; vacancies: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState(comparePromptAction.bind(null, promptId), {} as TalentActionState);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <Field label="Vacancy" htmlFor={`cmp-v-${promptId ?? "0"}`} className="sm:w-64">
          <Select id={`cmp-v-${promptId ?? "0"}`} name="vacancy_id" defaultValue="" required>
            <option value="" disabled>
              Choose a vacancy
            </option>
            {vacancies.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sample" htmlFor={`cmp-n-${promptId ?? "0"}`} className="sm:w-24">
          <Input id={`cmp-n-${promptId ?? "0"}`} name="sample" type="number" min={1} max={50} defaultValue={10} inputMode="numeric" />
        </Field>
        <Field label="Model" htmlFor={`cmp-m-${promptId ?? "0"}`} className="sm:w-48">
          <Select id={`cmp-m-${promptId ?? "0"}`} name="model" defaultValue="">
            <option value="">The vacancy&apos;s model</option>
            {SCREENING_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Re-scoring" : "Re-score sample"}
        </Button>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}
