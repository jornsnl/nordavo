"use client";

import { useActionState, useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Plus, Settings2 } from "lucide-react";
import { createCustomField, saveCustomFieldValues } from "@/lib/custom-fields/actions";
import type { ActionState } from "@/lib/action-state";
import {
  formatValue,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldValues,
} from "@/lib/custom-fields";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { CustomFieldInput } from "./field-input";
import { DefinitionForm } from "./definition-form";

/**
 * Shows the custom fields of one record and edits them in place. "+ Add field"
 * makes a new field for this record type straight from here.
 */
export function CustomFieldsEditor({
  entity,
  recordId,
  definitions,
  values: initialValues,
  onFieldAdded,
  headingLevel = "h2",
  framed = true,
  title = "Custom fields",
  blockKey,
  blocks,
}: {
  entity: CustomFieldEntity;
  recordId: string;
  definitions: CustomFieldDefinition[];
  values: CustomFieldValues;
  /** Called after a new field was made; defaults to refreshing the page. */
  onFieldAdded?: () => void;
  headingLevel?: "h2" | "h3";
  /** Card look (pages) or a lighter section (inside a modal). */
  framed?: boolean;
  /** Name of the block (page layouts). */
  title?: string;
  /** Block a field added here goes in (page layouts); the default block when left out. */
  blockKey?: string;
  /** Blocks a new field can go in, for the form. */
  blocks?: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const headingId = useId();

  // New values from the server (after a refresh) replace the local copy.
  const [seen, setSeen] = useState(initialValues);
  if (seen !== initialValues) {
    setSeen(initialValues);
    setValues(initialValues);
  }

  const save = useCallback(
    async (prev: ActionState, formData: FormData) => {
      const result = await saveCustomFieldValues(entity, recordId, prev, formData);
      if (result.values) setValues(result.values);
      if (result.ok) setEditing(false);
      return result;
    },
    [entity, recordId],
  );
  const [state, formAction, pending] = useActionState(save, {});
  const errors = state.fieldErrors ?? {};

  const added = useCallback(() => {
    setAdding(false);
    if (onFieldAdded) onFieldAdded();
    else router.refresh();
    setEditing(true);
  }, [onFieldAdded, router]);

  const Heading = headingLevel;
  const wrapper = framed ? "rounded-2xl border border-border bg-card shadow-xs" : "rounded-xl border border-border bg-surface/60";

  return (
    <section aria-labelledby={headingId} className={wrapper}>
      <header className={`flex flex-wrap items-center justify-between gap-2 ${framed ? "border-b border-border px-4 py-3.5 sm:px-5 sm:py-4" : "px-4 pt-4"}`}>
        <div className="min-w-0">
          <Heading id={headingId} className={`font-display font-semibold text-brand-900 ${framed ? "text-base" : "text-sm"}`}>
            {title}
          </Heading>
          {framed && !blockKey && <p className="mt-0.5 text-sm text-muted">Extra fields your team added.</p>}
        </div>
        <div className="flex items-center gap-1">
          {!editing && definitions.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add field
          </Button>
        </div>
      </header>

      <div className={framed ? "px-4 py-4 sm:px-5" : "p-4"}>
        {!editing && state.ok && state.message && <FormMessage success={state.message} />}
        {definitions.length === 0 ? (
          <p className="text-sm text-muted">
            {blockKey && blockKey !== "custom" ? "No fields in this block yet." : "No custom fields yet."} Add one here, or manage them under{" "}
            <Link href="/dashboard/settings#custom-fields" className="font-medium text-brand-700 underline-offset-4 hover:underline">
              Settings
            </Link>
            .
          </p>
        ) : editing ? (
          <form onSubmit={submitWithoutReset(formAction)} noValidate className="space-y-4">
            <FormMessage error={state.error} />
            <div className="grid gap-4 sm:grid-cols-2">
              {definitions.map((def) => (
                <div key={def.id} className={def.fieldType === "long_text" || def.fieldType === "multi_choice" ? "sm:col-span-2" : ""}>
                  <input type="hidden" name="cf__fields" value={def.key} />
                  <CustomFieldInput def={def} value={values[def.key]} error={errors[`cf_${def.key}`]} idPrefix={`${headingId}-cf`} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2 max-sm:*:flex-1">
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
              <PendingSubmit pending={pending} pendingLabel="Saving">
                Save
              </PendingSubmit>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:gap-x-6">
            {definitions.map((def) => {
              const text = formatValue(def, values[def.key]);
              const wide = def.fieldType === "long_text";
              return (
                <div key={def.id} className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
                  <dt className="text-xs font-medium tracking-wide text-muted uppercase">{def.label}</dt>
                  <dd className={`mt-1 text-sm break-words text-ink ${wide ? "whitespace-pre-line" : ""}`}>
                    {!text ? (
                      <span className="text-muted">Not filled in</span>
                    ) : def.fieldType === "url" ? (
                      <a href={String(values[def.key])} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                        {text.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      text
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {framed && definitions.length > 0 && !editing && (
          <p className="mt-4 text-xs text-muted">
            <Link href="/dashboard/settings#custom-fields" className="inline-flex items-center gap-1 hover:text-brand-700 hover:underline">
              <Settings2 className="size-3.5" aria-hidden="true" />
              Manage fields
            </Link>
          </p>
        )}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a field" description="For every record of this type. Manage all fields under Settings.">
        {adding && <DefinitionForm action={createCustomField} entity={entity} blockKey={blockKey} blocks={blocks} onDone={added} />}
      </Modal>
    </section>
  );
}
