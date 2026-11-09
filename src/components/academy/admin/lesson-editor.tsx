"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Copy, Eye, EyeOff, Trash2 } from "lucide-react";
import {
  addBlock,
  deleteLesson,
  duplicateLesson,
  reorderBlocks,
  setLessonStatus,
  updateLesson,
} from "@/app/dashboard/academy/actions";
import { initialActionState } from "@/lib/action-state";
import type { LessonEditor } from "@/lib/academy/admin";
import { BLOCK_TYPES, blockContent, blockTypes, normalizeCompletion } from "@/lib/academy/blocks/types";
import { blockRegistry } from "@/components/academy/blocks/registry";
import type { EditorBlock } from "@/components/academy/blocks/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { BlockCard } from "./block-card";
import { SortableList } from "./sortable-list";
import { useAction } from "./use-action";

export function LessonEditorView({ editor }: { editor: LessonEditor }) {
  const { lesson } = editor;
  const [state, formAction] = useActionState(updateLesson, initialActionState);
  const action = useAction();
  const e = state.fieldErrors ?? {};
  const blocks: EditorBlock[] = editor.blocks.map((b) => ({
    id: b.id,
    lessonId: b.lesson_id,
    type: b.type,
    title: b.title,
    required: b.required,
    completion: normalizeCompletion(b.type, b.completion),
    content: blockContent(b.content),
    videoId: b.video_id,
    documentId: b.document_id,
  }));
  const required = blocks.filter((b) => b.required).length;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <section className="space-y-4 xl:col-span-2" aria-labelledby="blocks-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="blocks-heading" className="font-display text-lg font-semibold text-brand-900">
            Blocks
          </h2>
          <p className="text-sm text-muted">
            {required === 0
              ? "Nothing required: the lesson is done once opened."
              : `${required} required ${required === 1 ? "block" : "blocks"} for the green check.`}
          </p>
        </div>
        {blocks.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-brand-200 bg-card px-4 py-6 text-center text-sm text-muted">
            Add the first block below: an explanation, a video, tasks…
          </p>
        ) : (
          <SortableList
            label="Blocks"
            items={blocks}
            onReorder={(ids) => reorderBlocks(lesson.id, ids)}
            renderItem={(block, handle) => <BlockCard block={block} handle={handle} />}
          />
        )}
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 text-sm font-medium text-ink">Add a block</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {BLOCK_TYPES.map((type) => {
              const meta = blockTypes[type];
              const Icon = blockRegistry[type].icon;
              return (
                <button
                  key={type}
                  type="button"
                  disabled={action.pending}
                  onClick={() => action.run(() => addBlock(lesson.id, type))}
                  className="flex items-start gap-2.5 rounded-xl border border-border px-3 py-2.5 text-left transition hover:border-brand-200 hover:bg-brand-50 disabled:opacity-60"
                >
                  <Icon className="mt-0.5 size-[18px] shrink-0 text-brand-600" aria-hidden="true" />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-medium text-brand-900">
                      {meta.adminLabel}
                      {meta.reserved && <Badge tone="warning">Reserved</Badge>}
                    </span>
                    <span className="block text-xs text-muted">{meta.adminDescription}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Lesson" />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={lesson.status === "published" ? "success" : "neutral"}>{lesson.status === "published" ? "Published" : "Draft"}</Badge>
              <Button
                size="sm"
                variant={lesson.status === "published" ? "secondary" : "primary"}
                disabled={action.pending}
                onClick={() => action.run(() => setLessonStatus(lesson.id, lesson.status === "published" ? "draft" : "published"))}
              >
                {lesson.status === "published" ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                {lesson.status === "published" ? "Back to draft" : "Publish"}
              </Button>
              <Button size="sm" variant="secondary" disabled={action.pending} onClick={() => action.run(() => duplicateLesson(lesson.id, editor.usedIn[0]?.moduleId ?? null))}>
                <Copy aria-hidden="true" />
                Duplicate
              </Button>
              {lesson.status === "draft" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.pending}
                  onClick={() => action.run(() => deleteLesson(lesson.id), { confirm: `Delete "${lesson.title}" everywhere it is used?` })}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </Button>
              )}
            </div>
            <FormMessage error={action.result.error} success={action.result.message} link={action.result.link} />
            <form action={formAction} className="space-y-4">
              <input type="hidden" name="id" value={lesson.id} />
              <FormMessage error={state.error} success={state.message} />
              <Field label="Title" htmlFor="lesson-title" error={e.title} required>
                <Input id="lesson-title" name="title" defaultValue={lesson.title} maxLength={300} required />
              </Field>
              <Field label="Summary" htmlFor="lesson-summary" error={e.summary}>
                <Textarea id="lesson-summary" name="summary" defaultValue={lesson.summary ?? ""} rows={2} maxLength={2000} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Language" htmlFor="lesson-language" error={e.language}>
                  <Select id="lesson-language" name="language" defaultValue={lesson.language}>
                    <option value="nl">Dutch</option>
                    <option value="en">English</option>
                  </Select>
                </Field>
                <Field label="Minutes" htmlFor="lesson-minutes" error={e.duration_minutes}>
                  <Input id="lesson-minutes" name="duration_minutes" type="number" min={0} max={600} inputMode="numeric" defaultValue={lesson.duration_minutes ?? ""} />
                </Field>
              </div>
              <SubmitButton size="sm" pendingLabel="Saving…">
                Save lesson
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Used in" description="One lesson, many places: an edit here shows in every module below." />
          <CardBody>
            {editor.usedIn.length === 0 ? (
              <p className="text-sm text-muted">Not in a module yet. Add it to a module from the course editor.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {editor.usedIn.map((u) => (
                  <li key={u.moduleId}>
                    <Link href={`/dashboard/academy/courses/${u.courseId}`} className="font-medium text-brand-800 hover:underline">
                      {u.courseTitle}
                    </Link>
                    <span className="text-muted"> · {u.moduleTitle}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
