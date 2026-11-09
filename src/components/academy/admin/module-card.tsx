"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ChevronDown, Copy, Eye, EyeOff, Link2, Plus, Trash2, Unlink } from "lucide-react";
import {
  createLesson,
  deleteModule,
  duplicateLesson,
  duplicateModule,
  linkLesson,
  reorderLessons,
  setModuleStatus,
  unlinkLesson,
  updateModule,
} from "@/app/dashboard/academy/actions";
import { initialActionState } from "@/lib/action-state";
import type { EditorModule } from "@/lib/academy/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { type DragHandle, SortableList } from "./sortable-list";
import { useAction } from "./use-action";

export type LibraryOption = { id: string; title: string; language: "nl" | "en"; status: "draft" | "published" };

function releaseSummary(mod: EditorModule, moduleTitles: Map<string, string>) {
  const parts: string[] = [];
  if (mod.requires_previous) parts.push("after the previous module");
  if (mod.requiredModuleIds.length) parts.push(`after ${mod.requiredModuleIds.map((id) => moduleTitles.get(id) ?? "a module").join(", ")}`);
  if (mod.release_offset_days !== null) parts.push(`${mod.release_offset_days} days after the start date`);
  return parts.length ? `Opens ${parts.join(", ")}` : "Open right away";
}

export function ModuleCard({
  mod,
  index,
  handle,
  courseLanguage,
  allModules,
  library,
}: {
  mod: EditorModule;
  index: number;
  handle: DragHandle;
  courseLanguage: "nl" | "en";
  allModules: { id: string; title: string; courseTitle: string }[];
  library: LibraryOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(updateModule, initialActionState);
  const action = useAction();
  const [newTitle, setNewTitle] = useState("");
  const [existing, setExisting] = useState("");
  const titles = new Map(allModules.map((m) => [m.id, m.title]));
  const e = state.fieldErrors ?? {};
  const inModule = new Set(mod.lessons.map((l) => l.id));

  return (
    <div className="rounded-2xl border border-border bg-card shadow-xs">
      <div className="flex items-start gap-2 px-3 py-3 sm:px-4">
        {handle}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted">Module {index + 1}</span>
            <span className="font-display font-semibold text-brand-900">{mod.title}</span>
            <Badge tone={mod.status === "published" ? "success" : "neutral"}>{mod.status === "published" ? "Published" : "Draft"}</Badge>
            {mod.is_core && <Badge tone="accent">Core</Badge>}
            {mod.in_default_access && <Badge tone="brand">Open for candidates</Badge>}
            {mod.required_before_start && <Badge tone="warning">Before the start</Badge>}
          </span>
          <span className="mt-1 block text-xs text-muted">
            {mod.lessons.length} {mod.lessons.length === 1 ? "lesson" : "lessons"} · {releaseSummary(mod, titles)}
          </span>
        </button>
        <ChevronDown className={`mt-1 size-5 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </div>

      {open && (
        <div className="space-y-6 border-t border-border px-4 py-4 sm:px-5">
          <FormMessage error={action.result.error} success={action.result.message} link={action.result.link} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={action.pending}
              onClick={() => action.run(() => setModuleStatus(mod.id, mod.status === "published" ? "draft" : "published"))}
            >
              {mod.status === "published" ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              {mod.status === "published" ? "Back to draft" : "Publish"}
            </Button>
            <Button size="sm" variant="secondary" disabled={action.pending} onClick={() => action.run(() => duplicateModule(mod.id))}>
              <Copy aria-hidden="true" />
              Duplicate
            </Button>
            {mod.status === "draft" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={action.pending}
                onClick={() => action.run(() => deleteModule(mod.id), { confirm: `Delete module "${mod.title}"? Its lessons stay in the library.` })}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            )}
          </div>

          <form action={formAction} className="space-y-4">
            <input type="hidden" name="id" value={mod.id} />
            <FormMessage error={state.error} success={state.message} />
            <Field label="Title" htmlFor={`m-title-${mod.id}`} error={e.title} required>
              <Input id={`m-title-${mod.id}`} name="title" defaultValue={mod.title} maxLength={200} required />
            </Field>
            <Field label="Description" htmlFor={`m-desc-${mod.id}`} error={e.description}>
              <Textarea id={`m-desc-${mod.id}`} name="description" defaultValue={mod.description ?? ""} rows={2} maxLength={5000} />
            </Field>
            <fieldset className="space-y-3 rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-medium text-ink">When does it open?</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="requires_previous" defaultChecked={mod.requires_previous} className="mt-0.5 size-4 accent-brand-700" />
                <span>After the previous module is done (modules open in order)</span>
              </label>
              <Field label="Days after the start date" htmlFor={`m-offset-${mod.id}`} error={e.release_offset_days} hint="Empty: no waiting. 30 is from month 2.">
                <Input
                  id={`m-offset-${mod.id}`}
                  name="release_offset_days"
                  type="number"
                  min={0}
                  max={3650}
                  inputMode="numeric"
                  defaultValue={mod.release_offset_days ?? ""}
                  className="sm:w-40"
                />
              </Field>
              {allModules.filter((m) => m.id !== mod.id).length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium text-ink">Requires other modules ({mod.requiredModuleIds.length})</summary>
                  <div className="mt-2 grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {allModules
                      .filter((m) => m.id !== mod.id)
                      .map((m) => (
                        <label key={m.id} className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            name="required_module_ids"
                            value={m.id}
                            defaultChecked={mod.requiredModuleIds.includes(m.id)}
                            className="mt-0.5 size-4 accent-brand-700"
                          />
                          <span>
                            {m.title} <span className="text-xs text-muted">({m.courseTitle})</span>
                          </span>
                        </label>
                      ))}
                  </div>
                </details>
              )}
            </fieldset>
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <label className="flex items-start gap-2">
                <input type="checkbox" name="in_default_access" defaultChecked={mod.in_default_access} className="mt-0.5 size-4 accent-brand-700" />
                <span>Open with default access (candidates)</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="is_core" defaultChecked={mod.is_core} className="mt-0.5 size-4 accent-brand-700" />
                <span>Core module</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="required_before_start" defaultChecked={mod.required_before_start} className="mt-0.5 size-4 accent-brand-700" />
                <span>Done before the developer starts</span>
              </label>
            </div>
            <SubmitButton size="sm" pendingLabel="Saving…">Save module</SubmitButton>
          </form>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Lessons</h3>
            {mod.lessons.length === 0 ? (
              <p className="text-sm text-muted">No lessons yet.</p>
            ) : (
              <SortableList
                label={`Lessons of ${mod.title}`}
                items={mod.lessons}
                className="space-y-2"
                onReorder={(ids) => reorderLessons(mod.id, ids)}
                renderItem={(lesson, lessonHandle) => (
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-2 py-1.5">
                    {lessonHandle}
                    <Link href={`/dashboard/academy/lessons/${lesson.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-brand-800 hover:underline">
                      {lesson.title}
                    </Link>
                    <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                      <Badge tone={lesson.status === "published" ? "success" : "neutral"}>{lesson.status === "published" ? "Published" : "Draft"}</Badge>
                      <Badge tone="neutral">{lesson.language.toUpperCase()}</Badge>
                      {lesson.usedInModules > 1 && <Badge tone="brand">Used in {lesson.usedInModules} modules</Badge>}
                    </span>
                    <button
                      type="button"
                      title="Duplicate"
                      aria-label={`Duplicate ${lesson.title}`}
                      onClick={() => action.run(() => duplicateLesson(lesson.id, mod.id))}
                      className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-900"
                    >
                      <Copy className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      title="Remove from this module"
                      aria-label={`Remove ${lesson.title} from this module`}
                      onClick={() =>
                        action.run(() => unlinkLesson(mod.id, lesson.id), {
                          confirm: `Remove "${lesson.title}" from this module? The lesson and everyone's progress stay.`,
                        })
                      }
                      className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-danger"
                    >
                      <Unlink className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
              />
            )}
            <div className="grid gap-3 lg:grid-cols-2">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const title = newTitle;
                  action.run(() => createLesson(mod.id, title, courseLanguage));
                }}
              >
                <Input value={newTitle} onChange={(ev) => setNewTitle(ev.target.value)} placeholder="New lesson title" aria-label="New lesson title" maxLength={300} />
                <Button type="submit" size="sm" disabled={!newTitle.trim() || action.pending}>
                  <Plus aria-hidden="true" />
                  New
                </Button>
              </form>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (existing) action.run(() => linkLesson(mod.id, existing));
                }}
              >
                <Select value={existing} onChange={(ev) => setExisting(ev.target.value)} aria-label="Reuse a lesson" className="min-w-0 flex-1">
                  <option value="">Reuse a lesson from the library…</option>
                  {library
                    .filter((l) => !inModule.has(l.id))
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title} ({l.language.toUpperCase()}
                        {l.status === "draft" ? ", draft" : ""})
                      </option>
                    ))}
                </Select>
                <Button type="submit" size="sm" variant="secondary" disabled={!existing || action.pending}>
                  <Link2 aria-hidden="true" />
                  Add
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
