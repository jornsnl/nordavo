"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import Link from "next/link";
import { FileText, LoaderCircle } from "lucide-react";
import { saveCandidate } from "@/app/dashboard/kandidaten/actions";
import { initialActionState } from "@/lib/action-state";
import type { Candidate } from "@/lib/database.types";
import { candidateStatuses } from "@/lib/labels";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { FormActions } from "@/components/entity/form-actions";

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
>;

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
    ? `/dashboard/kandidaten/${candidate.id}`
    : vacancyId
      ? `/dashboard/vacatures/${vacancyId}/pipeline`
      : "/dashboard/kandidaten";

  // Submit manually so React does not reset the form after a validation error.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const describedBy = (name: string) => (errors[name] ? `${name}-error` : undefined);
  const cvName = candidate?.cv_path?.split("/").pop()?.replace(/^[0-9a-f]{8}-/, "");

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {candidate && <input type="hidden" name="id" value={candidate.id} />}
      {vacancyId && <input type="hidden" name="vacancy_id" value={vacancyId} />}

      <FormMessage error={notice} />
      <FormMessage error={state.error} />

      <Card>
        <CardHeader title="Profiel" description="De basis die je ook aan de klant laat zien." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Naam" htmlFor="full_name" required error={errors.full_name} className="sm:col-span-2">
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
          <Field label="Huidige functie" htmlFor="current_title" error={errors.current_title}>
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
          <Field label="Jaren ervaring" htmlFor="years_experience" error={errors.years_experience}>
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
            hint="Scheid met komma's, bijvoorbeeld: Python, Spark, AWS"
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
          <Field label="Samenvatting" htmlFor="summary" error={errors.summary} className="sm:col-span-2">
            <Textarea
              id="summary"
              name="summary"
              rows={5}
              placeholder="Wat maakt deze kandidaat sterk? Projecten, stack, rol in het team."
              defaultValue={candidate?.summary ?? ""}
              aria-invalid={!!errors.summary}
              aria-describedby={describedBy("summary")}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Contact en links" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="E-mailadres" htmlFor="email" error={errors.email}>
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
          <Field label="Telefoon" htmlFor="phone" error={errors.phone}>
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
          <Field label="Locatie" htmlFor="location" error={errors.location}>
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
            label="Video-intro"
            htmlFor="video_url"
            hint="Link naar de video, bijvoorbeeld Loom of YouTube."
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
        <CardHeader title="Cv en selectie" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field
            label={candidate?.cv_path ? "Nieuw cv" : "Cv"}
            htmlFor="cv"
            hint={`PDF, DOC of DOCX, maximaal ${maxUploadMb} MB.`}
            error={errors.cv}
            className="sm:col-span-2"
          >
            {cvName && (
              <p className="mb-2 flex items-center gap-2 text-sm text-muted">
                <FileText className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Huidig cv: {cvName}</span>
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
                Huidig cv verwijderen
              </label>
            )}
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
          <Field label="Eigenaar" htmlFor="owner_id" error={errors.owner_id}>
            <Select id="owner_id" name="owner_id" defaultValue={candidate ? (candidate.owner_id ?? "") : (defaultOwnerId ?? "")}>
              <option value="">Niemand</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {/* The form has no card around it, so on phones the bar spans the screen. */}
      <FormActions divider={false}>
        <Link href={cancelHref} className={buttonClasses({ variant: "secondary" })}>
          Annuleren
        </Link>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Opslaan..." : candidate ? "Wijzigingen opslaan" : "Kandidaat toevoegen"}
        </Button>
      </FormActions>
    </form>
  );
}
