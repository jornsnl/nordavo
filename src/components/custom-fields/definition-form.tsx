"use client";

import { useActionState, useEffect, useId, useState } from "react";
import type { ActionState } from "@/lib/action-state";
import {
  customFieldEntities,
  customFieldTypes,
  isChoiceType,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
} from "@/lib/custom-fields";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Add or edit a custom field definition. For a new field the record type can
 * be fixed (inline "+ Add field" on a candidate or vacancy page). Once made,
 * the record type and type stay (text and long text may swap).
 */
export function DefinitionForm({
  action,
  field,
  entity,
  onDone,
  submitLabel,
}: {
  action: Action;
  field?: CustomFieldDefinition;
  /** Fixes the record type of a new field. */
  entity?: CustomFieldEntity;
  onDone?: (state: ActionState) => void;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [type, setType] = useState<CustomFieldType>(field?.fieldType ?? "text");
  const [target, setTarget] = useState<CustomFieldEntity>(field?.entity ?? entity ?? "candidate");
  const id = useId();
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok) onDone?.(state);
  }, [state, onDone]);

  const typeLocked = Boolean(field) && field?.fieldType !== "text" && field?.fieldType !== "long_text";
  const typeChoices = field
    ? customFieldTypes.filter((t) => (typeLocked ? t.value === field.fieldType : t.value === "text" || t.value === "long_text"))
    : customFieldTypes;

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.ok && !onDone ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${id}-label`} required error={errors.label}>
          <Input id={`${id}-label`} name="label" defaultValue={field?.label} maxLength={80} required placeholder="e.g. Notice period" />
        </Field>
        {field || entity ? (
          <input type="hidden" name="entity" value={target} />
        ) : (
          <Field label="Add to" htmlFor={`${id}-entity`} required error={errors.entity}>
            <Select id={`${id}-entity`} name="entity" value={target} onChange={(e) => setTarget(e.target.value as CustomFieldEntity)}>
              {customFieldEntities.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.plural}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label="Type"
          htmlFor={`${id}-type`}
          required
          error={errors.field_type}
          hint={customFieldTypes.find((t) => t.value === type)?.hint}
        >
          <Select
            id={`${id}-type`}
            name="field_type"
            value={type}
            disabled={typeLocked}
            onChange={(e) => setType(e.target.value as CustomFieldType)}
          >
            {typeChoices.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        {typeLocked && <input type="hidden" name="field_type" value={type} />}
        <Field label="Help text" htmlFor={`${id}-help`} error={errors.help_text} hint="Shown under the field. Optional.">
          <Input id={`${id}-help`} name="help_text" defaultValue={field?.helpText ?? ""} maxLength={300} />
        </Field>
      </div>
      {isChoiceType(type) && (
        <Field
          label="Options"
          htmlFor={`${id}-options`}
          required
          error={errors.options}
          hint={field ? "One per line. Removing an option keeps it on records that have it, marked as removed." : "One per line."}
        >
          <Textarea id={`${id}-options`} name="options" rows={4} defaultValue={field?.options.join("\n")} placeholder={"Option A\nOption B"} />
        </Field>
      )}
      {target === "candidate" && (
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="show_in_list"
            defaultChecked={field?.showInList}
            className="mt-0.5 size-4 accent-brand-700"
          />
          <span>
            <span className="font-medium text-ink">Show as a column on the candidates list</span>
            <span className="block text-xs text-muted">With a filter and sorting on that column.</span>
          </span>
        </label>
      )}
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          {submitLabel ?? (field ? "Save field" : "Add field")}
        </PendingSubmit>
      </div>
    </form>
  );
}
