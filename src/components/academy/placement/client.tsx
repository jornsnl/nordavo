"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleCheck, Copy, LoaderCircle, Undo2 } from "lucide-react";
import type { AcademyLocale } from "@/lib/academy/database";
import { initialActionState } from "@/lib/action-state";
import { t } from "@/lib/academy/i18n";
import type { ReviewAnswers } from "@/lib/academy/placement/timeline";
import { answerPulse, cancelLeave, requestLeave, saveReview, tickRitual } from "@/app/academy/placements/actions";
import { ActionButton } from "@/components/academy/ui";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";

// Interactive parts of the placement page. Server actions in
// src/app/academy/placements/actions.ts; the database checks who may do what.

/** One-click tick for a ritual period. */
export function RitualTick({
  ritualId,
  placementId,
  periodDate,
  done,
  canTick,
  locale,
  compact = false,
}: {
  ritualId: string;
  placementId: string;
  periodDate: string;
  done: boolean;
  canTick: boolean;
  locale: AcademyLocale;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<boolean>(done);
  const [failed, setFailed] = useState(false);
  const toggle = () =>
    start(async () => {
      const next = !state;
      setState(next);
      setFailed(false);
      const result = await tickRitual({ ritualId, placementId, periodDate, done: next });
      if (!result.ok) {
        setState(!next);
        setFailed(true);
      } else {
        router.refresh();
      }
    });

  if (!canTick) {
    return state ? (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
        <CircleCheck className="size-4" aria-hidden="true" />
        {t(locale, "rituals.done")}
      </span>
    ) : (
      <span aria-hidden="true" className="inline-block size-5 rounded-full border-2 border-academy-blue-300" />
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {state ? (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-600/20 transition hover:bg-emerald-100 pointer-coarse:min-h-11"
          aria-label={`${t(locale, "rituals.done")}. ${t(locale, "rituals.undo")}`}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
          {!compact && t(locale, "rituals.done")}
          <Undo2 className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
      ) : (
        <ActionButton onClick={toggle} disabled={pending} className={compact ? "px-3 py-2" : ""}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          {t(locale, "rituals.tick")}
        </ActionButton>
      )}
      {failed && <span role="alert" className="text-xs text-danger">{t(locale, "rituals.failed")}</span>}
    </span>
  );
}

/** The review form of a moment (client contacts and the developer). */
export function ReviewForm({
  placementId,
  milestoneId,
  initial,
  locale,
}: {
  placementId: string;
  milestoneId: string;
  initial: ReviewAnswers;
  locale: AcademyLocale;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<ReviewAnswers>(initial);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; message?: string }>({});
  const save = (submit: boolean) =>
    start(async () => {
      const r = await saveReview({ placementId, milestoneId, answers, submit });
      setResult(r);
      if (r.ok) router.refresh();
    });
  const id = (key: string) => `review-${milestoneId}-${key}`;
  return (
    <div className="space-y-4">
      <FormMessage error={result.error} success={result.message} />
      <fieldset>
        <legend className="text-sm font-medium text-ink">{t(locale, "review.rating")}</legend>
        <div className="mt-2 flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={answers.rating === n}
              onClick={() => setAnswers({ ...answers, rating: n })}
              className={`size-11 rounded-xl text-sm font-semibold ring-1 transition ${
                answers.rating === n
                  ? "bg-academy-orange-600 text-white ring-academy-orange-600"
                  : "bg-white text-academy-blue-900 ring-academy-blue-200 hover:bg-academy-blue-50"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      {(["going_well", "improve", "support"] as const).map((key) => (
        <Field key={key} label={t(locale, `review.${key}`)} htmlFor={id(key)}>
          <Textarea
            id={id(key)}
            rows={3}
            maxLength={5000}
            value={answers[key] ?? ""}
            onChange={(e) => setAnswers({ ...answers, [key]: e.target.value })}
          />
        </Field>
      ))}
      <div className="flex flex-wrap gap-2">
        <ActionButton onClick={() => save(true)} disabled={pending}>
          {t(locale, "review.submit")}
        </ActionButton>
        <ActionButton variant="secondary" onClick={() => save(false)} disabled={pending}>
          {t(locale, "review.saveDraft")}
        </ActionButton>
      </div>
    </div>
  );
}

/** The developer asks for leave. */
export function LeaveForm({ placementId, locale, today }: { placementId: string; locale: AcademyLocale; today: string }) {
  const [state, action, pending] = useActionState(requestLeave.bind(null, placementId), initialActionState);
  const [start, setStart] = useState(today);
  return (
    <form action={action} className="space-y-4" key={state.ok ? state.message : "form"}>
      <FormMessage error={state.error} success={state.message} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t(locale, "leave.kind")} htmlFor="leave-kind">
          <Select id="leave-kind" name="kind" defaultValue="vacation">
            {(["vacation", "sick", "unpaid", "other"] as const).map((k) => (
              <option key={k} value={k}>
                {t(locale, `leave.kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t(locale, "leave.from")} htmlFor="leave-start">
          <Input id="leave-start" name="start_date" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={t(locale, "leave.to")} htmlFor="leave-end" hint={t(locale, "leave.daysHint")}>
          <Input id="leave-end" name="end_date" type="date" required min={start} defaultValue={start} />
        </Field>
      </div>
      <Field label={t(locale, "leave.note")} htmlFor="leave-note">
        <Textarea id="leave-note" name="note" rows={2} maxLength={2000} />
      </Field>
      <ActionButton type="submit" disabled={pending}>
        {t(locale, "leave.send")}
      </ActionButton>
    </form>
  );
}

export function CancelLeaveButton({ placementId, requestId, locale }: { placementId: string; requestId: string; locale: AcademyLocale }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <ActionButton
      variant="quiet"
      className="px-2 py-1 text-xs"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(t(locale, "leave.cancelConfirm"))) return;
        start(async () => {
          const r = await cancelLeave(placementId, requestId);
          if (r.ok) router.refresh();
        });
      }}
    >
      {t(locale, "leave.cancel")}
    </ActionButton>
  );
}

/** Copy the calendar subscription link. */
export function CopyLink({ url, locale }: { url: string; locale: AcademyLocale }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input readOnly value={url} aria-label={t(locale, "holidays.subscribe")} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
      <ActionButton
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        <Copy aria-hidden="true" />
        {copied ? t(locale, "holidays.copied") : t(locale, "holidays.copy")}
      </ActionButton>
    </div>
  );
}

/** The own pulse: score 1 to 10, what goes well, what chafes. */
export function PulseForm({ placementId, pulseId, locale }: { placementId: string; pulseId: string; locale: AcademyLocale }) {
  const [state, action, pending] = useActionState(answerPulse.bind(null, placementId, pulseId), initialActionState);
  const [score, setScore] = useState<number | null>(null);
  if (state.ok) return <FormMessage success={state.message} />;
  return (
    <form action={action} className="space-y-4">
      <FormMessage error={state.error} />
      <fieldset>
        <legend className="text-sm font-medium text-ink">{t(locale, "pulse.score")}</legend>
        <div className="mt-2 grid grid-cols-5 gap-2 sm:flex">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <label
              key={n}
              className={`flex h-11 cursor-pointer items-center justify-center rounded-xl text-sm font-semibold ring-1 transition sm:w-11 ${
                score === n
                  ? "bg-academy-orange-600 text-white ring-academy-orange-600"
                  : "bg-white text-academy-blue-900 ring-academy-blue-200 hover:bg-academy-blue-50"
              }`}
            >
              <input type="radio" name="score" value={n} className="sr-only" onChange={() => setScore(n)} required />
              {n}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t(locale, "pulse.going_well")} htmlFor={`pulse-well-${pulseId}`}>
        <Textarea id={`pulse-well-${pulseId}`} name="going_well" rows={2} maxLength={5000} />
      </Field>
      <Field label={t(locale, "pulse.friction")} htmlFor={`pulse-friction-${pulseId}`}>
        <Textarea id={`pulse-friction-${pulseId}`} name="friction" rows={2} maxLength={5000} />
      </Field>
      <ActionButton type="submit" disabled={pending || score === null}>
        {t(locale, "pulse.send")}
      </ActionButton>
    </form>
  );
}
