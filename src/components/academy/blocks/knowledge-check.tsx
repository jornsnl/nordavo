"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { deleteCheckQuestion, listCheckQuestions, reorderCheckQuestions, saveCheckQuestion } from "@/app/dashboard/academy/learn-actions";
import { submitCheck } from "@/app/academy/learn-actions";
import type { AcademyCheckQuestionRow } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import { t } from "@/lib/academy/i18n";
import { type CheckResult, MAX_OPTIONS, checkCountWarning, checkOptions, parseCheckResult } from "@/lib/academy/learn/check";
import { ActionButton } from "@/components/academy/ui";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import type { BlockEditorProps, BlockViewerProps } from "./types";

// Knowledge check (Academy: kennischeck): three multiple choice questions
// with an explanation after answering. The editor manages the rows in
// academy_check_questions (staff only). The learner gets the questions
// without the answer (academy_check_questions_for) and the database scores
// the attempt (academy_submit_check).

type QuestionDraft = { id: string | null; question: string; options: string[]; correct: number; explanation: string };

const emptyQuestion: QuestionDraft = { id: null, question: "", options: ["", "", ""], correct: 0, explanation: "" };

function toDraft(row: AcademyCheckQuestionRow): QuestionDraft {
  return { id: row.id, question: row.question, options: checkOptions(row.options), correct: row.correct_index, explanation: row.explanation ?? "" };
}

function QuestionForm({
  blockId,
  draft,
  number,
  onSaved,
  onDelete,
  onMove,
  disabled,
}: {
  blockId: string;
  draft: QuestionDraft;
  number: number;
  onSaved: (row: AcademyCheckQuestionRow) => void;
  onDelete?: () => void;
  onMove?: (delta: number) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(draft);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const key = value.id ?? `new-${blockId}`;

  function setOption(index: number, text: string) {
    setValue({ ...value, options: value.options.map((o, i) => (i === index ? text : o)) });
  }

  function removeOption(index: number) {
    const options = value.options.filter((_, i) => i !== index);
    const correct = value.correct === index ? 0 : value.correct > index ? value.correct - 1 : value.correct;
    setValue({ ...value, options, correct });
  }

  function save() {
    setMessage({});
    start(async () => {
      const result = await saveCheckQuestion({
        blockId,
        id: value.id,
        question: value.question,
        options: value.options,
        correctIndex: value.correct,
        explanation: value.explanation || null,
      });
      if (result.error || !result.question) {
        setMessage({ error: result.error });
        return;
      }
      onSaved(result.question);
      if (value.id) setMessage({ success: "Saved." });
      else setValue(emptyQuestion);
    });
  }

  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-3" disabled={disabled || pending}>
      <div className="flex items-center justify-between gap-2">
        <legend className="text-sm font-semibold text-brand-900">{value.id ? `Question ${number}` : "New question"}</legend>
        {value.id && (
          <div className="flex items-center gap-0.5">
            {onMove && (
              <>
                <Button size="sm" variant="ghost" aria-label="Move up" onClick={() => onMove(-1)}>
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Move down" onClick={() => onMove(1)}>
                  <ArrowDown aria-hidden="true" />
                </Button>
              </>
            )}
            {onDelete && (
              <Button size="sm" variant="ghost" aria-label="Delete question" onClick={onDelete}>
                <Trash2 aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
      </div>
      <Field label="Question" htmlFor={`q-text-${key}`}>
        <Textarea id={`q-text-${key}`} rows={2} value={value.question} maxLength={2000} onChange={(e) => setValue({ ...value, question: e.target.value })} />
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Options (mark the correct one)</p>
        {value.options.map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="radio"
              name={`q-correct-${key}`}
              aria-label={`Option ${index + 1} is correct`}
              checked={value.correct === index}
              onChange={() => setValue({ ...value, correct: index })}
              className="size-4 shrink-0 accent-brand-700"
            />
            <Input value={option} maxLength={500} placeholder={`Option ${index + 1}`} aria-label={`Option ${index + 1}`} onChange={(e) => setOption(index, e.target.value)} />
            {value.options.length > 2 && (
              <Button size="sm" variant="ghost" aria-label={`Remove option ${index + 1}`} onClick={() => removeOption(index)}>
                <Trash2 aria-hidden="true" />
              </Button>
            )}
          </div>
        ))}
        {value.options.length < MAX_OPTIONS && (
          <Button size="sm" variant="ghost" onClick={() => setValue({ ...value, options: [...value.options, ""] })}>
            <Plus aria-hidden="true" />
            Add option
          </Button>
        )}
      </div>
      <Field label="Explanation after answering" htmlFor={`q-expl-${key}`} hint="Shown to the learner once they answered, right or wrong.">
        <Textarea id={`q-expl-${key}`} rows={2} value={value.explanation} maxLength={5000} onChange={(e) => setValue({ ...value, explanation: e.target.value })} />
      </Field>
      <FormMessage error={message.error} success={message.success} />
      <Button size="sm" onClick={save} disabled={!value.question.trim()}>
        {value.id ? "Save question" : "Add question"}
      </Button>
    </fieldset>
  );
}

export function KnowledgeCheckEditor({ block, disabled }: BlockEditorProps) {
  const [rows, setRows] = useState<AcademyCheckQuestionRow[] | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  const [, start] = useTransition();

  useEffect(() => {
    let live = true;
    void listCheckQuestions(block.id).then((list) => {
      if (live) setRows(list);
    });
    return () => {
      live = false;
    };
  }, [block.id]);

  function move(index: number, delta: number) {
    if (!rows || index + delta < 0 || index + delta >= rows.length) return;
    const next = [...rows];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setRows(next);
    start(async () => {
      const result = await reorderCheckQuestions(block.id, next.map((r) => r.id));
      setMessage(result.error);
    });
  }

  function remove(row: AcademyCheckQuestionRow) {
    if (!window.confirm("Delete this question? Earlier attempts keep their score.")) return;
    start(async () => {
      const result = await deleteCheckQuestion(row.id);
      if (result.ok) setRows((list) => (list ?? []).filter((r) => r.id !== row.id));
      setMessage(result.error);
    });
  }

  const warning = rows ? checkCountWarning(rows.length) : null;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Questions are saved one by one. Learners never see the correct answer before they answer; the score is calculated in the database.
      </p>
      {warning && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p>}
      {rows === null ? (
        <p className="text-sm text-muted">Loading questions…</p>
      ) : (
        rows.map((row, index) => (
          <QuestionForm
            key={row.id}
            blockId={block.id}
            draft={toDraft(row)}
            number={index + 1}
            disabled={disabled}
            onSaved={(saved) => setRows((list) => (list ?? []).map((r) => (r.id === saved.id ? saved : r)))}
            onDelete={() => remove(row)}
            onMove={(delta) => move(index, delta)}
          />
        ))
      )}
      <FormMessage error={message} />
      {rows !== null && (
        <QuestionForm blockId={block.id} draft={emptyQuestion} number={rows.length + 1} disabled={disabled} onSaved={(saved) => setRows((list) => [...(list ?? []), saved])} />
      )}
    </div>
  );
}

type LearnerQuestion = { id: string; question: string; options: Json };

function checkState(state: BlockViewerProps["state"]): { questions: LearnerQuestion[]; result: CheckResult | null } {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { questions: [], result: null };
  const s = state as { questions?: unknown; result?: Json };
  return { questions: Array.isArray(s.questions) ? (s.questions as LearnerQuestion[]) : [], result: parseCheckResult(s.result ?? null) };
}

export function KnowledgeCheckViewer({ block, state, locale, preview }: BlockViewerProps) {
  const router = useRouter();
  const { questions, result: saved } = checkState(state);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<CheckResult | null>(saved);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const minPercent = typeof block.completion.min_percent === "number" ? block.completion.min_percent : 0;

  if (questions.length === 0) return <p className="text-sm text-muted">{t(locale, "check.noQuestions")}</p>;

  function submit() {
    setError(null);
    if (questions.some((q) => answers[q.id] === undefined)) {
      setError(t(locale, "check.answerAll"));
      return;
    }
    start(async () => {
      const response = await submitCheck(block.id, answers);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response.result);
      setRetrying(false);
      router.refresh();
    });
  }

  const showResult = result && !retrying;
  const byQuestion = new Map((result?.results ?? []).map((r) => [r.questionId, r]));
  const attempts = saved?.attempts ?? null;
  const best = saved?.bestPercent ?? null;

  return (
    <div className="space-y-4">
      {preview && <p className="text-xs text-muted">{t(locale, "check.preview")}</p>}
      {block.required && minPercent > 0 && <p className="text-sm text-muted">{t(locale, "check.minScore", { percent: minPercent })}</p>}

      {showResult && (
        <div className="rounded-xl bg-academy-blue-50 px-4 py-3">
          <p className="font-semibold text-academy-blue-900">
            {t(locale, "check.result", { score: result.score, max: result.maxScore, percent: result.percent })}
          </p>
          {attempts !== null && best !== null && attempts > 1 && (
            <p className="mt-0.5 text-xs text-muted">{t(locale, "check.best", { percent: best, count: attempts })}</p>
          )}
        </div>
      )}

      <ol className="space-y-5">
        {questions.map((q, index) => {
          const options = checkOptions(q.options);
          const outcome = showResult ? byQuestion.get(q.id) : undefined;
          return (
            <li key={q.id}>
              <fieldset className="space-y-2">
                <legend className="space-y-0.5">
                  <span className="block text-xs font-medium text-muted">{t(locale, "check.question", { number: index + 1, total: questions.length })}</span>
                  <span className="block font-medium text-academy-blue-900">{q.question}</span>
                </legend>
                <div className="space-y-1.5">
                  {options.map((option, i) => {
                    const chosen = outcome ? outcome.chosen === i : answers[q.id] === i;
                    const isCorrect = outcome && outcome.correctIndex === i;
                    return (
                      <label
                        key={i}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 text-sm transition ${
                          outcome
                            ? isCorrect
                              ? "border-emerald-300 bg-emerald-50"
                              : chosen
                                ? "border-danger/30 bg-danger-bg"
                                : "border-academy-blue-100"
                            : chosen
                              ? "border-academy-orange-600/40 bg-academy-orange-50"
                              : "border-academy-blue-100 hover:border-academy-blue-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`check-${block.id}-${q.id}`}
                          checked={chosen}
                          disabled={Boolean(outcome) || pending}
                          onChange={() => setAnswers({ ...answers, [q.id]: i })}
                          className="mt-0.5 size-4 shrink-0 accent-academy-orange-600"
                        />
                        <span>{option}</span>
                      </label>
                    );
                  })}
                </div>
                {outcome && (
                  <div className="space-y-1 text-sm">
                    <p className={`flex items-center gap-1.5 font-medium ${outcome.correct ? "text-emerald-700" : "text-danger"}`}>
                      {outcome.correct ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
                      {outcome.correct ? t(locale, "check.correct") : t(locale, "check.wrong")}
                      {!outcome.correct && options[outcome.correctIndex] && (
                        <span className="font-normal text-muted"> · {t(locale, "check.correctAnswer", { answer: options[outcome.correctIndex] })}</span>
                      )}
                    </p>
                    {outcome.explanation && <p className="whitespace-pre-line text-ink">{outcome.explanation}</p>}
                  </div>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {showResult ? (
        <ActionButton
          variant="secondary"
          onClick={() => {
            setAnswers({});
            setRetrying(true);
          }}
        >
          {t(locale, "check.retry")}
        </ActionButton>
      ) : (
        <ActionButton onClick={submit} disabled={pending}>
          {pending ? t(locale, "check.checking") : t(locale, "check.submit")}
        </ActionButton>
      )}
    </div>
  );
}
