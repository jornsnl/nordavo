"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { customFieldTypes, isChoiceType, type CustomFieldType } from "@/lib/custom-fields";
import { createCustomField } from "@/lib/custom-fields/actions";
import { customKey } from "@/lib/sales/grid-extras";

const entityLabels: Record<"company" | "contact", string> = {
  company: "Company (also on the lead page)",
  contact: "Contact person",
};

/**
 * Adds an own column to a sales table (feedback Julius, 87399c89). It is a
 * custom field of companies or contacts, so it also shows on the lead page,
 * in Settings, Fields, and through the MCP.
 */
export function AddColumnDialog({
  entities,
  onClose,
  onAdded,
}: {
  entities: ("company" | "contact")[];
  onClose: () => void;
  /** Called with the grid key of the new column. */
  onAdded: (key: string) => void;
}) {
  const [entity, setEntity] = useState(entities[0]);
  const [type, setType] = useState<CustomFieldType>("text");
  const [error, setError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  return (
    <Modal open onClose={onClose} title="Add a column" description="A column of your own: name it, pick what it holds, then fill it in the table.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          data.set("entity", entity);
          startTransition(async () => {
            const result = await createCustomField({}, data);
            if (result.error || !result.field) {
              setError(result.error ?? "The column could not be added.");
              setFieldErrors(result.fieldErrors ?? {});
              return;
            }
            onAdded(customKey(entity, result.field.key));
          });
        }}
      >
        <FormMessage error={error} />
        <Field label="Name" htmlFor="col-label" required error={fieldErrors.label}>
          <Input id="col-label" name="label" required maxLength={80} autoFocus placeholder="For example Tech stack" />
        </Field>
        {entities.length > 1 && (
          <Field label="Column of" htmlFor="col-entity">
            <Select id="col-entity" value={entity} onChange={(e) => setEntity(e.target.value as "company" | "contact")}>
              {entities.map((en) => (
                <option key={en} value={en}>
                  {entityLabels[en]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Holds" htmlFor="col-type" error={fieldErrors.field_type}>
          <Select id="col-type" name="field_type" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
            {customFieldTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}: {t.hint}
              </option>
            ))}
          </Select>
        </Field>
        {isChoiceType(type) && (
          <Field label="Options" htmlFor="col-options" hint="One per line." error={fieldErrors.options}>
            <Textarea id="col-options" name="options" rows={4} required />
          </Field>
        )}
        <Field label="Help text" htmlFor="col-help" hint="Optional, shown on the lead page." error={fieldErrors.help_text}>
          <Input id="col-help" name="help_text" maxLength={300} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            Add column
          </Button>
        </div>
      </form>
    </Modal>
  );
}
