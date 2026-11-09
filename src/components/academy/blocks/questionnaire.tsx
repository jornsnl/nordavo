"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { saveQuestionnaire, setQuestionnaireConsent } from "@/app/academy/learn-actions";
import type { Json } from "@/lib/database.types";
import { t } from "@/lib/academy/i18n";
import {
  QUESTION_KINDS,
  type QuestionKind,
  type QuestionnaireAnswers,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
  cleanAnswers,
  dimensionKey,
  missingRequired,
  parseQuestionnaire,
  parseQuestionnaireResult,
  questionnaireContent,
} from "@/lib/academy/learn/questionnaire";
import { formatAcademyDate } from "@/lib/academy/time";
import { ActionButton } from "@/components/academy/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { BlockEditorProps, BlockViewerProps } from "./types";

// Questionnaire block (Academy: persoonlijkheidstest als vragenlijst). A
// generic mechanism: Nordavo defines the questions (scale 1 to 5, choice,
// open) and optional scoring dimensions; the learner gives explicit consent
// first (stored with a timestamp, withdrawable: the answers are then
// deleted). Answers are only for the person and Academy managers; the
// result summary reaches the ATS. The actual personality test is still to
// be specified by Julius.

const kindLabels: Record<QuestionKind, string> = { scale: "Scale 1 to 5", choice: "Choice", open: "Open answer" };

function newQuestion(def: QuestionnaireDefinition): QuestionnaireQuestion {
  let n = def.questions.length + 1;
  while (def.questions.some((q) => q.id === `q${n}`)) n += 1;
  return { id: `q${n}`, kind: "scale", text: "", options: [], optionScores: [], dimension: null, reverse: false, required: true };
}

export function QuestionnaireEditor({ block, content, onChange, disabled }: BlockEditorProps) {
  // Keep questions without text while editing: parse drops them, so edit a local copy.
  const [def, setDef] = useState<QuestionnaireDefinition>(() => parseQuestionnaire(content as Json));
  const [dimensionLabel, setDimensionLabel] = useState("");

  function update(next: QuestionnaireDefinition) {
    setDef(next);
    onChange(questionnaireContent(next));
  }
  function updateQuestion(index: number, patch: Partial<QuestionnaireQuestion>) {
    update({ ...def, questions: def.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)) });
  }
  function moveQuestion(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= def.questions.length) return;
    const questions = [...def.questions];
    const [item] = questions.splice(index, 1);
    questions.splice(target, 0, item);
    update({ ...def, questions });
  }
  function addDimension() {
    const key = dimensionKey(dimensionLabel);
    if (!key || def.dimensions.some((d) => d.key === key)) return;
    update({ ...def, dimensions: [...def.dimensions, { key, label: dimensionLabel.trim() }] });
    setDimensionLabel("");
  }

  const id = block.id;
  return (
    <div className="space-y-5">
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
        The content of the personality test is still to be specified by Julius. This block is the generic mechanism: questions, optional scoring
        dimensions, a consent step and its own access rights (answers only for Nordavo with the academy module, never for clients).
      </p>
      <Field label="Introduction" htmlFor={`qn-intro-${id}`}>
        <Textarea id={`qn-intro-${id}`} rows={3} value={def.intro} maxLength={5000} disabled={disabled} onChange={(e) => update({ ...def, intro: e.target.value })} />
      </Field>
      <Field label="Consent text" htmlFor={`qn-consent-${id}`} hint="The learner agrees to this before starting. Stored with a timestamp; withdrawing deletes the answers.">
        <Textarea id={`qn-consent-${id}`} rows={3} value={def.consentText} maxLength={3000} disabled={disabled} onChange={(e) => update({ ...def, consentText: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Scale: label for 1" htmlFor={`qn-low-${id}`} hint="Default: Disagree">
          <Input id={`qn-low-${id}`} value={def.scaleLow} maxLength={60} disabled={disabled} onChange={(e) => update({ ...def, scaleLow: e.target.value })} />
        </Field>
        <Field label="Scale: label for 5" htmlFor={`qn-high-${id}`} hint="Default: Agree">
          <Input id={`qn-high-${id}`} value={def.scaleHigh} maxLength={60} disabled={disabled} onChange={(e) => update({ ...def, scaleHigh: e.target.value })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={def.showResult}
          disabled={disabled}
          onChange={(e) => update({ ...def, showResult: e.target.checked })}
          className="size-4 accent-brand-700"
        />
        Show the learner their own result after submitting
      </label>

      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Scoring dimensions (optional)</p>
        <p className="text-xs text-muted">A dimension gets the average of the answers that count for it (1 to 5). The result is shown to Nordavo and in the ATS.</p>
        <ul className="flex flex-wrap gap-2">
          {def.dimensions.map((d) => (
            <li key={d.key} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
              {d.label}
              <button
                type="button"
                aria-label={`Remove ${d.label}`}
                disabled={disabled}
                onClick={() =>
                  update({
                    ...def,
                    dimensions: def.dimensions.filter((x) => x.key !== d.key),
                    questions: def.questions.map((q) => (q.dimension === d.key ? { ...q, dimension: null } : q)),
                  })
                }
                className="text-muted hover:text-danger"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            aria-label="New dimension"
            value={dimensionLabel}
            maxLength={100}
            placeholder="For example: Structure"
            disabled={disabled}
            onChange={(e) => setDimensionLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDimension();
              }
            }}
            className="sm:max-w-xs"
          />
          <Button size="sm" variant="secondary" disabled={disabled || !dimensionLabel.trim()} onClick={addDimension}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-ink">Questions</p>
        {def.questions.map((q, index) => (
          <fieldset key={q.id} className="space-y-3 rounded-xl border border-border p-3" disabled={disabled}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-brand-900">Question {index + 1}</span>
              <div className="flex items-center gap-0.5">
                <Button size="sm" variant="ghost" aria-label="Move up" onClick={() => moveQuestion(index, -1)}>
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Move down" onClick={() => moveQuestion(index, 1)}>
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Delete question" onClick={() => update({ ...def, questions: def.questions.filter((_, i) => i !== index) })}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <Field label="Kind" htmlFor={`qn-kind-${id}-${q.id}`}>
                <Select
                  id={`qn-kind-${id}-${q.id}`}
                  value={q.kind}
                  onChange={(e) => {
                    const kind = e.target.value as QuestionKind;
                    updateQuestion(index, {
                      kind,
                      options: kind === "choice" ? (q.options.length >= 2 ? q.options : ["", ""]) : [],
                      optionScores: kind === "choice" ? (q.options.length >= 2 ? q.optionScores : [null, null]) : [],
                      dimension: kind === "open" ? null : q.dimension,
                      reverse: kind === "scale" ? q.reverse : false,
                      required: kind === "open" ? false : q.required,
                    });
                  }}
                >
                  {QUESTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindLabels[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Question" htmlFor={`qn-text-${id}-${q.id}`}>
                <Input id={`qn-text-${id}-${q.id}`} value={q.text} maxLength={1000} onChange={(e) => updateQuestion(index, { text: e.target.value })} />
              </Field>
            </div>
            {q.kind === "choice" && (
              <div className="space-y-2">
                <p className="text-xs text-muted">Options{q.dimension ? ", each with a score of 1 to 5 for the dimension (empty: does not count)" : ""}.</p>
                {q.options.map((option, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <Input
                      aria-label={`Option ${oi + 1}`}
                      value={option}
                      maxLength={300}
                      placeholder={`Option ${oi + 1}`}
                      onChange={(e) => updateQuestion(index, { options: q.options.map((o, i) => (i === oi ? e.target.value : o)) })}
                    />
                    {q.dimension && (
                      <Input
                        aria-label={`Score of option ${oi + 1}`}
                        type="number"
                        min={1}
                        max={5}
                        value={q.optionScores[oi] ?? ""}
                        onChange={(e) => {
                          const n = e.target.value === "" ? null : Math.min(5, Math.max(1, Math.round(Number(e.target.value))));
                          updateQuestion(index, { optionScores: q.options.map((_, i) => (i === oi ? n : (q.optionScores[i] ?? null))) });
                        }}
                        className="w-20"
                      />
                    )}
                    {q.options.length > 2 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove option ${oi + 1}`}
                        onClick={() =>
                          updateQuestion(index, { options: q.options.filter((_, i) => i !== oi), optionScores: q.optionScores.filter((_, i) => i !== oi) })
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                ))}
                {q.options.length < 10 && (
                  <Button size="sm" variant="ghost" onClick={() => updateQuestion(index, { options: [...q.options, ""], optionScores: [...q.optionScores, null] })}>
                    <Plus aria-hidden="true" />
                    Add option
                  </Button>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-x-5 gap-y-2 text-sm">
              {q.kind !== "open" && def.dimensions.length > 0 && (
                <Field label="Counts for" htmlFor={`qn-dim-${id}-${q.id}`}>
                  <Select
                    id={`qn-dim-${id}-${q.id}`}
                    value={q.dimension ?? ""}
                    onChange={(e) => updateQuestion(index, { dimension: e.target.value || null })}
                    className="w-48"
                  >
                    <option value="">No dimension</option>
                    {def.dimensions.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {q.kind === "scale" && q.dimension && (
                <label className="flex items-center gap-2 pb-2.5">
                  <input type="checkbox" checked={q.reverse} onChange={(e) => updateQuestion(index, { reverse: e.target.checked })} className="size-4 accent-brand-700" />
                  Reverse (5 counts as 1)
                </label>
              )}
              <label className="flex items-center gap-2 pb-2.5">
                <input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(index, { required: e.target.checked })} className="size-4 accent-brand-700" />
                Required
              </label>
            </div>
          </fieldset>
        ))}
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => update({ ...def, questions: [...def.questions, newQuestion(def)] })}>
          <Plus aria-hidden="true" />
          Add question
        </Button>
        <p className="text-xs text-muted">Questions without text are left out when you save the block. Change questions before people start: submitted answers stay as they were.</p>
      </div>
    </div>
  );
}

type QState = {
  consent: { consentedAt: string; withdrawnAt: string | null } | null;
  response: { answers: Json; result: Json; submittedAt: string | null } | null;
};

function questionnaireState(state: BlockViewerProps["state"]): QState {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { consent: null, response: null };
  return state as unknown as QState;
}

export function QuestionnaireViewer({ block, state, locale, timeZone, preview }: BlockViewerProps) {
  const router = useRouter();
  const def = parseQuestionnaire(block.content as Json);
  const { consent, response } = questionnaireState(state);
  const consentActive = Boolean(consent && !consent.withdrawnAt);
  const submittedAt = response?.submittedAt ?? null;
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(() => cleanAnswers(def, response?.answers ?? {}));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const low = def.scaleLow || t(locale, "questionnaire.scaleLow");
  const high = def.scaleHigh || t(locale, "questionnaire.scaleHigh");

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function submit() {
    const missing = missingRequired(def, answers);
    if (missing.length > 0) {
      setError(t(locale, "questionnaire.missing", { count: missing.length }));
      return;
    }
    run(() => saveQuestionnaire(block.id, answers, true));
  }

  if (def.questions.length === 0) return <p className="text-sm text-muted">{t(locale, "questionnaire.empty")}</p>;

  const privacy = (
    <p className="flex items-start gap-2 text-xs text-muted">
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {t(locale, "questionnaire.private")}
    </p>
  );

  // Consent step: before anything else, also after a withdrawal.
  if (!consentActive && !preview) {
    return (
      <div className="space-y-4">
        {def.intro && <p className="whitespace-pre-line text-ink">{def.intro}</p>}
        {consent?.withdrawnAt && (
          <p className="text-sm text-muted">{t(locale, "questionnaire.withdrawn", { date: formatAcademyDate(consent.withdrawnAt, locale, timeZone) })}</p>
        )}
        <div className="space-y-3 rounded-xl border border-academy-blue-200 bg-academy-blue-50/50 p-4">
          <p className="flex items-center gap-2 font-semibold text-academy-blue-900">
            <ShieldCheck className="size-4" aria-hidden="true" />
            {t(locale, "questionnaire.consentTitle")}
          </p>
          <p className="text-sm whitespace-pre-line text-ink">{def.consentText}</p>
          {privacy}
          <ActionButton disabled={pending} onClick={() => run(() => setQuestionnaireConsent(block.id, true))}>
            {t(locale, "questionnaire.consentAgree")}
          </ActionButton>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  const locked = Boolean(submittedAt) || preview;
  const result = parseQuestionnaireResult(response?.result ?? null);

  return (
    <div className="space-y-5">
      {preview && <p className="text-xs text-muted">{t(locale, "questionnaire.preview")}</p>}
      {def.intro && <p className="whitespace-pre-line text-ink">{def.intro}</p>}
      {consent && consentActive && (
        <p className="text-xs text-muted">{t(locale, "questionnaire.consentGiven", { date: formatAcademyDate(consent.consentedAt, locale, timeZone) })}</p>
      )}
      {submittedAt && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {t(locale, "questionnaire.submitted", { date: formatAcademyDate(submittedAt, locale, timeZone) })}
        </p>
      )}
      {submittedAt && def.showResult && result.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-academy-blue-900">{t(locale, "questionnaire.result")}</p>
          <ul className="space-y-1.5">
            {result.map((d) => (
              <li key={d.key} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 text-ink">{d.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-academy-blue-100">
                  <span className="block h-full rounded-full bg-academy-blue-600" style={{ width: `${d.score === null ? 0 : ((d.score - 1) / 4) * 100}%` }} />
                </span>
                <span className="w-10 text-right tabular-nums text-muted">{d.score ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!submittedAt && (
        <ol className="space-y-5">
          {def.questions.map((q, index) => {
            const value = answers[q.id];
            const name = `qn-${block.id}-${q.id}`;
            return (
              <li key={q.id}>
                <fieldset className="space-y-2" disabled={locked || pending}>
                  <legend className="font-medium text-academy-blue-900">
                    <span className="mr-1 text-muted">{index + 1}.</span>
                    {q.text}
                    {q.required && <span className="ml-2 text-xs font-normal text-academy-orange-700">{t(locale, "questionnaire.required")}</span>}
                  </legend>
                  {q.kind === "scale" && (
                    <div className="space-y-1">
                      <div className="grid grid-cols-5 gap-1.5 sm:max-w-md">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <label
                            key={n}
                            className={`flex cursor-pointer items-center justify-center rounded-xl border py-2 text-sm font-semibold transition ${
                              value === n ? "border-academy-orange-600 bg-academy-orange-50 text-academy-orange-800" : "border-academy-blue-200 text-academy-blue-800 hover:border-academy-blue-400"
                            }`}
                          >
                            <input type="radio" name={name} className="sr-only" checked={value === n} onChange={() => setAnswers({ ...answers, [q.id]: n })} />
                            {n}
                          </label>
                        ))}
                      </div>
                      <div className="flex justify-between text-xs text-muted sm:max-w-md">
                        <span>1 · {low}</span>
                        <span>5 · {high}</span>
                      </div>
                    </div>
                  )}
                  {q.kind === "choice" && (
                    <div className="space-y-1.5">
                      {q.options.map((option, i) => (
                        <label
                          key={i}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 text-sm ${
                            value === i ? "border-academy-orange-600/40 bg-academy-orange-50" : "border-academy-blue-100 hover:border-academy-blue-300"
                          }`}
                        >
                          <input type="radio" name={name} checked={value === i} onChange={() => setAnswers({ ...answers, [q.id]: i })} className="mt-0.5 size-4 shrink-0 accent-academy-orange-600" />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {q.kind === "open" && (
                    <Textarea
                      aria-label={q.text}
                      rows={3}
                      maxLength={5000}
                      value={typeof value === "string" ? value : ""}
                      placeholder={t(locale, "questionnaire.openPlaceholder")}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                      className="border-academy-blue-200"
                    />
                  )}
                </fieldset>
              </li>
            );
          })}
        </ol>
      )}

      {privacy}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {saved && <p className="text-sm text-emerald-700">{t(locale, "questionnaire.saved")}</p>}
      {!preview && (
        <div className="flex flex-wrap items-center gap-2">
          {!submittedAt && (
            <>
              <ActionButton disabled={pending} onClick={submit}>
                {t(locale, "questionnaire.submit")}
              </ActionButton>
              <ActionButton variant="secondary" disabled={pending} onClick={() => run(() => saveQuestionnaire(block.id, answers, false), () => setSaved(true))}>
                {t(locale, "questionnaire.saveDraft")}
              </ActionButton>
            </>
          )}
          <ActionButton
            variant="quiet"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t(locale, "questionnaire.withdrawConfirm"))) {
                run(() => setQuestionnaireConsent(block.id, false), () => setAnswers({}));
              }
            }}
          >
            {t(locale, "questionnaire.withdraw")}
          </ActionButton>
        </div>
      )}
    </div>
  );
}
