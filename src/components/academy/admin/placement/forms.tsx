"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RefreshCw, RotateCcw, Trash2, UserMinus } from "lucide-react";
import type {
  AcademyLeaveRequestRow,
  AcademyPlacementRole,
  AcademyRitualRow,
} from "@/lib/academy/database";
import { type ActionState, initialActionState } from "@/lib/action-state";
import {
  addPlacementMember,
  confirmHoliday,
  decideLeave,
  deleteHoliday,
  deletePlacementDocument,
  deleteRitualTemplate,
  handlePulseSignal,
  makeDeveloperAndAdd,
  moveMilestone,
  removePlacementMember,
  removePlacementRitual,
  resetPlacementRitual,
  rotateCalendarLink,
  saveAcademyFacts,
  saveHoliday,
  saveLeaveBalance,
  savePlacementRitual,
  saveReport,
  saveRitualTemplate,
  seedHolidayYear,
  updatePlacementMemberRole,
  uploadPlacementDocument,
} from "@/app/dashboard/academy/placements/actions";
import { useAction } from "@/components/academy/admin/use-action";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

// Nordavo forms of the Academy tab of a placement, the ritual templates and
// the holidays. Server actions in src/app/dashboard/academy/placements/actions.ts.

export const ROLE_LABELS: Record<AcademyPlacementRole, string> = {
  client_admin: "Client admin",
  client_member: "Client member",
  client_reader: "Reader",
  developer: "Developer",
};

function useRefreshing() {
  const router = useRouter();
  const action = useAction();
  const run = (fn: () => Promise<ActionState>, options?: { confirm?: string }) =>
    action.run(async () => {
      const result = await fn();
      if (result.ok) router.refresh();
      return result;
    }, options);
  return { ...action, run };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export function AddMemberForm({
  placementId,
  options,
}: {
  placementId: string;
  options: { profile_id: string; full_name: string | null; email: string | null; academy_role: string }[];
}) {
  const [state, action] = useActionState(addPlacementMember.bind(null, placementId), initialActionState);
  const [person, setPerson] = useState("");
  const chosen = options.find((o) => o.profile_id === person);
  const roles: AcademyPlacementRole[] = chosen?.academy_role === "developer" ? ["developer"] : ["client_admin", "client_member", "client_reader"];
  const defaultRole = chosen?.academy_role === "developer" ? "developer" : (chosen?.academy_role as AcademyPlacementRole | undefined) ?? "client_member";
  const e = state.fieldErrors ?? {};
  if (options.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nobody to add. Add the client contacts and the developer to the Academy first (Academy, People), with this client for client users.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3" key={state.ok ? state.message : "form"}>
      <FormMessage error={state.error} success={state.message} />
      <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <Field label="Person" htmlFor="pm-person" error={e.profile_id}>
          <Select id="pm-person" name="profile_id" value={person} onChange={(ev) => setPerson(ev.target.value)} required>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.profile_id} value={o.profile_id}>
                {o.full_name ?? o.email} ({o.academy_role.replace("client_", "client ")})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Role in this placement" htmlFor="pm-role" error={e.role}>
          <Select id="pm-role" name="role" key={person} defaultValue={defaultRole}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <SubmitButton size="md" pendingLabel="Adding…">
          Add
        </SubmitButton>
      </div>
    </form>
  );
}

export function MemberRow({
  placementId,
  profileId,
  name,
  email,
  role,
}: {
  placementId: string;
  profileId: string;
  name: string;
  email: string | null;
  role: AcademyPlacementRole;
}) {
  const action = useRefreshing();
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-brand-900">{name}</p>
        {email && <p className="truncate text-xs text-muted">{email}</p>}
      </div>
      {role === "developer" ? (
        <span className="text-sm text-muted">Developer</span>
      ) : (
        <Select
          aria-label={`Role of ${name}`}
          className="w-44"
          defaultValue={role}
          disabled={action.pending}
          onChange={(ev) => action.run(() => updatePlacementMemberRole(placementId, profileId, ev.target.value))}
        >
          {(["client_admin", "client_member", "client_reader"] as const).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Remove ${name}`}
        disabled={action.pending}
        onClick={() =>
          action.run(() => removePlacementMember(placementId, profileId), {
            confirm: `Remove ${name} from this placement? Their own progress stays; they no longer see the placement.`,
          })
        }
      >
        <UserMinus aria-hidden="true" />
      </Button>
      {action.result.error && <p className="w-full text-xs text-danger">{action.result.error}</p>}
    </li>
  );
}

export function MakeDeveloperButton({ placementId, profileId, name }: { placementId: string; profileId: string; name: string }) {
  const action = useRefreshing();
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={action.pending}
        onClick={() =>
          action.run(() => makeDeveloperAndAdd(placementId, profileId), {
            confirm: `Make ${name} a developer with the whole developer course and add them to this placement? Their progress stays.`,
          })
        }
      >
        Make {name} the developer
      </Button>
      <FormMessage error={action.result.error} success={action.result.message} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export function FactsForm({
  placementId,
  values,
  team,
}: {
  placementId: string;
  values: {
    hours_per_week: number | null;
    overlap_start: string | null;
    overlap_end: string | null;
    overlap_time_zone: string;
    probation_end_date: string | null;
    nordavo_contact_id: string | null;
    nordavo_response_hours: number;
  };
  team: { id: string; full_name: string | null }[];
}) {
  const [state, action] = useActionState(saveAcademyFacts.bind(null, placementId), initialActionState);
  const e = state.fieldErrors ?? {};
  const hhmm = (v: string | null) => (v ? v.slice(0, 5) : "");
  return (
    <form action={action} className="space-y-4">
      <FormMessage error={state.error} success={state.message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hours per week" htmlFor="f-hours" error={e.hours_per_week}>
          <Input id="f-hours" name="hours_per_week" type="number" min={0} max={80} step="0.5" defaultValue={values.hours_per_week ?? ""} />
        </Field>
        <Field label="End of probation" htmlFor="f-probation" error={e.probation_end_date}>
          <Input id="f-probation" name="probation_end_date" type="date" defaultValue={values.probation_end_date ?? ""} />
        </Field>
        <Field label="Overlap from" htmlFor="f-start" error={e.overlap_start}>
          <Input id="f-start" name="overlap_start" type="time" defaultValue={hhmm(values.overlap_start)} />
        </Field>
        <Field label="Overlap until" htmlFor="f-end" error={e.overlap_end}>
          <Input id="f-end" name="overlap_end" type="time" defaultValue={hhmm(values.overlap_end)} />
        </Field>
        <Field label="Overlap times are in" htmlFor="f-zone" hint="Each side sees the window in their own time zone.">
          <Select id="f-zone" name="overlap_time_zone" defaultValue={values.overlap_time_zone}>
            <option value="Europe/Amsterdam">Netherlands (Amsterdam)</option>
            <option value="Asia/Kolkata">India (Kolkata)</option>
          </Select>
        </Field>
        <Field label="Nordavo contact" htmlFor="f-contact" hint="Gets the signals of this placement and is shown in the triangle.">
          <Select id="f-contact" name="nordavo_contact_id" defaultValue={values.nordavo_contact_id ?? ""}>
            <option value="">Nobody (signals go to every Academy manager)</option>
            {team.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? p.id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nordavo responds within (working hours)" htmlFor="f-response" error={e.nordavo_response_hours}>
          <Input id="f-response" name="nordavo_response_hours" type="number" min={1} max={168} defaultValue={values.nordavo_response_hours} required />
        </Field>
      </div>
      <SubmitButton size="sm" pendingLabel="Saving…">
        Save
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export function LeaveDecision({ placementId, request }: { placementId: string; request: AcademyLeaveRequestRow }) {
  const action = useRefreshing();
  const [note, setNote] = useState(request.decision_note ?? "");
  const decide = (status: string, confirm?: string) => action.run(() => decideLeave(placementId, request.id, status, note), { confirm });
  if (request.status === "cancelled") return null;
  return (
    <div className="mt-2 space-y-2">
      <Input aria-label="Note for the developer and the client" placeholder="Note (optional, visible to all three)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        {request.status === "requested" && (
          <Button size="sm" variant="secondary" disabled={action.pending} onClick={() => decide("client_agreed")}>
            Discussed with client
          </Button>
        )}
        {request.status !== "approved" && (
          <Button size="sm" disabled={action.pending} onClick={() => decide("approved")}>
            <Check aria-hidden="true" />
            Approve
          </Button>
        )}
        {request.status !== "rejected" && (
          <Button size="sm" variant="ghost" disabled={action.pending} onClick={() => decide("rejected", "Reject this leave request?")}>
            Reject
          </Button>
        )}
        {(request.status === "approved" || request.status === "rejected") && (
          <Button size="sm" variant="ghost" disabled={action.pending} onClick={() => decide("requested", "Open this request again?")}>
            Reopen
          </Button>
        )}
      </div>
      {action.result.error && <p className="text-xs text-danger">{action.result.error}</p>}
    </div>
  );
}

export function BalanceForm({
  placementId,
  developerId,
  year,
  values,
}: {
  placementId: string;
  developerId: string;
  year: number;
  values: { entitled_days: number; carried_over_days: number; adjustment_days: number } | null;
}) {
  const [state, action] = useActionState(saveLeaveBalance.bind(null, placementId), initialActionState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <FormMessage error={state.error} success={state.message} />
      <input type="hidden" name="profile_id" value={developerId} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Year" htmlFor="b-year" error={e.year}>
          <Input id="b-year" name="year" type="number" min={2020} max={2100} defaultValue={year} required />
        </Field>
        <Field label="Entitled days" htmlFor="b-entitled" error={e.entitled_days}>
          <Input id="b-entitled" name="entitled_days" type="number" step="0.5" min={0} defaultValue={values?.entitled_days ?? ""} required />
        </Field>
        <Field label="Carried over" htmlFor="b-carried" error={e.carried_over_days}>
          <Input id="b-carried" name="carried_over_days" type="number" step="0.5" defaultValue={values?.carried_over_days ?? 0} />
        </Field>
        <Field label="Taken elsewhere" htmlFor="b-adjust" error={e.adjustment_days} hint="E.g. before Wisemonk was replaced.">
          <Input id="b-adjust" name="adjustment_days" type="number" step="0.5" defaultValue={values?.adjustment_days ?? 0} />
        </Field>
      </div>
      <SubmitButton size="sm" pendingLabel="Saving…">
        Save balance
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function MilestoneDate({ placementId, milestoneId, dueDate }: { placementId: string; milestoneId: string; dueDate: string | null }) {
  const action = useRefreshing();
  return (
    <Input
      type="date"
      aria-label="Date of this moment"
      className="w-40"
      defaultValue={dueDate ?? ""}
      disabled={action.pending}
      onChange={(e) => e.target.value && action.run(() => moveMilestone(placementId, milestoneId, e.target.value))}
    />
  );
}

export function ReportEditor({
  placementId,
  milestoneId,
  initial,
  published,
}: {
  placementId: string;
  milestoneId: string;
  initial: string;
  published: boolean;
}) {
  const action = useRefreshing();
  const [text, setText] = useState(initial);
  return (
    <div className="space-y-2">
      <Field label="Report by Nordavo" htmlFor={`report-${milestoneId}`} hint="Visible to the client contacts and the developer once published.">
        <Textarea id={`report-${milestoneId}`} rows={4} maxLength={20000} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={action.pending} onClick={() => action.run(() => saveReport(placementId, milestoneId, text, true))}>
          {published ? "Update published report" : "Publish report"}
        </Button>
        <Button size="sm" variant="secondary" disabled={action.pending} onClick={() => action.run(() => saveReport(placementId, milestoneId, text, false))}>
          {published ? "Take back to draft" : "Save draft"}
        </Button>
      </div>
      <FormMessage error={action.result.error} success={action.result.message} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DOCUMENT_CATEGORY_LABELS = {
  contract_summary: "Contract summary",
  gdpr: "GDPR",
  policy: "Policy",
  escalation_matrix: "Escalation matrix",
  decision_matrix: "Decision matrix",
  blocker_agreement: "Blocker agreement",
} as const;

export function DocumentUploadForm({ placementId }: { placementId: string }) {
  const [state, action] = useActionState(uploadPlacementDocument.bind(null, placementId), initialActionState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" key={state.ok ? state.message : "form"}>
      <FormMessage error={state.error} success={state.message} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" htmlFor="d-title" error={e.title} required>
          <Input id="d-title" name="title" maxLength={300} required />
        </Field>
        <Field label="Kind" htmlFor="d-category" error={e.category}>
          <Select id="d-category" name="category" defaultValue="contract_summary">
            {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="For" htmlFor="d-scope" hint="Every placement: for example the GDPR text or a policy.">
          <Select id="d-scope" name="scope" defaultValue="placement">
            <option value="placement">This placement</option>
            <option value="global">Every placement</option>
          </Select>
        </Field>
        <Field label="File" htmlFor="d-file" error={e.file} hint="PDF, Word, Excel, PowerPoint, text or image, at most 20 MB.">
          <Input id="d-file" name="file" type="file" required />
        </Field>
      </div>
      <SubmitButton size="sm" pendingLabel="Uploading…">
        Upload
      </SubmitButton>
    </form>
  );
}

export function DocumentActions({ placementId, documentId, title, category, scope }: { placementId: string; documentId: string; title: string; category: string; scope: string }) {
  const [state, action] = useActionState(uploadPlacementDocument.bind(null, placementId), initialActionState);
  const remove = useRefreshing();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          <RefreshCw aria-hidden="true" />
          New version
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Delete ${title}`}
          disabled={remove.pending}
          onClick={() =>
            remove.run(() => deletePlacementDocument(placementId, documentId), {
              confirm: scope === "global" ? `Delete "${title}" from every placement?` : `Delete "${title}"?`,
            })
          }
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      {open && (
        <form action={action} className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
          <input type="hidden" name="document_id" value={documentId} />
          <input type="hidden" name="title" value={title} />
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="scope" value={scope} />
          <Input name="file" type="file" required aria-label={`New version of ${title}`} />
          <Input name="notes" placeholder="What changed (optional)" maxLength={2000} />
          <SubmitButton size="sm" pendingLabel="Uploading…">
            Upload
          </SubmitButton>
        </form>
      )}
      <FormMessage error={state.error ?? remove.result.error} success={state.message} />
    </div>
  );
}

export function RotateCalendarButton({ placementId }: { placementId: string }) {
  const action = useRefreshing();
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={action.pending}
        onClick={() => action.run(() => rotateCalendarLink(placementId), { confirm: "Make a new calendar link? Existing subscriptions stop working." })}
      >
        <RotateCcw aria-hidden="true" />
        New link
      </Button>
      <FormMessage error={action.result.error} success={action.result.message} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rituals
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function RitualFields({ ritual, idPrefix, errors }: { ritual: Partial<AcademyRitualRow>; idPrefix: string; errors: Record<string, string> }) {
  const [cadence, setCadence] = useState(ritual.cadence ?? "weekly");
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Title" htmlFor={`${idPrefix}-title`} error={errors.title} className="lg:col-span-2">
        <Input id={`${idPrefix}-title`} name="title" defaultValue={ritual.title ?? ""} maxLength={200} required />
      </Field>
      <Field label="How often" htmlFor={`${idPrefix}-cadence`}>
        <Select id={`${idPrefix}-cadence`} name="cadence" value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
          <option value="daily">Every working day</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
        </Select>
      </Field>
      {cadence === "weekly" ? (
        <Field label="Day" htmlFor={`${idPrefix}-weekday`}>
          <Select id={`${idPrefix}-weekday`} name="weekday" defaultValue={ritual.weekday ?? 1}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div className="hidden lg:block" />
      )}
      <Field label="Who ticks it off" htmlFor={`${idPrefix}-audience`}>
        <Select id={`${idPrefix}-audience`} name="audience" defaultValue={ritual.audience ?? "both"}>
          <option value="both">Client or developer</option>
          <option value="client">Client</option>
          <option value="developer">Developer</option>
          <option value="nordavo">Nordavo</option>
        </Select>
      </Field>
      <Field label="Description" htmlFor={`${idPrefix}-description`} className="sm:col-span-2 lg:col-span-2">
        <Input id={`${idPrefix}-description`} name="description" defaultValue={ritual.description ?? ""} maxLength={2000} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-ink">
        <input type="checkbox" name="active" defaultChecked={ritual.active ?? true} className="size-4 accent-brand-700" />
        Active
      </label>
    </div>
  );
}

export function PlacementRitualForm({ placementId, ritual }: { placementId: string; ritual: AcademyRitualRow | null }) {
  const [state, action] = useActionState(savePlacementRitual.bind(null, placementId, ritual?.id ?? null), initialActionState);
  const id = ritual?.id ?? "new";
  return (
    <form action={action} className="space-y-3" key={!ritual && state.ok ? state.message : id}>
      <FormMessage error={state.error} success={state.message} />
      <RitualFields ritual={ritual ?? {}} idPrefix={`pr-${id}`} errors={state.fieldErrors ?? {}} />
      <SubmitButton size="sm" pendingLabel="Saving…">
        {ritual ? "Save" : "Add ritual"}
      </SubmitButton>
    </form>
  );
}

export function PlacementRitualButtons({ placementId, ritual }: { placementId: string; ritual: AcademyRitualRow }) {
  const action = useRefreshing();
  return (
    <span className="flex gap-1">
      {ritual.customized && (
        <Button size="sm" variant="ghost" disabled={action.pending} onClick={() => action.run(() => resetPlacementRitual(placementId, ritual.id))}>
          <RotateCcw aria-hidden="true" />
          Follow course
        </Button>
      )}
      {ritual.active && (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove ${ritual.title}`}
          disabled={action.pending}
          onClick={() =>
            action.run(() => removePlacementRitual(placementId, ritual.id), {
              confirm: ritual.template_id ? "Switch this ritual off for this placement? Its history stays." : "Remove this ritual and its history?",
            })
          }
        >
          <Trash2 aria-hidden="true" />
        </Button>
      )}
    </span>
  );
}

export function RitualTemplateForm({ ritual, courses }: { ritual: AcademyRitualRow | null; courses: { id: string; title: string }[] }) {
  const [state, action] = useActionState(saveRitualTemplate.bind(null, ritual?.id ?? null), initialActionState);
  const id = ritual?.id ?? "new";
  return (
    <form action={action} className="space-y-3" key={!ritual && state.ok ? state.message : id}>
      <FormMessage error={state.error} success={state.message} />
      {!ritual && (
        <Field label="Course" htmlFor="rt-course" error={state.fieldErrors?.course_id}>
          <Select id="rt-course" name="course_id" required defaultValue="">
            <option value="">Choose…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <RitualFields ritual={ritual ?? {}} idPrefix={`rt-${id}`} errors={state.fieldErrors ?? {}} />
      <SubmitButton size="sm" pendingLabel="Saving…">
        {ritual ? "Save" : "Add ritual"}
      </SubmitButton>
    </form>
  );
}

export function DeleteRitualTemplateButton({ id, title }: { id: string; title: string }) {
  const action = useRefreshing();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Delete ${title}`}
      disabled={action.pending}
      onClick={() =>
        action.run(() => deleteRitualTemplate(id), {
          confirm: `Delete "${title}"? Placements that did not adjust it stop the ritual; their history stays.`,
        })
      }
    >
      <Trash2 aria-hidden="true" />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Pulse
// ---------------------------------------------------------------------------

export function HandleSignal({ pulseId }: { pulseId: string }) {
  const action = useRefreshing();
  const [note, setNote] = useState("");
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
      <Input aria-label="What Nordavo did" placeholder="What did you do? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      <Button size="sm" variant="secondary" disabled={action.pending} onClick={() => action.run(() => handlePulseSignal(pulseId, note))}>
        <Check aria-hidden="true" />
        Followed up
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export function HolidayForm({ holiday }: { holiday: { id: string; country: "NL" | "IN"; date: string; name_nl: string; name_en: string; day_off: boolean; confirmed: boolean } | null }) {
  const [state, action] = useActionState(saveHoliday.bind(null, holiday?.id ?? null), initialActionState);
  const id = holiday?.id ?? "new";
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" key={!holiday && state.ok ? state.message : id}>
      <FormMessage error={state.error} success={state.message} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Country" htmlFor={`h-${id}-country`}>
          <Select id={`h-${id}-country`} name="country" defaultValue={holiday?.country ?? "IN"}>
            <option value="IN">India (Karnataka)</option>
            <option value="NL">Netherlands</option>
          </Select>
        </Field>
        <Field label="Date" htmlFor={`h-${id}-date`} error={e.date}>
          <Input id={`h-${id}-date`} name="date" type="date" defaultValue={holiday?.date ?? ""} required />
        </Field>
        <Field label="Name (Dutch)" htmlFor={`h-${id}-nl`} error={e.name_nl}>
          <Input id={`h-${id}-nl`} name="name_nl" defaultValue={holiday?.name_nl ?? ""} maxLength={200} required />
        </Field>
        <Field label="Name (English)" htmlFor={`h-${id}-en`} error={e.name_en}>
          <Input id={`h-${id}-en`} name="name_en" defaultValue={holiday?.name_en ?? ""} maxLength={200} required />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="day_off" defaultChecked={holiday?.day_off ?? true} className="size-4 accent-brand-700" />
          Day off
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="confirmed" defaultChecked={holiday?.confirmed ?? true} className="size-4 accent-brand-700" />
          Date checked against the official list
        </label>
      </div>
      <SubmitButton size="sm" pendingLabel="Saving…">
        {holiday ? "Save" : "Add holiday"}
      </SubmitButton>
    </form>
  );
}

export function HolidayButtons({ id, name, confirmed }: { id: string; name: string; confirmed: boolean }) {
  const action = useRefreshing();
  return (
    <span className="flex gap-1">
      {!confirmed && (
        <Button size="sm" variant="secondary" disabled={action.pending} onClick={() => action.run(() => confirmHoliday(id))}>
          <Check aria-hidden="true" />
          Date is right
        </Button>
      )}
      <Button size="sm" variant="ghost" aria-label={`Delete ${name}`} disabled={action.pending} onClick={() => action.run(() => deleteHoliday(id), { confirm: `Delete ${name}?` })}>
        <Trash2 aria-hidden="true" />
      </Button>
    </span>
  );
}

export function SeedYearButton({ year }: { year: number }) {
  const action = useRefreshing();
  return (
    <div className="space-y-2">
      <Button size="sm" variant="secondary" disabled={action.pending} onClick={() => action.run(() => seedHolidayYear(year))}>
        Add the rule-based holidays of {year}
      </Button>
      <FormMessage error={action.result.error} success={action.result.message} />
    </div>
  );
}
