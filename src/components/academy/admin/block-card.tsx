"use client";

import { useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { deleteBlock, updateBlock } from "@/app/dashboard/academy/actions";
import { type BlockCompletion, type BlockContent, blockTypes } from "@/lib/academy/blocks/types";
import { blockRegistry } from "@/components/academy/blocks/registry";
import type { EditorBlock } from "@/components/academy/blocks/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import type { DragHandle } from "./sortable-list";
import { useAction } from "./use-action";

/**
 * One block in the lesson editor: title, required, the completion rule of
 * its type (blockTypes[type].completionFields) and the type's own editor
 * from the registry. Save sends everything to updateBlock().
 */
export function BlockCard({ block, handle }: { block: EditorBlock; handle: DragHandle }) {
  const meta = blockTypes[block.type];
  const { icon: Icon, editor: Editor } = blockRegistry[block.type];
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(block.title ?? "");
  const [required, setRequired] = useState(block.required);
  const [completion, setCompletion] = useState<BlockCompletion>(block.completion);
  const [content, setContent] = useState<BlockContent>(block.content);
  const [dirty, setDirty] = useState(false);
  const action = useAction();

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-xs">
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
        {handle}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Icon className="size-[18px] shrink-0 text-brand-600" aria-hidden="true" />
          <span className="truncate font-medium text-brand-900">{block.title || meta.adminLabel}</span>
          <span className="hidden text-xs text-muted sm:inline">{meta.adminLabel}</span>
          {block.required && <Badge tone="accent">Required</Badge>}
          {meta.reserved && <Badge tone="warning">Reserved</Badge>}
          {dirty && <Badge tone="warning">Not saved</Badge>}
        </button>
        <ChevronDown className={`size-5 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </div>
      {open && (
        <div className="space-y-4 border-t border-border px-4 py-4 sm:px-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label="Title (optional)" htmlFor={`b-title-${block.id}`} hint={`Without a title the learner sees "${meta.adminLabel}".`}>
              <Input id={`b-title-${block.id}`} value={title} maxLength={300} onChange={(e) => touch(setTitle)(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 pb-2.5 text-sm font-medium">
              <input type="checkbox" checked={required} onChange={(e) => touch(setRequired)(e.target.checked)} className="size-4 accent-brand-700" />
              Required for the green check
            </label>
          </div>
          {required && meta.completionFields.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {meta.completionFields.map((field) =>
                field.kind === "percent" ? (
                  <Field key={field.key} label={field.label} htmlFor={`b-${field.key}-${block.id}`}>
                    <Input
                      id={`b-${field.key}-${block.id}`}
                      type="number"
                      inputMode="numeric"
                      min={field.min ?? 0}
                      max={field.max ?? 100}
                      value={typeof completion[field.key] === "number" ? (completion[field.key] as number) : field.defaultValue}
                      onChange={(e) => touch(setCompletion)({ ...completion, [field.key]: e.target.value === "" ? field.defaultValue : Number(e.target.value) })}
                      className="sm:w-32"
                    />
                  </Field>
                ) : (
                  <Field key={field.key} label={field.label} htmlFor={`b-${field.key}-${block.id}`}>
                    <Select
                      id={`b-${field.key}-${block.id}`}
                      value={typeof completion[field.key] === "string" ? (completion[field.key] as string) : field.defaultValue}
                      onChange={(e) => touch(setCompletion)({ ...completion, [field.key]: e.target.value })}
                    >
                      {field.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ),
              )}
            </div>
          )}
          <Editor block={block} content={content} onChange={touch(setContent)} disabled={action.pending} />
          <FormMessage error={action.result.error} success={dirty ? undefined : action.result.message} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={action.pending}
              onClick={() =>
                action.run(async () => {
                  const result = await updateBlock({ id: block.id, title: title || null, required, completion, content });
                  if (result.ok) setDirty(false);
                  return result;
                })
              }
            >
              Save block
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={action.pending}
              onClick={() => action.run(() => deleteBlock(block.id), { confirm: "Delete this block? Answers and progress on it are deleted too." })}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
