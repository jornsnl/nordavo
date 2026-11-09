"use client";

import { useActionState } from "react";
import { GraduationCap, RefreshCw, Star } from "lucide-react";
import { enrolCandidates, processCandidateAcademy, setTopCandidates } from "@/app/dashboard/candidates/academy-actions";
import { setOpenModules } from "@/app/dashboard/academy/actions";
import { initialActionState } from "@/lib/action-state";
import { useAction } from "@/components/academy/admin/use-action";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export type ModuleOption = { id: string; title: string; position: number; in_default_access: boolean };

/** Not in the Academy yet: the developer course with the default modules, plus extra modules and a group. */
export function EnrolCandidateForm({
  candidateId,
  modules,
  groups,
  hasEmail,
}: {
  candidateId: string;
  modules: ModuleOption[];
  groups: { id: string; name: string }[];
  hasEmail: boolean;
}) {
  const [state, action] = useActionState(enrolCandidates, initialActionState);
  const extra = modules.filter((m) => !m.in_default_access);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="candidate_ids" value={candidateId} />
      <FormMessage error={state.error} success={state.message} />
      {!hasEmail && <p className="text-sm text-danger">Add an e-mail address to the candidate first: the invitation goes there.</p>}
      {extra.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-ink">Extra modules open (on top of the default modules)</legend>
          {extra.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="open_module_ids" value={m.id} className="size-4 accent-brand-700" />
              {m.title}
            </label>
          ))}
        </fieldset>
      )}
      {groups.length > 0 && (
        <Field label="Group" htmlFor={`enrol-group-${candidateId}`}>
          <Select id={`enrol-group-${candidateId}`} name="group_id" defaultValue="">
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="send_mail" defaultChecked className="size-4 accent-brand-700" />
        Send the invitation mail
      </label>
      <SubmitButton size="sm" pendingLabel="Adding…" disabled={!hasEmail}>
        <GraduationCap aria-hidden="true" />
        Add to the developer course
      </SubmitButton>
    </form>
  );
}

/** Top candidate on or off; the configured extra modules follow. */
export function TopCandidateToggle({ candidateId, on }: { candidateId: string; on: boolean }) {
  const [state, action] = useActionState(setTopCandidates, initialActionState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="candidate_ids" value={candidateId} />
      <input type="hidden" name="top" value={on ? "false" : "true"} />
      <FormMessage error={state.error} success={state.message} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
        <Star aria-hidden="true" className={on ? "fill-amber-400 text-amber-500" : ""} />
        {on ? "Top candidate: on" : "Mark as top candidate"}
      </SubmitButton>
    </form>
  );
}

/** Per person which modules of the developer course are open (on top of the scope). */
export function CandidateOpenModules({
  profileId,
  courseId,
  modules,
}: {
  profileId: string;
  courseId: string;
  modules: { module_id: string; title: string; in_default_access: boolean; open_row: boolean; force: boolean }[];
}) {
  const [state, action] = useActionState(setOpenModules, initialActionState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="profile_id" value={profileId} />
      <input type="hidden" name="course_id" value={courseId} />
      <FormMessage error={state.error} success={state.message} />
      <ul className="space-y-1.5">
        {modules.map((m) => (
          <li key={m.module_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <input
                type="checkbox"
                name="open"
                value={m.module_id}
                defaultChecked={m.in_default_access || m.open_row}
                disabled={m.in_default_access}
                className="size-4 accent-brand-700"
              />
              <span className="truncate">{m.title}</span>
              {m.in_default_access && <span className="text-xs text-muted">(default)</span>}
            </label>
            {!m.in_default_access && (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" name="force" value={m.module_id} defaultChecked={m.force} className="size-3.5 accent-accent-500" />
                Open now
              </label>
            )}
          </li>
        ))}
      </ul>
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
        Save open modules
      </SubmitButton>
    </form>
  );
}

export function RetryAcademyButton({ candidateId }: { candidateId: string }) {
  const { pending, result, run } = useAction();
  return (
    <div className="space-y-2">
      <FormMessage error={result.error} success={result.message} />
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => processCandidateAcademy(candidateId))}>
        <RefreshCw aria-hidden="true" className={pending ? "animate-spin" : ""} />
        Finish what is waiting
      </Button>
    </div>
  );
}
