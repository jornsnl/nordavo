"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { inputValue, type CustomFieldDefinition, type CustomFieldValue } from "@/lib/custom-fields";

/** The form control for one custom field, named cf_<key>. */
export function CustomFieldInput({
  def,
  value,
  error,
  idPrefix,
}: {
  def: CustomFieldDefinition;
  value: CustomFieldValue | undefined;
  error?: string;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${def.key}`;
  const name = `cf_${def.key}`;
  const common = {
    id,
    name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  } as const;
  const wide = def.fieldType === "long_text" || def.fieldType === "multi_choice";

  let control;
  switch (def.fieldType) {
    case "long_text":
      control = <Textarea {...common} rows={3} maxLength={10000} defaultValue={inputValue(def, value)} />;
      break;
    case "number":
      control = <Input {...common} type="text" inputMode="decimal" defaultValue={inputValue(def, value)} />;
      break;
    case "date":
      control = <Input {...common} type="date" defaultValue={inputValue(def, value)} />;
      break;
    case "url":
      control = <Input {...common} type="url" inputMode="url" placeholder="https://" maxLength={2000} defaultValue={inputValue(def, value)} />;
      break;
    case "boolean":
      control = (
        <Select {...common} defaultValue={inputValue(def, value)}>
          <option value="">Not set</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      );
      break;
    case "single_choice": {
      const current = typeof value === "string" ? value : "";
      control = (
        <Select {...common} defaultValue={current}>
          <option value="">Not set</option>
          {current && !def.options.includes(current) && <option value={current}>{current} (removed option)</option>}
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
      break;
    }
    case "multi_choice": {
      const current = Array.isArray(value) ? value : [];
      const all = [...def.options, ...current.filter((v) => !def.options.includes(v))];
      control = (
        <fieldset id={id} aria-describedby={common["aria-describedby"]} className="flex flex-wrap gap-2">
          <legend className="sr-only">{def.label}</legend>
          {all.map((o) => (
            <label
              key={o}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm has-checked:border-brand-500 has-checked:bg-brand-50 pointer-coarse:min-h-9"
            >
              <input type="checkbox" name={name} value={o} defaultChecked={current.includes(o)} className="accent-brand-700" />
              {o}
              {!def.options.includes(o) && <span className="text-xs text-muted">(removed)</span>}
            </label>
          ))}
        </fieldset>
      );
      break;
    }
    default:
      control = <Input {...common} type="text" maxLength={500} defaultValue={inputValue(def, value)} />;
  }

  return (
    <Field label={def.label} htmlFor={id} hint={def.helpText ?? undefined} error={error} className={wide ? "sm:col-span-2" : ""}>
      {control}
    </Field>
  );
}
