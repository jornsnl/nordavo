"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { grantCourseAccess, revokeCourseAccess, setAccessScope, setOpenModules } from "@/app/dashboard/academy/actions";
import { resendInvite, setGroupMembership, updatePerson } from "@/app/dashboard/academy/people/actions";
import { initialActionState } from "@/lib/action-state";
import type { PersonDetail } from "@/lib/academy/admin";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { useAction } from "./use-action";

export function PersonSettingsForm({ detail }: { detail: PersonDetail }) {
  const { person } = detail;
  const [state, action] = useActionState(updatePerson, initialActionState);
  const invite = useAction();
  const e = state.fieldErrors ?? {};
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <input type="hidden" name="profile_id" value={person.profile_id} />
        <FormMessage error={state.error} success={state.message} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Language" htmlFor="p-locale" error={e.locale}>
            <Select id="p-locale" name="locale" defaultValue={person.locale}>
              <option value="nl">Dutch</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label="Start date" htmlFor="p-start" error={e.start_date}>
            <Input id="p-start" name="start_date" type="date" defaultValue={person.start_date ?? ""} />
          </Field>
          <Field label="Mail summary" htmlFor="p-digest">
            <Select id="p-digest" name="digest_frequency" defaultValue={person.digest_frequency}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="off">Off</option>
            </Select>
          </Field>
        </div>
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </form>
      <div className="border-t border-border pt-4">
        <FormMessage error={invite.result.error} success={invite.result.message} />
        <Button size="sm" variant="secondary" disabled={invite.pending} onClick={() => invite.run(() => resendInvite(person.profile_id))}>
          <Mail aria-hidden="true" />
          Send a new sign-in link
        </Button>
      </div>
    </div>
  );
}

/** Per course: scope, and the modules open for this person on top of the defaults (force: open right away). */
export function PersonAccess({ detail }: { detail: PersonDetail }) {
  const { person, access, openModules, courses } = detail;
  const action = useAction();
  const [grantState, grant] = useActionState(grantCourseAccess, initialActionState);
  const withAccess = courses.filter((c) => access.some((a) => a.course_id === c.id));
  const without = courses.filter((c) => !access.some((a) => a.course_id === c.id));
  return (
    <div className="space-y-6">
      <FormMessage error={action.result.error} />
      {withAccess.length === 0 && <p className="text-sm text-muted">No course yet (access through a group shows on the course).</p>}
      {withAccess.map((course) => {
        const row = access.find((a) => a.course_id === course.id)!;
        return (
          <div key={course.id} className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-brand-900">{course.title}</p>
              <div className="flex items-center gap-2">
                <Select
                  aria-label={`What is open in ${course.title}`}
                  value={row.scope}
                  onChange={(e) => action.run(() => setAccessScope(row.id, e.target.value as "all" | "default"))}
                  className="w-44 py-1.5 text-xs"
                >
                  <option value="all">All modules</option>
                  <option value="default">Default modules</option>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => action.run(() => revokeCourseAccess(row.id), { confirm: `Remove access to ${course.title}? Progress stays.` })}
                >
                  Remove
                </Button>
              </div>
            </div>
            <OpenModulesForm profileId={person.profile_id} course={course} openModules={openModules} scopeAll={row.scope === "all"} />
          </div>
        );
      })}
      {without.length > 0 && (
        <form action={grant} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="target" value={`person:${person.profile_id}`} />
          <FormMessage error={grantState.error} success={grantState.message} />
          <Field label="Add a course" htmlFor="p-course" className="min-w-48 flex-1">
            <Select id="p-course" name="course_id" defaultValue={without[0].id}>
              {without.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Open" htmlFor="p-scope">
            <Select id="p-scope" name="scope" defaultValue={person.academy_role === "candidate" ? "default" : "all"}>
              <option value="all">All modules</option>
              <option value="default">Default modules</option>
            </Select>
          </Field>
          <SubmitButton size="sm" pendingLabel="Saving…">
            Give access
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

function OpenModulesForm({
  profileId,
  course,
  openModules,
  scopeAll,
}: {
  profileId: string;
  course: PersonDetail["courses"][number];
  openModules: PersonDetail["openModules"];
  scopeAll: boolean;
}) {
  const [state, action] = useActionState(setOpenModules, initialActionState);
  const rows = new Map(openModules.map((o) => [o.module_id, o]));
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="profile_id" value={profileId} />
      <input type="hidden" name="course_id" value={course.id} />
      <FormMessage error={state.error} success={state.message} />
      <p className="text-xs text-muted">
        {scopeAll
          ? "All modules are in scope; tick Open now to skip order, requirements and release for this person."
          : "Default modules are open; tick more for this person (for example a top candidate)."}
      </p>
      <ul className="space-y-1.5">
        {course.modules.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <input type="checkbox" name="open" value={m.id} defaultChecked={rows.has(m.id)} className="size-4 accent-brand-700" />
              <span className="truncate">
                {m.title}
                {m.in_default_access && <span className="text-xs text-muted"> (default)</span>}
                {m.status === "draft" && <span className="text-xs text-muted"> (draft)</span>}
              </span>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" name="force" value={m.id} defaultChecked={rows.get(m.id)?.force ?? false} className="size-3.5 accent-brand-700" />
              Open now
            </label>
          </li>
        ))}
      </ul>
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
        Save open modules
      </SubmitButton>
    </form>
  );
}

export function PersonGroups({ detail }: { detail: PersonDetail }) {
  const action = useAction();
  if (detail.groups.length === 0) return <p className="text-sm text-muted">No groups yet. Make one under Groups.</p>;
  return (
    <div className="space-y-2">
      <FormMessage error={action.result.error} />
      {detail.groups.map((g) => (
        <label key={g.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            defaultChecked={detail.person.groupIds.includes(g.id)}
            disabled={action.pending}
            onChange={(e) => {
              const checked = e.target.checked;
              action.run(() => setGroupMembership(g.id, detail.person.profile_id, checked));
            }}
            className="size-4 accent-brand-700"
          />
          {g.name}
        </label>
      ))}
    </div>
  );
}
