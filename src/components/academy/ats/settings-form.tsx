"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { enrolVacancyIntoGroup, retryAtsEvent, saveAtsSettings, saveGroupSettings } from "@/app/dashboard/academy/automation/actions";
import type { AcademyAtsSettingsRow, AcademyGroupSettingsRow } from "@/lib/academy/ats/database";
import { initialActionState } from "@/lib/action-state";
import { useAction } from "@/components/academy/admin/use-action";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type Course = { id: string; title: string; audience: string };
type Module = { id: string; title: string; course_id: string; in_default_access: boolean };

function Check({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-brand-700" />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function AtsSettingsForm({
  settings,
  courses,
  modules,
  developerCourseId,
}: {
  settings: AcademyAtsSettingsRow;
  courses: Course[];
  modules: Module[];
  developerCourseId: string | null;
}) {
  const [state, action] = useActionState(saveAtsSettings, initialActionState);
  const e = state.fieldErrors ?? {};
  const devModules = modules.filter((m) => m.course_id === developerCourseId);
  return (
    <form action={action} className="space-y-6">
      <FormMessage error={state.error} success={state.message} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-semibold text-brand-900">Courses</legend>
        <Field label="Developer course (candidates and developers)" htmlFor="s-dev" hint="Empty: the start curriculum.">
          <Select id="s-dev" name="developer_course_id" defaultValue={settings.developer_course_id ?? ""}>
            <option value="">Start curriculum (developer)</option>
            {courses
              .filter((c) => c.audience === "developer")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Client course" htmlFor="s-client" hint="Empty: the start curriculum.">
          <Select id="s-client" name="client_course_id" defaultValue={settings.client_course_id ?? ""}>
            <option value="">Start curriculum (client)</option>
            {courses
              .filter((c) => c.audience === "client")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </Select>
        </Field>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 font-semibold text-brand-900">Top candidates</legend>
        <p className="text-sm text-muted">Marked in the ATS: these modules open on top of the default modules (in order). Per person adjustable on the candidate.</p>
        {devModules.map((m) => (
          <label key={m.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="top_candidate_module_ids"
              value={m.id}
              defaultChecked={settings.top_candidate_module_ids.includes(m.id)}
              disabled={m.in_default_access}
              className="size-4 accent-brand-700"
            />
            {m.title}
            {m.in_default_access && <span className="text-xs text-muted">(open for every candidate)</span>}
          </label>
        ))}
        <Check name="top_candidate_mail" label="Mail the candidate which modules opened" defaultChecked={settings.top_candidate_mail} />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 font-semibold text-brand-900">Status placed</legend>
        <Check
          name="invite_client_contact"
          label="Invite the client's contact person"
          hint="The primary contact of the client gets an account (client admin unless already in the Academy) and the client course."
          defaultChecked={settings.invite_client_contact}
        />
        <Check name="welcome_mail" label="Send welcome mails to developer and client" defaultChecked={settings.welcome_mail} />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold text-brand-900">Reminders to candidates who get stuck</legend>
        <Check name="reminder_enabled" label="Send reminders (daily job academy-reminders)" defaultChecked={settings.reminder_enabled} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="After days without activity" htmlFor="s-after" error={e.reminder_after_days}>
            <Input id="s-after" name="reminder_after_days" type="number" min={1} max={90} defaultValue={settings.reminder_after_days} />
          </Field>
          <Field label="Again after days" htmlFor="s-repeat" error={e.reminder_repeat_days}>
            <Input id="s-repeat" name="reminder_repeat_days" type="number" min={1} max={90} defaultValue={settings.reminder_repeat_days} />
          </Field>
          <Field label="At most reminders" htmlFor="s-max" error={e.reminder_max} hint="Counted since the last activity.">
            <Input id="s-max" name="reminder_max" type="number" min={0} max={10} defaultValue={settings.reminder_max} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold text-brand-900">Retention of never placed candidates</legend>
        <p className="text-sm text-muted">
          After this many months without activity in the ATS and the Academy, the Academy data of candidates who were never placed and have no
          application in the flow is anonymised or deleted (weekly job academy-retention). The ATS candidate itself is not touched. Off: the job only
          counts and logs (dry run).
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Retention period (months)" htmlFor="s-months" error={e.retention_months}>
            <Input id="s-months" name="retention_months" type="number" min={1} max={120} defaultValue={settings.retention_months} />
          </Field>
          <Field label="Then" htmlFor="s-action">
            <Select id="s-action" name="retention_action" defaultValue={settings.retention_action}>
              <option value="anonymise">Anonymise (keep scores as anonymous numbers)</option>
              <option value="delete">Delete the account and all Academy data</option>
            </Select>
          </Field>
        </div>
        <Check
          name="retention_enabled"
          label="Retention is on (otherwise dry run only)"
          hint="Check the dry run in the log below first."
          defaultChecked={settings.retention_enabled}
        />
      </fieldset>

      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
    </form>
  );
}

export function RetryEventButton({ eventId }: { eventId: string }) {
  const { pending, result, run } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => retryAtsEvent(eventId))}>
        <RefreshCw aria-hidden="true" className={pending ? "animate-spin" : ""} />
        Retry
      </Button>
      {result.error && <span className="text-xs text-danger">{result.error}</span>}
      {result.message && <span className="text-xs text-emerald-700">{result.message}</span>}
    </span>
  );
}

export function GroupSettingsForm({
  groupId,
  vacancyId,
  settings,
  vacancies,
  modules,
}: {
  groupId: string;
  vacancyId: string | null;
  settings: AcademyGroupSettingsRow | null;
  vacancies: { id: string; title: string }[];
  modules: { id: string; title: string; in_default_access: boolean }[];
}) {
  const [state, action] = useActionState(saveGroupSettings, initialActionState);
  const enrol = useAction();
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="group_id" value={groupId} />
        <FormMessage error={state.error} success={state.message} />
        <Field label="Vacancy" htmlFor="g-vacancy" hint="Candidates linked to this vacancy can join the group automatically.">
          <Select id="g-vacancy" name="vacancy_id" defaultValue={vacancyId ?? ""}>
            <option value="">No vacancy</option>
            {vacancies.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title}
              </option>
            ))}
          </Select>
        </Field>
        <Check
          name="auto_enrol"
          label="Automatic access to the developer course"
          hint="Every candidate linked to the vacancy gets an Academy account in this group with the default modules."
          defaultChecked={settings?.auto_enrol ?? false}
        />
        {modules.filter((m) => !m.in_default_access).length > 0 && (
          <fieldset className="space-y-1.5 pl-6">
            <legend className="text-xs font-medium text-muted">Also open</legend>
            {modules
              .filter((m) => !m.in_default_access)
              .map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="open_module_ids" value={m.id} defaultChecked={settings?.open_module_ids.includes(m.id)} className="size-4 accent-brand-700" />
                  {m.title}
                </label>
              ))}
          </fieldset>
        )}
        <Check name="send_mail" label="Send the invitation mail" defaultChecked={settings?.send_mail ?? true} />
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </form>
      {vacancyId && (
        <div className="space-y-2 border-t border-border pt-4">
          <FormMessage error={enrol.result.error} success={enrol.result.message} />
          <Button
            size="sm"
            variant="secondary"
            disabled={enrol.pending}
            onClick={() => enrol.run(() => enrolVacancyIntoGroup(groupId), { confirm: "Add everyone in this vacancy's pipeline to the group and the developer course?" })}
          >
            Add everyone in the vacancy now
          </Button>
        </div>
      )}
    </div>
  );
}
