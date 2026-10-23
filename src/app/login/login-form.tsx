"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { login, type LoginState } from "./actions";

const inputClass =
  "block w-full rounded-xl border border-border bg-white px-4 py-3 text-[15px] text-ink shadow-xs outline-none transition placeholder:text-muted/60 focus:border-brand-500 focus:ring-4 focus:ring-brand-100";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    login,
    {},
  );
  const [showPassword, setShowPassword] = useState(false);
  const linkError = searchParams.get("error");

  const error =
    state.error ??
    (linkError === "link"
      ? "Deze link is verlopen of al gebruikt. Vraag een nieuwe uitnodiging aan."
      : linkError === "account"
        ? "Je account is nog niet gekoppeld aan een bedrijf. Neem contact op met Nordavo."
        : undefined);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium text-ink">
          E-mailadres
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          placeholder="naam@bedrijf.nl"
          className={inputClass}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium text-ink">
          Wachtwoord
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="••••••••"
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
      </div>

      <button
        type="submit"
        disabled={pending}
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <>
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            Bezig met inloggen
          </>
        ) : (
          <>
            Inloggen
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
