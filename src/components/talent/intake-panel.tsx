"use client";

import { startTransition, useActionState, useState } from "react";
import { FileText, LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import type { Seniority } from "@/lib/database.types";
import { seniorities } from "@/lib/labels";
import type { IntakeState, TalentActionState } from "@/lib/talent/types";
import { ActionFeedback } from "./action-button";

export type RequirementValues = {
  stack: string[];
  seniority: Seniority;
  hours: number | null;
  timezone_overlap: string | null;
  budget_min: number | null;
  budget_max: number | null;
  client_contact_required: boolean | null;
  must_haves: string[];
  nice_to_haves: string[];
  unclear: string[];
};

type Mode = "closed" | "paste" | "edit";

/**
 * T1 Vacature uitlezen: paste the vacancy text, let Claude extract the fixed
 * requirements, then check and edit them before saving.
 */
export function IntakePanel({
  extractAction,
  saveAction,
  current,
  defaultText,
  hasClaude,
}: {
  extractAction: (prev: IntakeState, formData: FormData) => Promise<IntakeState>;
  saveAction: (prev: TalentActionState, formData: FormData) => Promise<TalentActionState>;
  current: RequirementValues;
  defaultText: string;
  hasClaude: boolean;
}) {
  const [mode, setMode] = useState<Mode>("closed");
  const [draft, setDraft] = useState<{ values: RequirementValues; rawText?: string; key: number } | null>(null);
  const [extractState, extract, extracting] = useActionState(async (prev: IntakeState, formData: FormData) => {
    const result = await extractAction(prev, formData);
    if (result.extraction) {
      setDraft({ values: result.extraction, rawText: result.rawText, key: Date.now() });
      setMode("edit");
    }
    return result;
  }, {} as IntakeState);

  if (mode === "closed") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setMode("paste")} size="sm">
          <Sparkles aria-hidden="true" />
          Vacature uitlezen
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setDraft({ values: current, key: Date.now() });
            setMode("edit");
          }}
        >
          Vaste eisen bewerken
        </Button>
      </div>
    );
  }

  if (mode === "paste") {
    return (
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(() => extract(formData));
        }}
      >
        <Field
          label="Vacaturetekst"
          htmlFor="raw_text"
          error={extractState.fieldErrors?.raw_text}
          hint="Plak de vacature zoals de klant hem stuurde, of de tekst van de vacaturepagina."
        >
          <Textarea id="raw_text" name="raw_text" rows={10} defaultValue={extractState.rawText ?? defaultText} />
        </Field>
        {!hasClaude && (
          <p className="text-sm text-amber-800">
            Claude is niet gekoppeld. Je kunt de vaste eisen wel zelf invullen.
          </p>
        )}
        <FormMessage error={extractState.error} />
        <div className="flex gap-2 max-sm:*:flex-1 sm:justify-end">
          <Button variant="secondary" size="sm" onClick={() => setMode("closed")}>
            Annuleren
          </Button>
          <Button type="submit" size="sm" disabled={extracting || !hasClaude} aria-busy={extracting}>
            {extracting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <FileText aria-hidden="true" />}
            {extracting ? "Claude leest de vacature" : "Uitlezen met Claude"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <RequirementsForm
      key={draft?.key}
      values={draft?.values ?? current}
      rawText={draft?.rawText}
      fromClaude={Boolean(draft?.rawText)}
      action={saveAction}
      onDone={() => setMode("closed")}
    />
  );
}

function RequirementsForm({
  values,
  rawText,
  fromClaude,
  action,
  onDone,
}: {
  values: RequirementValues;
  rawText?: string;
  fromClaude: boolean;
  action: (prev: TalentActionState, formData: FormData) => Promise<TalentActionState>;
  onDone: () => void;
}) {
  const [contact, setContact] = useState(
    values.client_contact_required === true ? "ja" : values.client_contact_required === false ? "nee" : "",
  );
  const [state, formAction, pending] = useActionState(async (prev: TalentActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok && !result.warning) onDone();
    return result;
  }, {} as TalentActionState);
  const errors = state.fieldErrors ?? {};
  const invalid = (name: string) => (errors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      {fromClaude && (
        <p className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-900">
          Dit haalde Claude uit de tekst. Controleer alles en pas aan waar nodig, daarna sla je de vaste eisen op.
        </p>
      )}
      {rawText !== undefined && <input type="hidden" name="raw_text" value={rawText} />}
      <FormMessage error={state.error} />

      {contact === "ja" && (
        <p role="alert" className="flex gap-2 rounded-xl border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          De developer moet direct contact hebben met de klanten van de klant. Dat is een no go voor Nordavo: bespreek dit met de klant voor je gaat zoeken.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stack" htmlFor="req-stack" error={errors.stack} hint="Scheid met komma's" className="sm:col-span-2">
          <Input id="req-stack" name="stack" defaultValue={values.stack.join(", ")} {...invalid("stack")} />
        </Field>
        <Field label="Senioriteit" htmlFor="req-seniority" required error={errors.seniority}>
          <Select id="req-seniority" name="seniority" defaultValue={values.seniority}>
            {seniorities.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Uren per week" htmlFor="req-hours" error={errors.hours}>
          <Input id="req-hours" name="hours" inputMode="numeric" defaultValue={values.hours ?? ""} {...invalid("hours")} />
        </Field>
        <Field label="Overlap tijdzone" htmlFor="req-overlap" error={errors.timezone_overlap} className="sm:col-span-2">
          <Input id="req-overlap" name="timezone_overlap" defaultValue={values.timezone_overlap ?? ""} {...invalid("timezone_overlap")} />
        </Field>
        <Field label="Budget minimaal per maand (EUR)" htmlFor="req-budget-min" error={errors.budget_min}>
          <Input id="req-budget-min" name="budget_min" inputMode="decimal" defaultValue={values.budget_min ?? ""} {...invalid("budget_min")} />
        </Field>
        <Field label="Budget maximaal per maand (EUR)" htmlFor="req-budget-max" error={errors.budget_max}>
          <Input id="req-budget-max" name="budget_max" inputMode="decimal" defaultValue={values.budget_max ?? ""} {...invalid("budget_max")} />
        </Field>
        <Field label="Direct contact met klanten van de klant" htmlFor="req-contact" className="sm:col-span-2">
          <Select id="req-contact" name="client_contact_required" value={contact} onChange={(e) => setContact(e.target.value)}>
            <option value="">Nog onbekend</option>
            <option value="nee">Nee</option>
            <option value="ja">Ja</option>
          </Select>
        </Field>
        <Field label="Must haves" htmlFor="req-must" error={errors.must_haves} hint="Eén eis per regel">
          <Textarea id="req-must" name="must_haves" rows={6} defaultValue={values.must_haves.join("\n")} {...invalid("must_haves")} />
        </Field>
        <Field label="Nice to haves" htmlFor="req-nice" error={errors.nice_to_haves} hint="Eén punt per regel">
          <Textarea id="req-nice" name="nice_to_haves" rows={6} defaultValue={values.nice_to_haves.join("\n")} {...invalid("nice_to_haves")} />
        </Field>
        <Field label="Nog navragen" htmlFor="req-unclear" error={errors.unclear} hint="Eén vraag per regel" className="sm:col-span-2">
          <Textarea id="req-unclear" name="unclear" rows={4} defaultValue={values.unclear.join("\n")} {...invalid("unclear")} />
        </Field>
      </div>

      <ActionFeedback state={state.error ? {} : state} />

      <div className="flex gap-2 border-t border-border pt-4 max-sm:*:flex-1 sm:justify-end">
        <Button variant="secondary" size="sm" onClick={onDone}>
          {state.ok ? "Sluiten" : "Annuleren"}
        </Button>
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Bezig met opslaan" : "Vaste eisen opslaan"}
        </Button>
      </div>
    </form>
  );
}
