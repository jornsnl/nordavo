"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Plus } from "lucide-react";
import {
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { ActionState } from "@/lib/action-state";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { PendingSubmit } from "@/components/placements/form-utils";
import { useWebAuthnSupport } from "./passkey-support";

/** "Passkey toevoegen": a name, then the browser's own passkey prompt. */
export function PasskeyRegister({
  startAction,
  finishAction,
}: {
  startAction: (name: string) => Promise<{
    options?: PublicKeyCredentialCreationOptionsJSON;
    error?: string;
    fieldErrors?: Record<string, string>;
  }>;
  finishAction: (name: string, response: RegistrationResponseJSON) => Promise<ActionState>;
}) {
  const supported = useWebAuthnSupport();
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const nameError = state.fieldErrors?.name;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();

    startTransition(async () => {
      setState({});
      const start = await startAction(name);
      if (!start.options) {
        setState({ error: start.error, fieldErrors: start.fieldErrors });
        return;
      }

      let response: RegistrationResponseJSON;
      try {
        response = await startRegistration({ optionsJSON: start.options });
      } catch (error) {
        setState({ error: registrationErrorMessage(error) });
        return;
      }

      const result = await finishAction(name, response);
      setState(result);
      if (result.ok) form.reset();
    });
  }

  if (!supported) {
    return (
      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
        Deze browser ondersteunt geen passkeys. Gebruik een recente versie van Safari, Chrome, Edge
        of Firefox om een passkey toe te voegen.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Naam van de passkey"
          htmlFor="passkey_name"
          required
          error={nameError}
          hint="Bijvoorbeeld MacBook, iPhone of 1Password."
        >
          <Input
            id="passkey_name"
            name="name"
            autoComplete="off"
            required
            maxLength={80}
            disabled={pending}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? "passkey_name-error" : undefined}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <PendingSubmit pending={pending} pendingLabel="Wacht op je apparaat">
          <Plus aria-hidden="true" />
          Passkey toevoegen
        </PendingSubmit>
      </div>
    </form>
  );
}

function registrationErrorMessage(error: unknown) {
  if (error instanceof WebAuthnError && error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "Dit apparaat heeft al een passkey voor je account.";
  }
  if (error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")) {
    return "Je hebt het toevoegen geannuleerd, of het duurde te lang. Probeer het opnieuw.";
  }
  return "De passkey is niet toegevoegd. Probeer het opnieuw.";
}
