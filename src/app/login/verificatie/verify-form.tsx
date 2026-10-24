"use client";

import { useActionState } from "react";
import { ArrowRight, ChevronDown, LoaderCircle } from "lucide-react";
import { verifyCode, type VerifyState } from "./actions";

const inputClass =
  "block w-full rounded-xl border border-border bg-white px-4 py-3 text-[15px] text-ink shadow-xs outline-none transition placeholder:text-muted/60 focus:border-brand-500 focus:ring-4 focus:ring-brand-100";

export function VerifyForm({
  factors,
  next,
}: {
  factors: { id: string; name: string }[];
  next: string;
}) {
  const [state, formAction, pending] = useActionState<VerifyState, FormData>(verifyCode, {});

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      {factors.length > 1 ? (
        <div className="space-y-2">
          <label htmlFor="factor_id" className="block text-sm font-medium text-ink">
            Authenticator app
          </label>
          <div className="relative">
            <select
              id="factor_id"
              name="factor_id"
              defaultValue={factors[0].id}
              className={`${inputClass} appearance-none pr-10`}
            >
              {factors.map((factor) => (
                <option key={factor.id} value={factor.id}>
                  {factor.name}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted"
            />
          </div>
        </div>
      ) : (
        <input type="hidden" name="factor_id" value={factors[0].id} />
      )}

      <div className="space-y-2">
        <label htmlFor="code" className="block text-sm font-medium text-ink">
          Code uit je app
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          placeholder="123456"
          aria-describedby="code-hint"
          className={`${inputClass} font-mono text-lg tracking-[0.4em]`}
        />
        <p id="code-hint" className="text-xs text-muted">
          6 cijfers. De code verandert elke 30 seconden.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <>
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            Bezig met controleren
          </>
        ) : (
          <>
            Bevestigen
            <ArrowRight
              className="size-5 transition group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </>
        )}
      </button>
    </form>
  );
}
