"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { acceptWspIntro, completeWsp, recordWspPageTime, saveWspAnswer } from "@/app/working-style/actions";
import {
  ANSWER_OPTIONS,
  INTRO_BUTTON,
  INTRO_CHECKBOX,
  INTRO_LEAD,
  INTRO_SECTIONS,
  INTRO_TITLE,
  PAGE_INSTRUCTION,
} from "@/lib/wsp/content";
import type { WspAccess } from "@/lib/wsp/data";
import type { QuestionnaireData } from "@/lib/wsp/report";
import { splitPrivacy } from "@/lib/wsp/text";
import { introFor, pageCount, pageItems, progressPercent } from "@/lib/wsp/view";

/**
 * Intro screen with the mandatory checkbox, then 52 statements in fixed
 * order, 10 per page, five buttons each. Every answer is saved at once (the
 * person can stop and continue later on the same page); the time on each
 * page is recorded. After the last page: thank you, then the own report.
 */
export function WspQuestionnaire({ access, data, privacyUrl }: { access: WspAccess; data: QuestionnaireData; privacyUrl: string | null }) {
  const [started, setStarted] = useState(data.introAccepted);
  if (!started) return <Intro access={access} data={data} privacyUrl={privacyUrl} onStart={() => setStarted(true)} />;
  return <Pages access={access} data={data} />;
}

function Intro({ access, data, privacyUrl, onStart }: { access: WspAccess; data: QuestionnaireData; privacyUrl: string | null; onStart: () => void }) {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const top = introFor(data.personType).top;
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-6 shadow-xs sm:px-8 sm:py-8">
      {top && <p className="mb-4 rounded-xl bg-accent-100 px-4 py-3 text-sm font-medium text-brand-900">{top}</p>}
      <h1 className="font-display text-2xl font-bold text-brand-900">{INTRO_TITLE}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink">{INTRO_LEAD}</p>
      {INTRO_SECTIONS.map((section) => (
        <div key={section.heading} className="mt-5">
          <h2 className="font-display text-base font-semibold text-brand-900">{section.heading}</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink">
            {section.bullets.map((bullet) => (
              <li key={bullet}>
                <Bullet text={bullet} privacyUrl={privacyUrl} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form
        className="mt-6 space-y-4 border-t border-border pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!checked) return;
          startTransition(async () => {
            const result = await acceptWspIntro(access);
            if (result.ok) onStart();
            else setError(result.error);
          });
        }}
      >
        <label className="flex items-start gap-3 text-sm font-medium text-ink">
          <input
            type="checkbox"
            required
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 rounded border-border accent-brand-700"
          />
          {INTRO_CHECKBOX}
        </label>
        {error && (
          <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!checked || pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {INTRO_BUTTON}
        </button>
      </form>
    </section>
  );
}

function Bullet({ text, privacyUrl }: { text: string; privacyUrl: string | null }) {
  const parts = splitPrivacy(text);
  if (!parts) return <>{text}</>;
  // "Read our privacy statement [link to privacy statement]." The words
  // "privacy statement" become the link (NEXT_PUBLIC_PRIVACY_URL).
  const words = "privacy statement";
  const before = parts.before.trimEnd();
  if (!privacyUrl || !before.endsWith(words)) return <>{before}{parts.after}</>;
  return (
    <>
      {before.slice(0, -words.length)}
      <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline hover:no-underline">
        {words}
      </a>
      {parts.after}
    </>
  );
}

function Pages({ access, data }: { access: WspAccess; data: QuestionnaireData }) {
  const router = useRouter();
  const items = data.items;
  const pages = pageCount(items);
  const [page, setPage] = useState(Math.min(data.page, pages));
  const [answers, setAnswers] = useState<Record<string, number>>(data.answers);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [finishing, startFinish] = useTransition();
  const mark = useRef<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Time on the page: counted while the page is visible.
  const takeElapsed = useCallback(() => {
    if (mark.current === null) return 0;
    const now = performance.now();
    const elapsed = Math.max(0, Math.round(now - mark.current));
    mark.current = now;
    return elapsed;
  }, []);

  useEffect(() => {
    mark.current = document.visibilityState === "visible" ? performance.now() : null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        const elapsed = takeElapsed();
        mark.current = null;
        if (elapsed > 0) void recordWspPageTime(access, page, elapsed);
      } else {
        mark.current = performance.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [access, page, takeElapsed]);

  const current = useMemo(() => pageItems(items, page), [items, page]);
  const answeredCount = items.filter((item) => answers[item.id]).length;
  const pageComplete = current.every((item) => answers[item.id]);
  const anySaving = Object.values(saving).some(Boolean);

  function answer(itemId: string, value: number) {
    const previous = answers[itemId];
    setAnswers((a) => ({ ...a, [itemId]: value }));
    setSaving((s) => ({ ...s, [itemId]: true }));
    setError(undefined);
    void saveWspAnswer(access, { itemId, answer: value, page, elapsedMs: takeElapsed() }).then((result) => {
      setSaving((s) => ({ ...s, [itemId]: false }));
      if (!result.ok) {
        setAnswers((a) => {
          const next = { ...a };
          if (previous) next[itemId] = previous;
          else delete next[itemId];
          return next;
        });
        setError(result.error);
      }
    });
  }

  function go(to: number) {
    const elapsed = takeElapsed();
    if (elapsed > 0) void recordWspPageTime(access, page, elapsed);
    setPage(to);
    mark.current = performance.now();
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function finish() {
    const elapsed = takeElapsed();
    startFinish(async () => {
      if (elapsed > 0) await recordWspPageTime(access, page, elapsed);
      const result = await completeWsp(access);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      setTimeout(() => router.refresh(), 2500);
    });
  }

  if (done) {
    return (
      <section role="status" className="rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-xs">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden="true" />
        <h1 className="mt-3 font-display text-2xl font-bold text-brand-900">Thank you</h1>
        <p className="mt-2 text-sm text-ink">Your answers are saved. Your report is ready and opens in a moment.</p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-800"
        >
          See my report
        </button>
      </section>
    );
  }

  const percent = progressPercent(answeredCount, items.length);
  return (
    <section className="space-y-4" aria-label="Questionnaire">
      <div ref={topRef} className="sticky top-0 z-10 -mx-4 bg-surface/95 px-4 pt-3 pb-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:px-5">
        <div className="flex items-center justify-between text-xs font-medium text-muted">
          <span>
            Page {page} of {pages}
          </span>
          <span>
            {answeredCount} of {items.length} answered
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Progress"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-2 overflow-hidden rounded-full bg-brand-100"
        >
          <div className="h-2 rounded-full bg-brand-700 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-900">{PAGE_INSTRUCTION}</p>

      <ol className="space-y-3">
        {current.map((item) => (
          <li key={item.id} className="rounded-2xl border border-border bg-card px-4 py-4 shadow-xs sm:px-5">
            <fieldset>
              <legend className="text-[15px] font-medium text-ink">
                <span className="mr-2 text-muted tabular-nums">{item.position}.</span>
                {item.statement}
              </legend>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={item.statement}>
                {ANSWER_OPTIONS.map((option) => {
                  const selected = answers[item.id] === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => answer(item.id, option.value)}
                      className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 sm:text-center sm:text-xs ${
                        selected
                          ? "border-brand-700 bg-brand-700 text-white"
                          : "border-border bg-white text-ink hover:border-brand-200 hover:bg-brand-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-3 text-sm font-semibold text-brand-900 hover:bg-brand-50 disabled:invisible"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>
        {!pageComplete && <p className="text-center text-xs text-muted">Answer every statement on this page to continue.</p>}
        {page < pages ? (
          <button
            type="button"
            disabled={!pageComplete || anySaving}
            onClick={() => go(page + 1)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            disabled={!pageComplete || anySaving || finishing || answeredCount < items.length}
            onClick={finish}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {finishing && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            Finish
          </button>
        )}
      </div>
      <p className="text-center text-xs text-muted">Your answers are saved as you go. You can close this page and continue later.</p>
    </section>
  );
}
