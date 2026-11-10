"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { ArrowDown, ArrowUp, LoaderCircle } from "lucide-react";
import type { ContentActionState } from "@/lib/content/errors";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { toast } from "@/components/ui/toaster";

export type FormAction = (prev: ContentActionState, formData: FormData) => Promise<ContentActionState>;
export type DirectAction = () => Promise<ContentActionState>;

/**
 * A settings form around a server action: shows its message and passes the
 * field errors to the children. Keeps the values after saving.
 */
export function ActionForm({
  action,
  children,
  submit = "Save",
  className = "space-y-4",
  inline = false,
}: {
  action: FormAction;
  children: ReactNode;
  submit?: string;
  className?: string;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  // Field errors are listed with the message: the inputs are rendered on the server.
  const details = Object.values(state.fieldErrors ?? {});
  const error = state.error ? [state.error, ...details].join(" ") : undefined;
  return (
    <form onSubmit={submitWithoutReset(formAction)} className={className}>
      {!inline && <FormMessage error={error} success={state.ok ? state.message : undefined} />}
      {children}
      <div className={inline ? "flex items-end" : "flex justify-end max-sm:*:w-full"}>
        <PendingSubmit pending={pending} pendingLabel="Saving" size={inline ? "sm" : "md"} variant={inline ? "secondary" : "primary"}>
          {submit}
        </PendingSubmit>
      </div>
      {inline && error && <p className="basis-full text-xs font-medium text-danger">{error}</p>}
    </form>
  );
}

/** A button that runs a server action and reports the result as a toast. */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  confirm,
  label,
}: {
  action: DirectAction;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  confirm?: string;
  label?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      aria-label={label}
      title={label}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const result = await action();
          if (result.error) toast(result.error, { tone: "error" });
          else if (result.message) toast(result.message);
        });
      }}
    >
      {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : children}
    </Button>
  );
}

export function MoveButtons({ up, down }: { up: DirectAction | null; down: DirectAction | null }) {
  return (
    <span className="flex gap-1">
      {up ? (
        <ActionButton action={up} variant="ghost" label="Move up">
          <ArrowUp aria-hidden="true" />
        </ActionButton>
      ) : (
        <span className="size-8" />
      )}
      {down ? (
        <ActionButton action={down} variant="ghost" label="Move down">
          <ArrowDown aria-hidden="true" />
        </ActionButton>
      ) : (
        <span className="size-8" />
      )}
    </span>
  );
}

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Time and weekdays of a time slot. */
export function TimeSlotInputs({ id, time, days }: { id: string; time?: string; days?: number[] }) {
  return (
    <>
      <Field label="Time" htmlFor={`${id}_time`}>
        <Input id={`${id}_time`} name="time" type="time" defaultValue={time ?? "08:30"} required className="w-32" />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-ink">Days</legend>
        <div className="flex flex-wrap gap-2">
          {weekdays.map((day, i) => (
            <label key={day} className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="weekdays" value={i + 1} defaultChecked={days?.includes(i + 1)} className="size-4 accent-brand-700" />
              {day}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

/** Field type picker that shows the choices or relation target inputs that go with it. */
export function FieldTypeInputs({ id, types }: { id: string; types: { value: string; label: string }[] }) {
  const [type, setType] = useState("text");
  return (
    <>
      <Field label="Type" htmlFor={`${id}_type`}>
        <Select id={`${id}_type`} name="field_type" value={type} onChange={(e) => setType(e.target.value)}>
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      {(type === "single_choice" || type === "multiple_choice") && (
        <Field label="Choices" htmlFor={`${id}_choices`} hint="One per line" className="sm:col-span-2">
          <Textarea id={`${id}_choices`} name="choices" rows={3} />
        </Field>
      )}
      {type === "relation" && (
        <Field label="Relates to" htmlFor={`${id}_target`}>
          <Select id={`${id}_target`} name="target" defaultValue="post">
            <option value="post">Post</option>
            <option value="idea">Idea</option>
            <option value="series">Series</option>
            <option value="source">Source</option>
          </Select>
        </Field>
      )}
    </>
  );
}

export function Checkbox({ name, label, defaultChecked, disabled, hint }: { name: string; label: string; defaultChecked?: boolean; disabled?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="mt-0.5 size-4 shrink-0 accent-brand-700" />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}
