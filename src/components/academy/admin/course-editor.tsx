"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import {
  createModule,
  deleteCourse,
  grantCourseAccess,
  reorderModules,
  revokeCourseAccess,
  setAccessScope,
  setCourseStatus,
} from "@/app/dashboard/academy/actions";
import { initialActionState } from "@/lib/action-state";
import type { CourseEditor } from "@/lib/academy/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { CourseForm } from "./course-form";
import { type LibraryOption, ModuleCard } from "./module-card";
import { SortableList } from "./sortable-list";
import { useAction } from "./use-action";

export type PersonOption = { id: string; label: string };

export function CourseEditorView({
  editor,
  library,
  people,
}: {
  editor: CourseEditor;
  library: LibraryOption[];
  people: PersonOption[];
}) {
  const { course } = editor;
  const action = useAction();
  const [moduleTitle, setModuleTitle] = useState("");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={course.status === "published" ? "success" : "neutral"}>{course.status === "published" ? "Published" : "Draft"}</Badge>
        <Button
          size="sm"
          variant={course.status === "published" ? "secondary" : "primary"}
          disabled={action.pending}
          onClick={() => action.run(() => setCourseStatus(course.id, course.status === "published" ? "draft" : "published"))}
        >
          {course.status === "published" ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {course.status === "published" ? "Back to draft" : "Publish course"}
        </Button>
        <Link href={`/academy/courses/${course.id}`} className="text-sm font-medium text-brand-700 hover:underline">
          Preview in the Academy
        </Link>
        {course.status === "draft" && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={action.pending}
            onClick={() => action.run(() => deleteCourse(course.id), { confirm: `Delete "${course.title}" with its modules? Lessons stay in the library.` })}
          >
            <Trash2 aria-hidden="true" />
            Delete course
          </Button>
        )}
      </div>
      <FormMessage error={action.result.error} success={action.result.message} />

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="space-y-4 xl:col-span-2" aria-labelledby="modules-heading">
          <h2 id="modules-heading" className="font-display text-lg font-semibold text-brand-900">
            Modules
          </h2>
          {editor.modules.length === 0 ? (
            <p className="text-sm text-muted">No modules yet.</p>
          ) : (
            <SortableList
              label="Modules"
              items={editor.modules}
              onReorder={(ids) => reorderModules(course.id, ids)}
              renderItem={(mod, handle) => (
                <ModuleCard
                  mod={mod}
                  index={editor.modules.findIndex((m) => m.id === mod.id)}
                  handle={handle}
                  courseLanguage={course.language}
                  allModules={editor.allModules}
                  library={library}
                />
              )}
            />
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const title = moduleTitle;
              action.run(async () => {
                const result = await createModule(course.id, title);
                if (result.ok) setModuleTitle("");
                return result;
              });
            }}
          >
            <Input value={moduleTitle} onChange={(e) => setModuleTitle(e.target.value)} placeholder="New module title" aria-label="New module title" maxLength={200} />
            <Button type="submit" disabled={!moduleTitle.trim() || action.pending}>
              <Plus aria-hidden="true" />
              Add module
            </Button>
          </form>
        </section>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Course settings" />
            <CardBody>
              <CourseForm course={course} />
            </CardBody>
          </Card>
          <AccessPanel editor={editor} people={people} />
        </div>
      </div>
    </div>
  );
}

function AccessPanel({ editor, people }: { editor: CourseEditor; people: PersonOption[] }) {
  const [state, formAction] = useActionState(grantCourseAccess, initialActionState);
  const action = useAction();
  const taken = new Set(editor.access.map((a) => (a.profile_id ? `person:${a.profile_id}` : `group:${a.group_id}`)));
  return (
    <Card>
      <CardHeader
        title="Access"
        description="All modules, or only the modules open by default plus what is open per person (People)."
      />
      <CardBody className="space-y-4">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="course_id" value={editor.course.id} />
          <FormMessage error={state.error} success={state.message} />
          <Field label="Person or group" htmlFor="access-target" error={state.fieldErrors?.target}>
            <Select id="access-target" name="target" defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {editor.groups.length > 0 && (
                <optgroup label="Groups">
                  {editor.groups
                    .filter((g) => !taken.has(`group:${g.id}`))
                    .map((g) => (
                      <option key={g.id} value={`group:${g.id}`}>
                        {g.name}
                      </option>
                    ))}
                </optgroup>
              )}
              <optgroup label="People">
                {people
                  .filter((p) => !taken.has(`person:${p.id}`))
                  .map((p) => (
                    <option key={p.id} value={`person:${p.id}`}>
                      {p.label}
                    </option>
                  ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="Open" htmlFor="access-scope">
            <Select id="access-scope" name="scope" defaultValue="all">
              <option value="all">All modules</option>
              <option value="default">Default modules (and per person)</option>
            </Select>
          </Field>
          <SubmitButton size="sm" pendingLabel="Saving…">
            Give access
          </SubmitButton>
        </form>

        <FormMessage error={action.result.error} />
        {editor.access.length === 0 ? (
          <p className="text-sm text-muted">Nobody has access yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {editor.access.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  {a.profile_id ? (
                    <Link href={`/dashboard/academy/people/${a.profile_id}`} className="block truncate text-sm font-medium text-brand-800 hover:underline">
                      {a.label}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-medium text-ink">{a.label}</span>
                  )}
                </span>
                <Select
                  aria-label={`What is open for ${a.label}`}
                  value={a.scope}
                  onChange={(e) => action.run(() => setAccessScope(a.id, e.target.value as "all" | "default"))}
                  className="w-32 py-1.5 text-xs"
                >
                  <option value="all">All</option>
                  <option value="default">Default</option>
                </Select>
                <button
                  type="button"
                  aria-label={`Remove access of ${a.label}`}
                  title="Remove access (progress stays)"
                  onClick={() => action.run(() => revokeCourseAccess(a.id), { confirm: `Remove the access of ${a.label}? Their progress stays.` })}
                  className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-danger"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
