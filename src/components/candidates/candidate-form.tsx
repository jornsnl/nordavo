"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { FileText, LoaderCircle } from "lucide-react";
import { checkCandidateDuplicates, saveCandidate } from "@/app/dashboard/candidates/actions";
import { noticePeriodOptions, isNoticePeriod } from "@/lib/recruitment/candidate-fields";
import type { CandidateDuplicate } from "@/lib/screening/duplicates";
import { initialActionState } from "@/lib/action-state";
import type { Candidate } from "@/lib/database.types";
import { candidateStatuses } from "@/lib/labels";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { FormActions } from "@/components/entity/form-actions";
import { MatchingFields, type MatchingFieldValues } from "@/components/candidates/matching-fields";

type CandidateFormValues = Pick<
  Candidate,
  | "id"
  | "full_name"
  | "email"
  | "phone"
  | "location"
  | "current_title"
  | "years_experience"
  | "skills"
  | "linkedin_url"
  | "video_url"
  | "summary"
  | "status"
  | "owner_id"
  | "cv_path"
  | "notice_period"
  | "current_ctc_inr_year"
  | "expected_ctc_inr_year"
> &
  MatchingFieldValues;

export function CandidateForm({
  candidate,
  owners,
  defaultOwnerId,
  maxUploadMb,
  vacancyId,
  notice,
}: {
  candidate?: CandidateFormValues;
  owners: { id: string; name: string }[];
  defaultOwnerId?: string;
  maxUploadMb: number;
  /** Link the new candidate to this vacancy after creating it. */
  vacancyId?: string;
  notice?: string;
}) {
  const [state, formAction, pending] = useActionState(saveCandidate, initialActionState);
  const errors = state.fieldErrors ?? {};
  const cancelHref = candidate
    ? `/dashboard/candidates/${candidate.id}`
    : vacancyId
      ? `/dashboard/vacancies/${vacancyId}/pipeline`
      : "/dashboard/candidates";

  // Submit manually so React does not reset the form after a validation error.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const describedBy = (name: string) => (errors[name] ? `${name}-error` : undefined);

  // New candidates: warn about possible duplicates (same name, email, phone or LinkedIn) before saving.
  const [duplicates, setDuplicates] = useState<CandidateDuplicate[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const checkSeq = useRef(0);
  function checkDuplicates() {
    if (candidate || !formRef.current) return;
    const data = new FormData(formRef.current);
    const value = (name: string) => String(data.get(name) ?? "").trim() || undefined;
    const input = { full_name: value("full_name"), email: value("email"), phone: value("phone"), linkedin_url: value("linkedin_url") };
    if (!input.full_name && !input.email && !input.phone && !input.linkedin_url) return setDuplicates([]);
    const seq = ++checkSeq.current;
    void checkCandidateDuplicates(input).then((found) => {
      if (seq === checkSeq.current) setDuplicates(found);
    });
  }
  const showConfirm = !candidate && (duplicates.length > 0 || Boolean(errors.confirm_duplicate));
  const legacyNotice = candidate?.notice_period && !isNoticePeriod(candidate.notice_period) ? candidate.notice_period : null;
  const cvName = candidate?.cv_path?.split("/").pop()?.replace(/^[0-9a-f]{8}-/, "");

  return (
    <form ref={formRef} onSubmit={onSubmit} onBlur={(e) => {
      if (e.target instanceof HTMLInputElement && ["full_name", "email", "phone", "linkedin_url"].includes(e.target.name)) checkDuplicates();
    }} noValidate className="space-y-6">
      {candidate && <input type="hidden" name="id" value={candidate.id} />}
      {vacancyId && <input type="hidden" name="vacancy_id" value={vacancyId} />}

      <FormMessage error={notice} />
      <FormMessage error={state.error} link={state.link} />
      {showConfirm && (
        <div role="status" className="space-y-2 rounded-2xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {duplicates.length > 0 && (
            <>
              <p className="font-medium">This candidate may already exist:</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    <Link href={`/dashboard/candidates/${d.id}`} className="font-medium underline hover:no-underline" target="_blank">
                      {d.full_name}
                    </Link>{" "}
                    (same {d.on})
                  </li>
                ))}
              </ul>
            </>
          )}
          <label className="flex items-center gap-2 pointer-coarse:min-h-11">
            <input type="checkbox" name="confirm_duplicate" className="size-4 rounded border-border accent-brand-700" />
            This is someone else, add the candidate anyway
          </label>
        </div>
      )}

      <Card>
        <CardHeader title="Profile" description="The basics you also show the client." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Name" htmlFor="full_name" required error={errors.full_name} className="sm:col-span-2">
            <Input
              id="full_name"
              name="full_name"
              required
              autoComplete="off"
              autoCapitalize="words"
              enterKeyHint="next"
              defaultValue={candidate?.full_name}
              aria-invalid={!!errors.full_name}
              aria-describedby={describedBy("full_name")}
            />
          </Field>
          <Field label="Current title" htmlFor="current_title" error={errors.current_title}>
            <Input
              id="current_title"
              name="current_title"
              placeholder="Senior backend developer"
              enterKeyHint="next"
              defaultValue={candidate?.current_title ?? ""}
              aria-invalid={!!errors.current_title}
              aria-describedby={describedBy("current_title")}
            />
          </Field>
          <Field label="Years of experience" htmlFor="years_experience" error={errors.years_experience}>
            <Input
              id="years_experience"
              name="years_experience"
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              enterKeyHint="next"
              defaultValue={candidate?.years_experience ?? ""}
              aria-invalid={!!errors.years_experience}
              aria-describedby={describedBy("years_experience")}
            />
          </Field>
          <Field
            label="Skills"
            htmlFor="skills"
            hint="Separate with commas, for example: Python, Spark, AWS"
            error={errors.skills}
            className="sm:col-span-2"
          >
            <Input
              id="skills"
              name="skills"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="next"
              defaultValue={candidate?.skills.join(", ") ?? ""}
              aria-invalid={!!errors.skills}
              aria-describedby={describedBy("skills")}
            />
          </Field>
          <Field label="Summary" htmlFor="summary" error={errors.summary} className="sm:col-span-2">
            <Textarea
              id="summary"
              name="summary"
              rows={5}
              placeholder="What makes this candidate strong? Projects, stack, role in the team."
              defaultValue={candidate?.summary ?? ""}
              aria-invalid={!!errors.summary}
              aria-describedby={describedBy("summary")}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Contact and links" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Email address" htmlFor="email" error={errors.email}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              defaultValue={candidate?.email ?? ""}
              aria-invalid={!!errors.email}
              aria-describedby={describedBy("email")}
            />
          </Field>
          <Field label="Phone" htmlFor="phone" error={errors.phone}>
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="off"
              enterKeyHint="next"
              placeholder="+91 ..."
              defaultValue={candidate?.phone ?? ""}
              aria-invalid={!!errors.phone}
              aria-describedby={describedBy("phone")}
            />
          </Field>
          <Field label="Location" htmlFor="location" error={errors.location}>
            <Input
              id="location"
              name="location"
              enterKeyHint="next"
              defaultValue={candidate?.location ?? "Bangalore"}
              aria-invalid={!!errors.location}
              aria-describedby={describedBy("location")}
            />
          </Field>
          <Field label="LinkedIn" htmlFor="linkedin_url" error={errors.linkedin_url}>
            <Input
              id="linkedin_url"
              name="linkedin_url"
              type="url"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              placeholder="https://www.linkedin.com/in/..."
              defaultValue={candidate?.linkedin_url ?? ""}
              aria-invalid={!!errors.linkedin_url}
              aria-describedby={describedBy("linkedin_url")}
            />
          </Field>
          <Field
            label="Video intro"
            htmlFor="video_url"
            hint="Loom, YouTube, Vimeo or Google Drive link. It plays on the candidate page (Overview); upload a copy there so it stays available."
            error={errors.video_url}
            className="sm:col-span-2"
          >
            <Input
              id="video_url"
              name="video_url"
              type="url"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              placeholder="https://"
              defaultValue={candidate?.video_url ?? ""}
              aria-invalid={!!errors.video_url}
              aria-describedby={describedBy("video_url")}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="CV and selection" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field
            label={candidate?.cv_path ? "New CV" : "CV"}
            htmlFor="cv"
            hint={`PDF, DOC or DOCX, up to ${maxUploadMb} MB.`}
            error={errors.cv}
            className="sm:col-span-2"
          >
            {cvName && (
              <p className="mb-2 flex items-center gap-2 text-sm text-muted">
                <FileText className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Current CV: {cvName}</span>
              </p>
            )}
            <Input
              id="cv"
              name="cv"
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1 file:text-sm file:font-medium file:text-brand-700"
              aria-invalid={!!errors.cv}
              aria-describedby={describedBy("cv")}
            />
            {candidate?.cv_path && (
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-ink pointer-coarse:min-h-11">
                <input type="checkbox" name="remove_cv" className="size-4 rounded border-border accent-brand-700" />
                Remove current CV
              </label>
            )}
          </Field>
          <Field label="Notice period" htmlFor="notice_period" error={errors.notice_period}>
            <Select id="notice_period" name="notice_period" defaultValue={candidate?.notice_period ?? ""}>
              <option value="">Unknown</option>
              {noticePeriodOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {legacyNotice && <option value={legacyNotice}>As written before: {legacyNotice}</option>}
            </Select>
          </Field>
          <Field label="Current CTC (INR per year)" htmlFor="current_ctc" hint="Optional, for example 12 LPA or 1200000." error={errors.current_ctc}>
            <Input
              id="current_ctc"
              name="current_ctc"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              defaultValue={candidate?.current_ctc_inr_year ?? ""}
              aria-invalid={!!errors.current_ctc}
              aria-describedby={describedBy("current_ctc")}
            />
          </Field>
          <Field label="Expected CTC (INR per year)" htmlFor="expected_ctc" hint="Optional." error={errors.expected_ctc}>
            <Input
              id="expected_ctc"
              name="expected_ctc"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              defaultValue={candidate?.expected_ctc_inr_year ?? ""}
              aria-invalid={!!errors.expected_ctc}
              aria-describedby={describedBy("expected_ctc")}
            />
          </Field>
          <Field label="Status" htmlFor="status" error={errors.status}>
            <Select id="status" name="status" defaultValue={candidate?.status ?? "available"}>
              {candidateStatuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="owner_id" error={errors.owner_id}>
            <Select id="owner_id" name="owner_id" defaultValue={candidate ? (candidate.owner_id ?? "") : (defaultOwnerId ?? "")}>
              <option value="">Nobody</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <MatchingFields candidate={candidate} errors={errors} />

      {/* The form has no card around it, so on phones the bar spans the screen. */}
      <FormActions divider={false}>
        <Link href={cancelHref} className={buttonClasses({ variant: "secondary" })}>
          Cancel
        </Link>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Saving..." : candidate ? "Save changes" : "Add candidate"}
        </Button>
      </FormActions>
    </form>
  );
}
