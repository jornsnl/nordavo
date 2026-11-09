"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDragSensors } from "@/components/ui/dnd";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  GripVertical,
  LoaderCircle,
  Plus,
  Rocket,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { closeForm, publishForm, saveFormDraft } from "@/app/dashboard/vacancies/[id]/form/actions";
import type { ActionState } from "@/lib/action-state";
import {
  CHOICE_TYPES,
  QUESTION_TYPES,
  blocksSchema,
  mappingLabels,
  mappingsForType,
  newId,
  questionTypeLabels,
  type Block,
  type Question,
  type QuestionType,
  type RoleType,
} from "@/lib/forms/schema";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";

type Meta = {
  title: string;
  intro: string;
  roleType: RoleType;
  maxReminders: number;
  reminderIntervalDays: number;
};

/**
 * The form editor, as close to the Airtable editor as it gets: groups with
 * a title and explanation, a + between any two questions, drag to reorder,
 * two questions side by side, and per question its type, help text,
 * required flag, choices and the candidate field it fills.
 */
export function FormBuilder({
  formId,
  vacancyId,
  initialMeta,
  initialBlocks,
  status,
  version,
  hasUnpublishedChanges,
}: {
  formId: string;
  vacancyId: string;
  initialMeta: Meta;
  initialBlocks: Block[];
  status: "draft" | "published";
  version: number;
  hasUnpublishedChanges: boolean;
}) {
  const [meta, setMeta] = useState(initialMeta);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [dirty, setDirty] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const sensors = useDragSensors(sortableKeyboardCoordinates);

  function change(next: Block[]) {
    setBlocks(next);
    setDirty(true);
  }
  function changeMeta(patch: Partial<Meta>) {
    setMeta((m) => ({ ...m, ...patch }));
    setDirty(true);
  }

  function updateBlock(blockId: string, patch: Partial<Block>) {
    change(blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)));
  }
  function updateQuestion(questionId: string, patch: Partial<Question>) {
    change(blocks.map((b) => ({ ...b, questions: b.questions.map((q) => (q.id === questionId ? cleanQuestion({ ...q, ...patch }) : q)) })));
  }
  function insertQuestion(blockId: string, index: number) {
    const q: Question = { id: newId("q"), type: "short_text", label: "New question", required: false, width: "full" };
    change(blocks.map((b) => (b.id === blockId ? { ...b, questions: [...b.questions.slice(0, index), q, ...b.questions.slice(index)] } : b)));
    setOpenId(q.id);
  }
  function duplicateQuestion(blockId: string, q: Question) {
    const copy = { ...q, id: newId("q"), label: `${q.label} (copy)`, mapsTo: undefined };
    change(
      blocks.map((b) => {
        if (b.id !== blockId) return b;
        const i = b.questions.findIndex((x) => x.id === q.id);
        return { ...b, questions: [...b.questions.slice(0, i + 1), copy, ...b.questions.slice(i + 1)] };
      }),
    );
    setOpenId(copy.id);
  }
  function removeQuestion(questionId: string) {
    change(blocks.map((b) => ({ ...b, questions: b.questions.filter((q) => q.id !== questionId) })));
  }
  function moveQuestionToBlock(questionId: string, targetBlockId: string) {
    const q = blocks.flatMap((b) => b.questions).find((x) => x.id === questionId);
    if (!q) return;
    change(
      blocks.map((b) => {
        const without = b.questions.filter((x) => x.id !== questionId);
        return b.id === targetBlockId ? { ...b, questions: [...without, q] } : { ...b, questions: without };
      }),
    );
  }
  function moveQuestion(blockId: string, index: number, delta: number) {
    change(
      blocks.map((b) => {
        if (b.id !== blockId) return b;
        const to = index + delta;
        if (to < 0 || to >= b.questions.length) return b;
        return { ...b, questions: arrayMove(b.questions, index, to) };
      }),
    );
  }
  function addBlock(index: number) {
    const block: Block = { id: newId("b"), title: "New group", description: "", questions: [] };
    change([...blocks.slice(0, index), block, ...blocks.slice(index)]);
  }
  function moveBlock(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= blocks.length) return;
    change(arrayMove(blocks, index, to));
  }
  function removeBlock(blockId: string) {
    const block = blocks.find((b) => b.id === blockId);
    if (block && block.questions.length > 0 && !window.confirm(`Delete "${block.title || "this group"}" and its ${block.questions.length} questions?`)) return;
    change(blocks.filter((b) => b.id !== blockId));
  }

  function onBlocksDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = blocks.findIndex((b) => b.id === active.id);
    const to = blocks.findIndex((b) => b.id === over.id);
    if (from >= 0 && to >= 0) change(arrayMove(blocks, from, to));
  }
  function onQuestionsDragEnd(blockId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    change(
      blocks.map((b) => {
        if (b.id !== blockId) return b;
        const from = b.questions.findIndex((q) => q.id === active.id);
        const to = b.questions.findIndex((q) => q.id === over.id);
        return from >= 0 && to >= 0 ? { ...b, questions: arrayMove(b.questions, from, to) } : b;
      }),
    );
  }

  const problem = useMemo(() => {
    const parsed = blocksSchema.safeParse(blocks);
    if (parsed.success) return meta.title.trim() ? null : "Give the form a title.";
    return parsed.error.issues[0]?.message ?? "Check the questions.";
  }, [blocks, meta.title]);

  async function save(): Promise<boolean> {
    const result = await saveFormDraft(formId, { ...meta, blocks });
    setMessage(result);
    if (result.ok) setDirty(false);
    return !!result.ok;
  }

  function onSave() {
    startTransition(async () => {
      await save();
    });
  }
  function onPublish() {
    startTransition(async () => {
      if (dirty && !(await save())) return;
      setMessage(await publishForm(formId));
      setDirty(false);
    });
  }
  function onClose() {
    if (!window.confirm("Close the form? The links then show that the form is closed.")) return;
    startTransition(async () => setMessage(await closeForm(formId)));
  }

  const unpublished = dirty || hasUnpublishedChanges;
  const questionCount = blocks.reduce((n, b) => n + b.questions.length, 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
          {status === "published" ? <Badge tone="success">Published v{version}</Badge> : <Badge tone="neutral">{version > 0 ? "Closed" : "Draft"}</Badge>}
          {dirty ? (
            <span className="text-amber-700">Unsaved changes</span>
          ) : unpublished && version > 0 ? (
            <span className="text-muted">Saved, not published yet</span>
          ) : (
            <span className="text-muted">
              {questionCount} {questionCount === 1 ? "question" : "questions"}
            </span>
          )}
        </div>
        <ButtonLink href={`/dashboard/vacancies/${vacancyId}/form/preview`} variant="ghost" size="sm" target="_blank">
          <Eye aria-hidden="true" />
          Preview
        </ButtonLink>
        <Button variant="secondary" size="sm" onClick={onSave} disabled={pending || !dirty || !!problem}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          Save draft
        </Button>
        <Button size="sm" onClick={onPublish} disabled={pending || !!problem || (!unpublished && status === "published") || questionCount === 0}>
          <Rocket aria-hidden="true" />
          {status === "published" && !unpublished ? "Live" : "Publish"}
        </Button>
        {status === "published" && (
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Close form
          </Button>
        )}
      </div>

      {problem && (dirty || questionCount > 0) && (
        <p role="alert" className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {problem}
        </p>
      )}
      <FormMessage error={message.error} success={message.ok ? message.message : undefined} />

      <Card>
        <CardHeader title="Form" description="Title and introduction at the top of the form." />
        <CardBody className="space-y-4">
          <Field label="Title" htmlFor="form-title" required>
            <Input id="form-title" value={meta.title} maxLength={200} onChange={(e) => changeMeta({ title: e.target.value })} />
          </Field>
          <Field
            label="Introduction"
            htmlFor="form-intro"
            hint={
              <>
                Links and simple formatting: <code>[text](https://…)</code>, <code>**bold**</code>, <code>*italic*</code>. An empty
                line starts a new paragraph.
              </>
            }
          >
            <Textarea id="form-intro" rows={4} value={meta.intro} maxLength={5000} onChange={(e) => changeMeta({ intro: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Kind of role" htmlFor="form-role" hint="Fulltime asks CTC per year, freelance an hourly rate.">
              <Select id="form-role" value={meta.roleType} onChange={(e) => changeMeta({ roleType: e.target.value as RoleType })}>
                <option value="fulltime">Fulltime</option>
                <option value="freelance">Freelance</option>
              </Select>
            </Field>
            <Field label="Reminders after the deadline" htmlFor="form-max" hint="0 sends none.">
              <Select id="form-max" value={meta.maxReminders} onChange={(e) => changeMeta({ maxReminders: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "None" : n === 1 ? "Once" : `${n} times`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Days between reminders" htmlFor="form-interval">
              <Input
                id="form-interval"
                type="number"
                min={1}
                max={60}
                value={meta.reminderIntervalDays}
                onChange={(e) => changeMeta({ reminderIntervalDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onBlocksDragEnd}>
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-3">
            {blocks.map((block, blockIndex) => (
              <SortableItem key={block.id} id={block.id}>
                {(handle) => (
                  <section className="rounded-2xl border border-border bg-card shadow-xs" aria-label={`Group ${block.title}`}>
                    <div className="flex items-start gap-2 border-b border-border px-3 py-3 sm:px-4">
                      {handle(`Move group ${block.title || blockIndex + 1}`)}
                      <div className="min-w-0 flex-1 space-y-2">
                        <Input
                          aria-label="Group title"
                          value={block.title}
                          placeholder="Group title"
                          maxLength={200}
                          className="font-display font-semibold"
                          onChange={(e) => updateBlock(block.id, { title: e.target.value })}
                        />
                        <Textarea
                          aria-label="Group explanation"
                          rows={2}
                          value={block.description ?? ""}
                          placeholder="Explanation (optional)"
                          maxLength={2000}
                          onChange={(e) => updateBlock(block.id, { description: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <IconButton label="Move group up" onClick={() => moveBlock(blockIndex, -1)} disabled={blockIndex === 0}>
                          <ArrowUp />
                        </IconButton>
                        <IconButton label="Move group down" onClick={() => moveBlock(blockIndex, 1)} disabled={blockIndex === blocks.length - 1}>
                          <ArrowDown />
                        </IconButton>
                        <IconButton label="Delete group" onClick={() => removeBlock(block.id)}>
                          <Trash2 />
                        </IconButton>
                      </div>
                    </div>

                    <div className="px-3 py-2 sm:px-4">
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onQuestionsDragEnd(block.id, e)}>
                        <SortableContext items={block.questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                          <InsertButton onClick={() => insertQuestion(block.id, 0)} always={block.questions.length === 0} />
                          <ol>
                            {block.questions.map((q, index) => (
                              <SortableItem key={q.id} id={q.id}>
                                {(handle) => (
                                  <>
                                    <QuestionRow
                                      question={q}
                                      open={openId === q.id}
                                      handle={handle(`Move question ${q.label}`)}
                                      blocks={blocks}
                                      blockId={block.id}
                                      first={index === 0}
                                      last={index === block.questions.length - 1}
                                      onToggle={() => setOpenId(openId === q.id ? null : q.id)}
                                      onChange={(patch) => updateQuestion(q.id, patch)}
                                      onRemove={() => removeQuestion(q.id)}
                                      onDuplicate={() => duplicateQuestion(block.id, q)}
                                      onMove={(delta) => moveQuestion(block.id, index, delta)}
                                      onMoveToBlock={(target) => moveQuestionToBlock(q.id, target)}
                                    />
                                    <InsertButton onClick={() => insertQuestion(block.id, index + 1)} />
                                  </>
                                )}
                              </SortableItem>
                            ))}
                          </ol>
                        </SortableContext>
                      </DndContext>
                    </div>
                  </section>
                )}
              </SortableItem>
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <Button variant="secondary" onClick={() => addBlock(blocks.length)} className="w-full border-dashed">
        <Plus aria-hidden="true" />
        Add group
      </Button>
    </div>
  );
}

/** Keep a question consistent after a type change: no stale choices or mapping. */
function cleanQuestion(q: Question): Question {
  const next = { ...q };
  if (!CHOICE_TYPES.includes(next.type)) delete next.options;
  else if (!next.options || next.options.length === 0) next.options = ["Option 1", "Option 2"];
  if (next.mapsTo && !mappingsForType[next.type].includes(next.mapsTo)) delete next.mapsTo;
  if (next.type !== "yes_no") delete next.expected;
  if (!next.help) delete next.help;
  return next;
}

function SortableItem({ id, children }: { id: string; children: (handle: (label: string) => ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`list-none ${isDragging ? "relative z-10 opacity-70" : ""}`}
    >
      {children((label) => (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={label}
          className="mt-1.5 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500 active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      ))}
    </li>
  );
}

function InsertButton({ onClick, always }: { onClick: () => void; always?: boolean }) {
  return (
    <div className={`group flex items-center gap-2 py-1 ${always ? "" : "opacity-60 hover:opacity-100 focus-within:opacity-100"}`}>
      <span className="h-px flex-1 bg-border group-hover:bg-brand-200" aria-hidden="true" />
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2.5 py-0.5 text-xs font-medium text-brand-700 hover:border-brand-200 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500 pointer-coarse:min-h-8"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {always ? "Add question" : <span className="sr-only">Insert question here</span>}
      </button>
      <span className="h-px flex-1 bg-border group-hover:bg-brand-200" aria-hidden="true" />
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-30 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

function QuestionRow({
  question: q,
  open,
  handle,
  blocks,
  blockId,
  first,
  last,
  onToggle,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
  onMoveToBlock,
}: {
  question: Question;
  open: boolean;
  handle: ReactNode;
  blocks: Block[];
  blockId: string;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Question>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (delta: number) => void;
  onMoveToBlock: (blockId: string) => void;
}) {
  const id = `q-${q.id}`;
  const mappings = mappingsForType[q.type];
  return (
    <div className={`rounded-xl border ${open ? "border-brand-200 bg-brand-50/40" : "border-transparent hover:border-border"}`}>
      <div className="flex items-start gap-1">
        {handle}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${id}-editor`}
          className="flex min-w-0 flex-1 flex-col items-start gap-1 rounded-lg px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <span className="text-sm font-medium break-words text-ink">
            {q.label}
            {q.required && <span className="ml-0.5 text-danger">*</span>}
          </span>
          <span className="flex flex-wrap gap-1">
            <Badge tone="brand">{questionTypeLabels[q.type]}</Badge>
            {q.width === "half" && <Badge>Half width</Badge>}
            {q.mapsTo && <Badge tone="accent">Saves to {mappingLabels[q.mapsTo]}</Badge>}
            {q.expected && <Badge tone="warning">Check: {q.expected}</Badge>}
          </span>
        </button>
        <IconButton label="Move up" onClick={() => onMove(-1)} disabled={first}>
          <ArrowUp />
        </IconButton>
        <IconButton label="Move down" onClick={() => onMove(1)} disabled={last}>
          <ArrowDown />
        </IconButton>
      </div>

      {open && (
        <div id={`${id}-editor`} className="space-y-4 px-3 pt-1 pb-4 sm:px-10">
          <Field label="Question" htmlFor={`${id}-label`} required>
            <Input id={`${id}-label`} value={q.label} maxLength={300} onChange={(e) => onChange({ label: e.target.value })} autoFocus />
          </Field>
          <Field label="Help text or instruction" htmlFor={`${id}-help`} hint="Shown under the question. Links work like in the introduction.">
            <Textarea id={`${id}-help`} rows={2} value={q.help ?? ""} maxLength={1000} onChange={(e) => onChange({ help: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Type" htmlFor={`${id}-type`}>
              <Select id={`${id}-type`} value={q.type} onChange={(e) => onChange({ type: e.target.value as QuestionType })}>
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {questionTypeLabels[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Width" htmlFor={`${id}-width`} hint="Two half width questions sit side by side.">
              <Select id={`${id}-width`} value={q.width} onChange={(e) => onChange({ width: e.target.value as "full" | "half" })}>
                <option value="full">Full width</option>
                <option value="half">Half width</option>
              </Select>
            </Field>
            <Field
              label="Saves to candidate"
              htmlFor={`${id}-maps`}
              hint={
                q.type === "current_ctc" || q.type === "expected_ctc" || q.type === "hourly_rate"
                  ? "Always saved as asked compensation."
                  : mappings.length === 0
                    ? "Only kept as an answer."
                    : "Fills this field on the candidate."
              }
            >
              <Select
                id={`${id}-maps`}
                value={q.mapsTo ?? ""}
                disabled={mappings.length === 0}
                onChange={(e) => onChange({ mapsTo: (e.target.value || undefined) as Question["mapsTo"] })}
              >
                <option value="">Answer only</option>
                {mappings.map((m) => (
                  <option key={m} value={m}>
                    {mappingLabels[m]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {CHOICE_TYPES.includes(q.type) && (
            <Field label="Choices" htmlFor={`${id}-options`} hint="One per line.">
              <Textarea
                id={`${id}-options`}
                rows={Math.min(10, Math.max(3, (q.options?.length ?? 0) + 1))}
                value={(q.options ?? []).join("\n")}
                onChange={(e) =>
                  onChange({
                    options: e.target.value
                      .split("\n")
                      .map((o) => o.replace(/^\s+/, ""))
                      .filter((o, i, all) => o.trim() !== "" || i === all.length - 1)
                      .slice(0, 50),
                  })
                }
                onBlur={() => onChange({ options: (q.options ?? []).map((o) => o.trim()).filter(Boolean) })}
              />
            </Field>
          )}

          {q.type === "yes_no" && (
            <Field
              label="Check question"
              htmlFor={`${id}-expected`}
              hint="For example a budget check. Other answers are highlighted in the responses."
            >
              <Select
                id={`${id}-expected`}
                value={q.expected ?? ""}
                onChange={(e) => onChange({ expected: (e.target.value || undefined) as Question["expected"] })}
              >
                <option value="">No expected answer</option>
                <option value="yes">Expect yes</option>
                <option value="no">Expect no</option>
              </Select>
            </Field>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-ink pointer-coarse:min-h-10">
              <input type="checkbox" checked={q.required} onChange={(e) => onChange({ required: e.target.checked })} className="size-4 accent-brand-700" />
              Required
            </label>
            {blocks.length > 1 && (
              <label className="inline-flex items-center gap-2 text-sm text-muted">
                Move to
                <Select
                  aria-label="Move to group"
                  value={blockId}
                  onChange={(e) => onMoveToBlock(e.target.value)}
                  className="w-48 py-1.5!"
                >
                  {blocks.map((b, i) => (
                    <option key={b.id} value={b.id}>
                      {b.title || `Group ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={onDuplicate}>
              <Copy aria-hidden="true" />
              Duplicate
            </Button>
            <Button variant="ghost" size="sm" onClick={onRemove}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
            <Button variant="secondary" size="sm" onClick={onToggle}>
              <X aria-hidden="true" />
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
