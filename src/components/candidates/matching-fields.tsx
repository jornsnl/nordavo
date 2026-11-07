import type { Candidate } from "@/lib/database.types";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export type MatchingFieldValues = Pick<
  Candidate,
  "seniority" | "employers" | "project_types" | "sectors" | "cv_text" | "english_level" | "availability" | "profile_consent"
>;

export const seniorityOptions = [
  { value: "junior", label: "Junior" },
  { value: "medior", label: "Medior" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
] as const;

export const consentOptions = [
  { value: "", label: "Unknown" },
  { value: "yes", label: "Yes, consent given" },
  { value: "no", label: "No, no consent" },
] as const;

export function consentValue(consent: boolean | null | undefined) {
  return consent === true ? "yes" : consent === false ? "no" : "";
}

/** Fields T2 matching and the anonymous profile read (part of the candidate form). */
export function MatchingFields({
  candidate,
  errors,
}: {
  candidate?: MatchingFieldValues;
  errors: Record<string, string | undefined>;
}) {
  const describedBy = (name: string) => (errors[name] ? `${name}-error` : undefined);
  return (
    <Card>
      <CardHeader
        title="Matching"
        description="Used by talent matching (T2) and the anonymous profile. Employers are only used to keep the profile anonymous."
      />
      <CardBody className="grid gap-5 sm:grid-cols-2">
        <Field label="Seniority" htmlFor="seniority" hint="Empty: judged from years of experience." error={errors.seniority}>
          <Select id="seniority" name="seniority" defaultValue={candidate?.seniority ?? ""}>
            <option value="">Not set</option>
            {seniorityOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="English level" htmlFor="english_level" error={errors.english_level}>
          <Input
            id="english_level"
            name="english_level"
            placeholder="C1"
            enterKeyHint="next"
            defaultValue={candidate?.english_level ?? ""}
            aria-invalid={!!errors.english_level}
            aria-describedby={describedBy("english_level")}
          />
        </Field>
        <Field label="Availability" htmlFor="availability" hint="For example: 30 days notice." error={errors.availability}>
          <Input
            id="availability"
            name="availability"
            enterKeyHint="next"
            defaultValue={candidate?.availability ?? ""}
            aria-invalid={!!errors.availability}
            aria-describedby={describedBy("availability")}
          />
        </Field>
        <Field
          label="Consent to share an anonymous profile"
          htmlFor="profile_consent"
          error={errors.profile_consent}
        >
          <Select id="profile_consent" name="profile_consent" defaultValue={consentValue(candidate?.profile_consent)}>
            {consentOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Employers"
          htmlFor="employers"
          hint="Current employer first, separated by commas."
          error={errors.employers}
          className="sm:col-span-2"
        >
          <Input
            id="employers"
            name="employers"
            autoComplete="off"
            enterKeyHint="next"
            defaultValue={candidate?.employers.join(", ") ?? ""}
            aria-invalid={!!errors.employers}
            aria-describedby={describedBy("employers")}
          />
        </Field>
        <Field label="Project types" htmlFor="project_types" hint="Separated by commas." error={errors.project_types}>
          <Input
            id="project_types"
            name="project_types"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="Data platforms, SaaS"
            defaultValue={candidate?.project_types.join(", ") ?? ""}
            aria-invalid={!!errors.project_types}
            aria-describedby={describedBy("project_types")}
          />
        </Field>
        <Field label="Sectors" htmlFor="sectors" hint="Separated by commas." error={errors.sectors}>
          <Input
            id="sectors"
            name="sectors"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="E-commerce, Fintech"
            defaultValue={candidate?.sectors.join(", ") ?? ""}
            aria-invalid={!!errors.sectors}
            aria-describedby={describedBy("sectors")}
          />
        </Field>
        <Field
          label="CV text"
          htmlFor="cv_text"
          hint="Paste the text of the CV. Matching reads this text; an uploaded file is not read."
          error={errors.cv_text}
          className="sm:col-span-2"
        >
          <Textarea
            id="cv_text"
            name="cv_text"
            rows={8}
            defaultValue={candidate?.cv_text ?? ""}
            aria-invalid={!!errors.cv_text}
            aria-describedby={describedBy("cv_text")}
          />
        </Field>
      </CardBody>
    </Card>
  );
}
