"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound, LoaderCircle } from "lucide-react";
import { startAuthentication, type AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { useWebAuthnSupport } from "@/components/settings/security/passkey-support";
import { finishPasskeySignIn, startPasskeySignIn } from "./passkey-actions";

/** "Inloggen met passkey" under the password form. Hidden when the browser has no passkey support. */
export function PasskeySignIn() {
  const searchParams = useSearchParams();
  const supported = useWebAuthnSupport();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  if (!supported) return null;

  function signIn() {
    startTransition(async () => {
      setError(undefined);
      const start = await startPasskeySignIn();
      if (!start.options) {
        setError(start.error);
        return;
      }

      let response: AuthenticationResponseJSON;
      try {
        response = await startAuthentication({ optionsJSON: start.options });
      } catch (cause) {
        // Closing the prompt is a choice, not an error.
        if (cause instanceof Error && (cause.name === "NotAllowedError" || cause.name === "AbortError")) {
          return;
        }
        setError("Inloggen met een passkey lukt niet op dit apparaat. Log in met je wachtwoord.");
        return;
      }

      // Redirects on success; only failures come back.
      const result = await finishPasskeySignIn(response, searchParams.get("next"));
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="flex items-center gap-3 text-xs font-medium tracking-wide text-muted uppercase">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        of
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        aria-busy={pending}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-3 text-[15px] font-semibold text-brand-900 shadow-xs transition hover:border-brand-200 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <>
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            Bezig met inloggen
          </>
        ) : (
          <>
            <KeyRound className="size-5" aria-hidden="true" />
            Inloggen met passkey
          </>
        )}
      </button>
    </div>
  );
}
