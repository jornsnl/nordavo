import { Field, Input, Select } from "@/components/ui/field";
import type { CustomValue, FieldDef } from "@/lib/content/rules";

export type RelationChoice = { value: string; label: string };

/**
 * Inputs for the extra fields of a workspace (Settings, Extra fields), inside
 * a form. Names are cf_<key>; read them back with readCustomFields
 * (src/lib/content/forms.ts) and clean them with cleanCustomFields.
 * Relation and file fields need their choices (posts, ideas, series,
 * sources or media files of the workspace) passed in by key.
 */
export function CustomFieldInputs({
  fields,
  values,
  choices = {},
  errors = {},
  disabled,
}: {
  fields: FieldDef[];
  values: Record<string, CustomValue | undefined>;
  choices?: Record<string, RelationChoice[]>;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const id = `cf_${field.key}`;
        const value = values[field.key];
        const text = value === null || value === undefined || Array.isArray(value) ? "" : String(value);
        return (
          <Field key={field.key} label={field.label} htmlFor={id} error={errors[`cf_${field.key}`] ?? errors[field.key]}>
            {field.type === "single_choice" ? (
              <Select id={id} name={id} defaultValue={text} disabled={disabled}>
                <option value="">None</option>
                {field.choices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            ) : field.type === "multiple_choice" ? (
              <div id={id} className="flex flex-wrap gap-2 rounded-xl border border-border bg-white p-2.5">
                {field.choices.map((c) => (
                  <label key={c} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name={id}
                      value={c}
                      defaultChecked={Array.isArray(value) && value.includes(c)}
                      disabled={disabled}
                      className="size-4 accent-brand-700"
                    />
                    {c}
                  </label>
                ))}
                {field.choices.length === 0 && <span className="text-xs text-muted">No choices yet (Settings)</span>}
              </div>
            ) : field.type === "relation" || field.type === "file" ? (
              <Select id={id} name={id} defaultValue={text} disabled={disabled}>
                <option value="">None</option>
                {(choices[field.key] ?? []).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={id}
                name={id}
                type={field.type === "number" ? "text" : field.type === "date" ? "date" : field.type === "link" ? "url" : "text"}
                inputMode={field.type === "number" ? "decimal" : undefined}
                defaultValue={text}
                disabled={disabled}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
