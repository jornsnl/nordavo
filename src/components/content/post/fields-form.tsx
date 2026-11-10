"use client";

import { Save } from "lucide-react";
import { updatePostFieldsAction } from "@/app/content/actions/posts";
import type { OptionItem } from "@/lib/content/data";
import type { CustomValue, FieldDef } from "@/lib/content/rules";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PendingSubmit } from "@/components/placements/form-utils";
import { OptionSelect } from "@/components/content/option-select";
import { CustomFieldInputs, type RelationChoice } from "@/components/content/custom-field-inputs";
import { useContentAction } from "@/components/content/post/use-content-action";

export type PostFieldValues = {
  channel: string | null;
  language: string | null;
  planned_date: string | null;
  time_slot: string | null;
  audience: string | null;
  theme: string | null;
  angle: string | null;
  format: string | null;
  priority: string | null;
  series_id: string | null;
  source_id: string | null;
  notes: string | null;
};

type Lists = "channel" | "language" | "time_slot" | "audience" | "theme" | "angle" | "format" | "priority";

const listLabels: Record<Lists, string> = {
  channel: "Channel",
  language: "Language",
  time_slot: "Time slot",
  audience: "Audience",
  theme: "Theme",
  angle: "Angle",
  format: "Format",
  priority: "Priority",
};

/**
 * What the post is about and when it goes live. Authors and admins edit;
 * reviewers set the date and slot from the calendar and the publish panel.
 */
export function PostFieldsForm({
  slug,
  postId,
  editable,
  values,
  options,
  series,
  sources,
  fields,
  custom,
  choices,
}: {
  slug: string;
  postId: string;
  editable: boolean;
  values: PostFieldValues;
  options: Record<Lists, OptionItem[]>;
  series: RelationChoice[] | null;
  sources: RelationChoice[] | null;
  fields: FieldDef[];
  custom: Record<string, CustomValue>;
  choices: Record<string, RelationChoice[]>;
}) {
  const { onSubmit, pending, errors, state } = useContentAction(updatePostFieldsAction.bind(null, slug, postId));
  const disabled = !editable;
  const select = (list: Lists, empty: string | false = "None") => (
    <Field key={list} label={listLabels[list]} htmlFor={`pf-${list}`}>
      <OptionSelect id={`pf-${list}`} name={list} options={options[list]} defaultValue={values[list]} empty={empty} disabled={disabled} />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Planned date" htmlFor="pf-date" error={errors.planned_date}>
          <Input id="pf-date" name="planned_date" type="date" defaultValue={values.planned_date ?? ""} disabled={disabled} />
        </Field>
        {select("time_slot")}
        {select("channel", false)}
        {select("language")}
        {select("audience")}
        {select("theme")}
        {select("angle")}
        {select("format")}
        {select("priority")}
        {series && (
          <Field label="Series" htmlFor="pf-series">
            <Select id="pf-series" name="series_id" defaultValue={values.series_id ?? ""} disabled={disabled}>
              <option value="">None</option>
              {series.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {sources && (
          <Field label="Source" htmlFor="pf-source">
            <Select id="pf-source" name="source_id" defaultValue={values.source_id ?? ""} disabled={disabled}>
              <option value="">None</option>
              {sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <CustomFieldInputs fields={fields} values={custom} choices={choices} errors={errors} disabled={disabled} />
      <Field label="Notes" htmlFor="pf-notes">
        <Textarea id="pf-notes" name="notes" rows={3} defaultValue={values.notes ?? ""} disabled={disabled} maxLength={10_000} />
      </Field>
      {state.error && state.fieldErrors && <p className="text-sm text-danger">{state.error}</p>}
      {editable && (
        <PendingSubmit pending={pending} pendingLabel="Saving" size="sm">
          <Save aria-hidden="true" />
          Save details
        </PendingSubmit>
      )}
    </form>
  );
}
