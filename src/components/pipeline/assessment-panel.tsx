"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveAssessment, saveBackgroundCheck } from "@/app/dashboard/vacancies/[id]/pipeline/recruitment-actions";
import { initialActionState, type ActionState } from "@/lib/action-state";
import type { KindAttachment } from "@/lib/data/recruitment";
import type { StaffMember } from "@/lib/data/staff";
import { formatDate } from "@/lib/format";
import { backgroundCheckStatuses } from "@/lib/labels";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { KindFiles } from "./kind-files";
import type { BoardCard } from "./pipeline-card";

type Errors = Record<string, string>;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface/40 p-4">
      <h3 className="font-display text-sm font-semibold text-brand-900">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SectionForm({
  section,
  applicationId,
  action,
  children,
}: {
  section?: string;
  applicationId: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: (errors: Errors) => ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} noValidate className="space-y-3">
      <input type="hidden" name="id" value={applicationId} />
      {section && <input type="hidden" name="section" value={section} />}
      {children(state.fieldErrors ?? {})}
      <div aria-live="polite">
        <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      </div>
      <div className="flex justify-end max-sm:*:flex-1">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Saving">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

function ScoreInput({
  id,
  name,
  label,
  value,
  errors,
  max = 100,
  min = 0,
}: {
  id: string;
  name: string;
  label: string;
  value: number | null | undefined;
  errors: Errors;
  max?: number;
  min?: number;
}) {
  return (
    <Field label={label} htmlFor={id} hint={`${min} to ${max}`} error={errors[name]}>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        defaultValue={value ?? ""}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `${id}-error` : undefined}
      />
    </Field>
  );
}

/** Structured assessment (2.12): video review, screening call, interview, technical test. */
export function AssessmentPanel({
  card,
  staff,
  files,
  onFilesChange,
}: {
  card: BoardCard;
  staff: StaffMember[];
  /** Files of the application; the test result file is listed with the test. */
  files: KindAttachment[] | null;
  onFilesChange: () => void;
}) {
  const id = useId();
  const a = card.assessment;
  const nameOf = (profileId: string | null | undefined) => staff.find((s) => s.id === profileId)?.name;

  return (
    <div className="space-y-4">
      <Section
        title="Video review"
        description={
          a?.video_reviewed_at
            ? `Reviewed by ${nameOf(a.video_reviewed_by) ?? "the team"} on ${formatDate(a.video_reviewed_at)}.`
            : "English, accent and communication, judged by a person."
        }
      >
        <SectionForm section="video" applicationId={card.id} action={saveAssessment}>
          {(errors) => (
            <>
              <ScoreInput id={`${id}-video`} name="video_score" label="Video score" value={card.video_score} errors={errors} />
              <Field label="Video notes" htmlFor={`${id}-video-notes`} error={errors.video_notes}>
                <Textarea
                  id={`${id}-video-notes`}
                  name="video_notes"
                  rows={3}
                  maxLength={5000}
                  defaultValue={card.video_notes ?? ""}
                  placeholder="English, accent, how they come across."
                />
              </Field>
            </>
          )}
        </SectionForm>
      </Section>

      <Section
        title="Screening call"
        description={
          a?.screened_at
            ? `Called by ${nameOf(a.screened_by) ?? "the team"} on ${formatDate(a.screened_at)}.`
            : "A short call: years of experience per tool and how they communicate."
        }
      >
        <SectionForm section="screening" applicationId={card.id} action={saveAssessment}>
          {(errors) => (
            <>
              <ToolsEditor initial={a?.screening_tools ?? []} error={errors.screening_tools} />
              <ScoreInput
                id={`${id}-comm`}
                name="screening_communication_score"
                label="Communication"
                value={a?.screening_communication_score}
                errors={errors}
              />
              <Field label="Screening notes" htmlFor={`${id}-screening-notes`} error={errors.screening_notes}>
                <Textarea
                  id={`${id}-screening-notes`}
                  name="screening_notes"
                  rows={3}
                  maxLength={5000}
                  defaultValue={a?.screening_notes ?? ""}
                />
              </Field>
            </>
          )}
        </SectionForm>
      </Section>

      <Section
        title="Interview"
        description={
          a?.interviewed_at
            ? `Interview on ${formatDate(a.interviewed_at)} with ${nameOf(a.interviewer_id) ?? a.interviewer_name ?? "the team"}.`
            : "With a technical recruiter: Judith, Floris or someone else."
        }
      >
        <SectionForm section="interview" applicationId={card.id} action={saveAssessment}>
          {(errors) => <InterviewFields id={id} card={card} staff={staff} errors={errors} />}
        </SectionForm>
      </Section>

      <Section
        title="Technical test"
        description="The test itself runs in other software. Record the result here."
      >
        <SectionForm section="test" applicationId={card.id} action={saveAssessment}>
          {(errors) => (
            <>
              <ScoreInput id={`${id}-test`} name="test_score" label="Test score" value={a?.test_score ?? card.technical_score} errors={errors} />
              <Field label="Link to the result" htmlFor={`${id}-test-url`} hint="Optional." error={errors.test_url}>
                <Input
                  id={`${id}-test-url`}
                  name="test_url"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  defaultValue={a?.test_url ?? ""}
                  aria-invalid={!!errors.test_url}
                />
              </Field>
              <Field label="Test notes" htmlFor={`${id}-test-notes`} error={errors.test_notes}>
                <Textarea id={`${id}-test-notes`} name="test_notes" rows={3} maxLength={5000} defaultValue={a?.test_notes ?? ""} />
              </Field>
            </>
          )}
        </SectionForm>
        <div className="mt-4 border-t border-border pt-3">
          {files ? (
            <KindFiles
              applicationId={card.id}
              kind="test_result"
              files={files}
              label="Upload test result"
              onChange={onFilesChange}
            />
          ) : (
            <p className="text-xs text-muted">Loading files...</p>
          )}
        </div>
      </Section>
    </div>
  );
}

function InterviewFields({
  id,
  card,
  staff,
  errors,
}: {
  id: string;
  card: BoardCard;
  staff: StaffMember[];
  errors: Errors;
}) {
  const a = card.assessment;
  const [interviewer, setInterviewer] = useState(a?.interviewer_id ?? (a?.interviewer_name ? "other" : ""));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Interviewer" htmlFor={`${id}-interviewer`}>
          <Select
            id={`${id}-interviewer`}
            name="interviewer"
            value={interviewer}
            onChange={(e) => setInterviewer(e.target.value)}
          >
            <option value="">Not filled in</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="other">Someone else</option>
          </Select>
        </Field>
        <Field label="Interview date" htmlFor={`${id}-interviewed`} error={errors.interviewed_on}>
          <Input
            id={`${id}-interviewed`}
            name="interviewed_on"
            type="date"
            defaultValue={a?.interviewed_at?.slice(0, 10) ?? ""}
          />
        </Field>
      </div>
      {interviewer === "other" && (
        <Field label="Interviewer name" htmlFor={`${id}-interviewer-name`} error={errors.interviewer_name}>
          <Input id={`${id}-interviewer-name`} name="interviewer_name" maxLength={200} defaultValue={a?.interviewer_name ?? ""} />
        </Field>
      )}
      <ScoreInput
        id={`${id}-rating`}
        name="interview_rating"
        label="Rating"
        value={a?.interview_rating}
        errors={errors}
        min={1}
        max={5}
      />
      <Field label="Feedback on communication" htmlFor={`${id}-comm-feedback`} error={errors.interview_communication_feedback}>
        <Textarea
          id={`${id}-comm-feedback`}
          name="interview_communication_feedback"
          rows={3}
          maxLength={5000}
          defaultValue={a?.interview_communication_feedback ?? ""}
        />
      </Field>
      <Field label="Feedback on the LinkedIn profile" htmlFor={`${id}-linkedin`} error={errors.interview_linkedin_feedback}>
        <Textarea
          id={`${id}-linkedin`}
          name="interview_linkedin_feedback"
          rows={2}
          maxLength={5000}
          defaultValue={a?.interview_linkedin_feedback ?? ""}
        />
      </Field>
    </>
  );
}

type ToolRow = { key: number; tool: string; years: string };

/** Years of experience per tool, e.g. Clay 2, n8n 2, Python 4. Sent as JSON in one field. */
function ToolsEditor({ initial, error }: { initial: { tool: string; years: number }[]; error?: string }) {
  const id = useId();
  const [rows, setRows] = useState<ToolRow[]>(() =>
    initial.length > 0
      ? initial.map((t, i) => ({ key: i, tool: t.tool, years: String(t.years) }))
      : [{ key: 0, tool: "", years: "" }],
  );
  const update = (key: number, patch: Partial<ToolRow>) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const payload = JSON.stringify(
    rows.filter((r) => r.tool.trim()).map((r) => ({ tool: r.tool.trim(), years: r.years === "" ? "" : Number(r.years) })),
  );

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink">Years per tool</legend>
      <input type="hidden" name="screening_tools" value={payload} />
      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li key={row.key} className="flex items-center gap-2">
            <label htmlFor={`${id}-tool-${row.key}`} className="sr-only">
              Tool {index + 1}
            </label>
            <Input
              id={`${id}-tool-${row.key}`}
              value={row.tool}
              maxLength={60}
              onChange={(e) => update(row.key, { tool: e.target.value })}
              placeholder="Tool, e.g. Clay"
              className="min-w-0 flex-1"
            />
            <label htmlFor={`${id}-years-${row.key}`} className="sr-only">
              Years with tool {index + 1}
            </label>
            <Input
              id={`${id}-years-${row.key}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={50}
              step={0.5}
              value={row.years}
              onChange={(e) => update(row.key, { years: e.target.value })}
              placeholder="Years"
              className="w-24!"
            />
            <button
              type="button"
              onClick={() => setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== row.key) : [{ key: row.key + 1, tool: "", years: "" }]))}
              aria-label={`Remove tool ${index + 1}`}
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setRows((r) => [...r, { key: Math.max(0, ...r.map((x) => x.key)) + 1, tool: "", years: "" }])}
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-brand-700 hover:underline pointer-coarse:min-h-10 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add tool
      </button>
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </fieldset>
  );
}

/** Background check by the external partner (2.4): status, notes and the private report. */
export function BackgroundCheckPanel({
  card,
  files,
  onFilesChange,
}: {
  card: BoardCard;
  files: KindAttachment[];
  onFilesChange: () => void;
}) {
  const id = useId();
  return (
    <div className="space-y-4">
      <Section title="Background check" description="Done by an external partner, for example a diploma check.">
        <SectionForm applicationId={card.id} action={saveBackgroundCheck}>
          {(errors) => (
            <>
              <Field label="Status" htmlFor={`${id}-status`}>
                <Select id={`${id}-status`} name="background_check_status" defaultValue={card.background_check_status}>
                  {backgroundCheckStatuses.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notes" htmlFor={`${id}-notes`} error={errors.background_check_notes}>
                <Textarea
                  id={`${id}-notes`}
                  name="background_check_notes"
                  rows={3}
                  maxLength={5000}
                  defaultValue={card.background_check_notes ?? ""}
                />
              </Field>
            </>
          )}
        </SectionForm>
      </Section>
      <Section title="Report">
        <KindFiles
          applicationId={card.id}
          kind="background_check"
          files={files}
          label="Upload background check report"
          onChange={onFilesChange}
        />
      </Section>
    </div>
  );
}
