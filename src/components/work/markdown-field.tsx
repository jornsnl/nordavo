"use client";

import { useRef, useState } from "react";
import { Field, Textarea } from "@/components/ui/field";
import { Markdown } from "@/components/work/markdown";

/**
 * A description field with Markdown and a Preview, so you see how the bold,
 * lists and links come out before you save (feedback Julius: the hint said
 * Markdown works, but you never saw it). The text stays in the textarea
 * while previewing, so the form always sends it.
 */
export function MarkdownField({
  id,
  name,
  label,
  defaultValue = "",
  rows = 6,
  error,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  rows?: number;
  error?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // The text at the moment Preview was pressed; the textarea itself stays uncontrolled, so a form reset empties it.
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <Field
      label={label}
      htmlFor={id}
      error={error}
      hint={
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Markdown: **bold**, *italic*, - lists, 1. numbered, - [ ] checklist, [link](https://…)
          </span>
          <button
            type="button"
            onClick={() => setPreview((p) => (p === null ? (ref.current?.value ?? "") : null))}
            aria-pressed={preview !== null}
            className="rounded-md px-1.5 py-0.5 font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500 pointer-coarse:min-h-9"
          >
            {preview !== null ? "Edit" : "Preview"}
          </button>
        </span>
      }
    >
      <Textarea
        ref={ref}
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className={preview !== null ? "hidden" : ""}
        aria-invalid={Boolean(error)}
      />
      {preview !== null && (
        <div className="min-h-24 rounded-xl border border-dashed border-border bg-surface/50 px-3.5 py-2.5" aria-live="polite">
          {preview.trim() ? <Markdown text={preview} /> : <p className="text-sm text-muted">Nothing to preview yet.</p>}
        </div>
      )}
    </Field>
  );
}
