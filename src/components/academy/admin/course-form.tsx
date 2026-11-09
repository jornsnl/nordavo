"use client";

import { useActionState } from "react";
import { createCourse, updateCourse } from "@/app/dashboard/academy/actions";
import { initialActionState } from "@/lib/action-state";
import type { AcademyCourseRow } from "@/lib/academy/database";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/** New course, or the settings of an existing one. */
export function CourseForm({ course }: { course?: AcademyCourseRow }) {
  const [state, action] = useActionState(course ? updateCourse : createCourse, initialActionState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      {course && <input type="hidden" name="id" value={course.id} />}
      <FormMessage error={state.error} success={state.message} />
      <Field label="Title" htmlFor="course-title" error={e.title} required>
        <Input id="course-title" name="title" defaultValue={course?.title} maxLength={200} required aria-invalid={Boolean(e.title)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Language" htmlFor="course-language" error={e.language}>
          <Select id="course-language" name="language" defaultValue={course?.language ?? "nl"}>
            <option value="nl">Dutch (clients)</option>
            <option value="en">English (developers and candidates)</option>
          </Select>
        </Field>
        <Field label="For" htmlFor="course-audience" error={e.audience}>
          <Select id="course-audience" name="audience" defaultValue={course?.audience ?? "client"}>
            <option value="client">Clients</option>
            <option value="developer">Developers and candidates</option>
          </Select>
        </Field>
      </div>
      <Field label="Description" htmlFor="course-description" error={e.description}>
        <Textarea id="course-description" name="description" defaultValue={course?.description ?? ""} rows={3} maxLength={5000} />
      </Field>
      <SubmitButton pendingLabel="Saving…">{course ? "Save" : "Create course"}</SubmitButton>
    </form>
  );
}
