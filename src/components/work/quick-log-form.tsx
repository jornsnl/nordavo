"use client";

import { useRef } from "react";
import { Check } from "lucide-react";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { useWorkAction, type WorkAction } from "@/components/work/forms";

export function QuickLogForm({
  action,
  projects,
  defaultProjectId,
  nowLocal,
}: {
  action: WorkAction;
  projects: { id: string; label: string }[];
  defaultProjectId?: string;
  nowLocal: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, formAction, pending, errors } = useWorkAction(action, () => {
    const form = formRef.current;
    if (!form) return;
    // Keep the project for the next entry; clear the rest.
    (form.elements.namedItem("title") as HTMLInputElement).value = "";
    (form.elements.namedItem("description") as HTMLTextAreaElement).value = "";
    (form.elements.namedItem("title") as HTMLInputElement).focus();
  });
  return (
    <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <Field label="What did you finish?" htmlFor="log_title" required error={errors.title}>
        <Input id="log_title" name="title" required maxLength={300} autoFocus placeholder="Called 4 candidates for Magento" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project" htmlFor="log_project" required error={errors.project_id}>
          <Select id="log_project" name="project_id" defaultValue={defaultProjectId ?? ""}>
            <option value="" disabled>
              Pick a project
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="When" htmlFor="log_when" hint="Your time zone">
          <Input id="log_when" name="done_at" type="datetime-local" defaultValue={nowLocal} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="log_description">
        <Textarea id="log_description" name="description" rows={3} />
      </Field>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Logging">
          <Check aria-hidden="true" />
          Log as done
        </PendingSubmit>
      </div>
    </form>
  );
}
