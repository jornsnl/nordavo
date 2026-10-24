"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";

const inputClass =
  "block w-full rounded-xl border border-border bg-white px-4 py-3 text-[15px] text-ink shadow-xs outline-none transition placeholder:text-muted/60 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 aria-invalid:border-danger";

export function SetPasswordForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [showPassword, setShowPassword] = useState(false);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium text-ink">
          Nieuw wachtwoord
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "password-error" : "password-hint"}
            className={`${inputClass} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-500"
            aria-label={showPassword ? "Verberg wachtwoord" : "Toon wachtwoord"}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOff className="size-5" aria-hidden="true" />
            ) : (
              <Eye className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>
        {errors.password ? (
          <p id="password-error" className="text-xs font-medium text-danger">
            {errors.password}
          </p>
        ) : (
          <p id="password-hint" className="text-xs text-muted">
            Minimaal 8 tekens.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="confirm" className="block text-sm font-medium text-ink">
          Herhaal wachtwoord
        </label>
        <input
          id="confirm"
          name="confirm"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
          aria-invalid={Boolean(errors.confirm)}
          aria-describedby={errors.confirm ? "confirm-error" : undefined}
          className={inputClass}
        />
        {errors.confirm && (
          <p id="confirm-error" className="text-xs font-medium text-danger">
            {errors.confirm}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <>
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            Bezig met opslaan
          </>
        ) : (
          <>
            Wachtwoord opslaan
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
