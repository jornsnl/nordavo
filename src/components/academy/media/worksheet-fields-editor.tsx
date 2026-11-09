"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { saveWorksheetFields } from "@/app/dashboard/academy/media-actions";
import { WORKSHEET_FIELD_LABELS, WORKSHEET_FIELD_TYPES, type WorksheetField, type WorksheetFieldType } from "@/lib/academy/media/worksheet";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { useMediaRun } from "./document-parts";

type Draft = Omit<WorksheetField, "options" | "min" | "max"> & { optionsText: string; minText: string; maxText: string; id: string };

function toDraft(field: WorksheetField, i: number): Draft {
  return {
    ...field,
    id: `${field.key}-${i}`,
    optionsText: field.options.join("\n"),
    minText: field.min === null ? "" : String(field.min),
    maxText: field.max === null ? "" : String(field.max),
  };
}

function fromDraft(d: Draft) {
  return {
    key: d.key,
    label: d.label,
    type: d.type,
    help: d.help,
    required: d.required,
    options: d.optionsText.split("\n").map((o) => o.trim()).filter(Boolean),
    min: d.minText.trim() === "" ? null : Number(d.minText),
    max: d.maxText.trim() === "" ? null : Number(d.maxText),
  };
}

/**
 * The fields of a worksheet: short text, long text, choice, checkbox,
 * number, date; label, help text, required, options and bounds; order with
 * the arrows. Saved on the document, so every lesson that uses the
 * worksheet changes. Keys stay when a label changes, so answers stay.
 */
export function WorksheetFieldsEditor({ documentId, fields, answered }: { documentId: string; fields: WorksheetField[]; answered: number }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => fields.map(toDraft));
  const [dirty, setDirty] = useState(false);
  const { busy, result, run } = useMediaRun();

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    setDirty(true);
  }

  function move(index: number, by: number) {
    setDrafts((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
    setDirty(true);
  }

  function add(type: WorksheetFieldType) {
    setDrafts((list) => [
      ...list,
      { id: `new-${Date.now()}`, key: "", label: "", type, help: "", required: false, optionsText: type === "choice" ? "Option 1\nOption 2" : "", minText: "", maxText: "" },
    ]);
    setDirty(true);
  }

  return (
    <div className="space-y-4">
      {answered > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {answered} {answered === 1 ? "person has" : "people have"} answered. Changing a label keeps their answers; deleting a field hides its answers.
        </p>
      )}
      {drafts.length === 0 && <p className="text-sm text-muted">No fields yet. Add the first one below.</p>}
      <ol className="space-y-3">
        {drafts.map((d, index) => (
          <li key={d.id} className="space-y-3 rounded-xl border border-border bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted">{index + 1}.</span>
              <span className="text-xs font-medium text-brand-700">{WORKSHEET_FIELD_LABELS[d.type]}</span>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Move down" disabled={index === drafts.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Delete field"
                  onClick={() => {
                    setDrafts((list) => list.filter((x) => x.id !== d.id));
                    setDirty(true);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Field label="Question or label" htmlFor={`f-label-${d.id}`}>
                <Input id={`f-label-${d.id}`} value={d.label} maxLength={300} onChange={(e) => update(d.id, { label: e.target.value })} />
              </Field>
              <Field label="Type" htmlFor={`f-type-${d.id}`}>
                <Select id={`f-type-${d.id}`} value={d.type} onChange={(e) => update(d.id, { type: e.target.value as WorksheetFieldType })}>
                  {WORKSHEET_FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {WORKSHEET_FIELD_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Help text (optional)" htmlFor={`f-help-${d.id}`}>
              <Input id={`f-help-${d.id}`} value={d.help} maxLength={1000} onChange={(e) => update(d.id, { help: e.target.value })} />
            </Field>
            {(d.type === "choice" || d.type === "checkbox") && (
              <Field
                label="Options, one per line"
                htmlFor={`f-options-${d.id}`}
                hint={d.type === "checkbox" ? "Leave empty for a single checkbox (for example: I have read this)." : "The person picks one."}
              >
                <Textarea id={`f-options-${d.id}`} rows={3} value={d.optionsText} onChange={(e) => update(d.id, { optionsText: e.target.value })} />
              </Field>
            )}
            {d.type === "number" && (
              <div className="grid grid-cols-2 gap-3 sm:w-80">
                <Field label="Minimum" htmlFor={`f-min-${d.id}`}>
                  <Input id={`f-min-${d.id}`} type="number" value={d.minText} onChange={(e) => update(d.id, { minText: e.target.value })} />
                </Field>
                <Field label="Maximum" htmlFor={`f-max-${d.id}`}>
                  <Input id={`f-max-${d.id}`} type="number" value={d.maxText} onChange={(e) => update(d.id, { maxText: e.target.value })} />
                </Field>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={d.required} onChange={(e) => update(d.id, { required: e.target.checked })} className="size-4 accent-brand-700" />
              Required to submit
            </label>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {WORKSHEET_FIELD_TYPES.map((type) => (
          <Button key={type} size="sm" variant="secondary" onClick={() => add(type)}>
            <Plus aria-hidden="true" />
            {WORKSHEET_FIELD_LABELS[type].replace(/ \(.*\)$/, "")}
          </Button>
        ))}
      </div>
      <FormMessage error={result.error} success={dirty ? undefined : result.message} />
      <Button
        disabled={busy || !dirty}
        onClick={() =>
          run(async () => {
            const saved = await saveWorksheetFields(documentId, drafts.map(fromDraft));
            if (saved.ok && saved.fields) {
              setDrafts(saved.fields.map(toDraft));
              setDirty(false);
            }
            return saved;
          })
        }
      >
        Save fields
      </Button>
    </div>
  );
}
