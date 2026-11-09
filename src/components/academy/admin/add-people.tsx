"use client";

import { useActionState, useState } from "react";
import { addPeopleBulk, addPerson } from "@/app/dashboard/academy/people/actions";
import { initialActionState } from "@/lib/action-state";
import type { CourseOption } from "@/lib/academy/admin";
import type { AcademyRole } from "@/lib/academy/database";
import { ACADEMY_ROLES, BULK_LIMIT, isClientRole } from "@/lib/academy/people";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type Options = {
  courses: CourseOption[];
  clients: { id: string; name: string }[];
  candidates: { id: string; full_name: string; email: string | null; top_candidate: boolean }[];
  canCreateAccounts: boolean;
};

/** Role, client or candidate, course, open modules, start date and mail: shared by one and bulk. */
function EnrolmentFields({ options, errors, bulk }: { options: Options; errors: Record<string, string>; bulk?: boolean }) {
  const [role, setRole] = useState<AcademyRole>("candidate");
  const fitting = options.courses.filter((c) => (isClientRole(role) ? c.audience === "client" : c.audience === "developer"));
  const [courseId, setCourseId] = useState<string>(fitting[0]?.id ?? "");
  const [scope, setScope] = useState<"all" | "default">("default");
  const course = options.courses.find((c) => c.id === courseId);
  const roleInfo = ACADEMY_ROLES.find((r) => r.value === role);
  const p = bulk ? "bulk-" : "one-";

  function changeRole(next: AcademyRole) {
    setRole(next);
    const nextCourses = options.courses.filter((c) => (isClientRole(next) ? c.audience === "client" : c.audience === "developer"));
    setCourseId(next === "client_reader" ? "" : (nextCourses[0]?.id ?? ""));
    setScope(next === "candidate" ? "default" : "all");
  }

  return (
    <>
      <Field label="Role" htmlFor={`${p}role`} hint={roleInfo?.description} error={errors.academy_role}>
        <Select id={`${p}role`} name="academy_role" value={role} onChange={(e) => changeRole(e.target.value as AcademyRole)}>
          {ACADEMY_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      {isClientRole(role) ? (
        <Field label="Client" htmlFor={`${p}client`} error={errors.client_id} required>
          <Select id={`${p}client`} name="client_id" defaultValue="">
            <option value="" disabled>
              Choose a client…
            </option>
            {options.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        !bulk && (
          <Field label="Candidate in the ATS (optional)" htmlFor={`${p}candidate`} hint="Links progress and scores to the candidate card.">
            <Select id={`${p}candidate`} name="candidate_id" defaultValue="">
              <option value="">Not linked</option>
              {options.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                  {c.email ? ` (${c.email})` : ""}
                  {c.top_candidate ? " ★" : ""}
                </option>
              ))}
            </Select>
          </Field>
        )
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Course" htmlFor={`${p}course`} error={errors.course_id}>
          <Select id={`${p}course`} name="course_id" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">No course yet</option>
            {options.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.status === "draft" ? " (draft)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Open" htmlFor={`${p}scope`}>
          <Select id={`${p}scope`} name="scope" value={scope} onChange={(e) => setScope(e.target.value as "all" | "default")} disabled={!courseId}>
            <option value="all">All modules</option>
            <option value="default">Default modules</option>
          </Select>
        </Field>
      </div>
      {course && scope === "default" && course.modules.length > 0 && (
        <fieldset className="space-y-2 rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-medium">Also open (on top of the default modules)</legend>
          {course.modules.map((m) => (
            <label key={m.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="open_module_ids"
                value={m.id}
                disabled={m.in_default_access}
                defaultChecked={m.in_default_access}
                className="mt-0.5 size-4 accent-brand-700"
              />
              <span>
                {m.title}
                {m.in_default_access && <span className="text-xs text-muted"> (open by default)</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start date" htmlFor={`${p}start`} hint="Module release and task deadlines count from here." error={errors.start_date}>
          <Input id={`${p}start`} name="start_date" type="date" />
        </Field>
        <Field label="Language" htmlFor={`${p}locale`} hint="Clients Dutch, developers and candidates English.">
          <Select id={`${p}locale`} name="locale" defaultValue="">
            <option value="">By role</option>
            <option value="nl">Dutch</option>
            <option value="en">English</option>
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="send_mail" value="on" defaultChecked className="size-4 accent-brand-700" />
        Send the invitation mail with a sign-in link
      </label>
      {!options.canCreateAccounts && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          SUPABASE_SECRET_KEY is not set: only people who already have an account can be added.
        </p>
      )}
    </>
  );
}

export function AddPersonForm({ options }: { options: Options }) {
  const [state, action] = useActionState(addPerson, initialActionState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <FormMessage error={state.error} success={state.message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="one-name" error={e.full_name} required>
          <Input id="one-name" name="full_name" maxLength={120} required autoComplete="off" />
        </Field>
        <Field label="Email" htmlFor="one-email" error={e.email} required>
          <Input id="one-email" name="email" type="email" maxLength={320} required autoComplete="off" />
        </Field>
      </div>
      <EnrolmentFields options={options} errors={e} />
      <SubmitButton pendingLabel="Adding…">Add person</SubmitButton>
    </form>
  );
}

export function AddPeopleBulkForm({ options }: { options: Options }) {
  const [state, action] = useActionState(addPeopleBulk, initialActionState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <FormMessage error={state.error} success={state.message} />
      <Field
        label="People"
        htmlFor="bulk-list"
        hint={`One per line: "Name, email" (and optionally a start date YYYY-MM-DD). At most ${BULK_LIMIT}.`}
      >
        <Textarea id="bulk-list" name="list" rows={6} placeholder={"Asha Rao, asha@example.in\nRavi Kumar; ravi@example.in; 2026-12-01"} />
      </Field>
      <Field label="Or a CSV file" htmlFor="bulk-file" hint="With a header row: name, email, start_date.">
        <Input id="bulk-file" name="file" type="file" accept=".csv,text/csv,text/plain" />
      </Field>
      <EnrolmentFields options={options} errors={e} bulk />
      <SubmitButton pendingLabel="Adding…">Add everyone</SubmitButton>
    </form>
  );
}
