"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { initialActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import {
  type MfaEnrollState,
  cancelMfaEnrollment,
  startMfaEnrollment,
  verifyMfaEnrollment,
} from "@/app/dashboard/instellingen/mfa-actions";

/** "App toevoegen": name, then QR code and secret, then the first code from the app. */
export function MfaEnroll({ hasFactors }: { hasFactors: boolean }) {
  const [open, setOpen] = useState(false);
  // A fresh flow, with empty form state, every time the user starts again.
  const [attempt, setAttempt] = useState(0);

  if (!open) {
    return (
      <div className="flex justify-end max-sm:*:w-full">
        <Button
          variant={hasFactors ? "secondary" : "primary"}
          onClick={() => {
            setAttempt((n) => n + 1);
            setOpen(true);
          }}
        >
          <Plus aria-hidden="true" />
          {hasFactors ? "Nog een app toevoegen" : "Tweestapsverificatie aanzetten"}
        </Button>
      </div>
    );
  }

  return <EnrollFlow key={attempt} defaultName={hasFactors ? "" : "Telefoon"} onClose={() => setOpen(false)} />;
}

function EnrollFlow({ defaultName, onClose }: { defaultName: string; onClose: () => void }) {
  const [enrollState, enrollAction, enrolling] = useActionState<MfaEnrollState, FormData>(
    startMfaEnrollment,
    initialActionState,
  );
  const [verifyState, verifyAction, verifying] = useActionState(verifyMfaEnrollment, initialActionState);
  const [cancelling, startCancel] = useTransition();
  const factorId = enrollState.factorId;

  function cancel() {
    if (!factorId) {
      onClose();
      return;
    }
    startCancel(async () => {
      await cancelMfaEnrollment(factorId);
      onClose();
    });
  }

  if (verifyState.ok) {
    return (
      <div className="space-y-4 rounded-xl border border-border p-4">
        <FormMessage success={verifyState.message} />
        <div className="flex justify-end max-sm:*:w-full">
          <Button variant="secondary" onClick={onClose}>
            Klaar
          </Button>
        </div>
      </div>
    );
  }

  // Step 1: a name, so the user can tell several apps apart later.
  if (!factorId) {
    const errors = enrollState.fieldErrors ?? {};
    return (
      <form
        onSubmit={submitWithoutReset(enrollAction)}
        className="space-y-4 rounded-xl border border-border p-4"
        noValidate
      >
        <FormMessage error={enrollState.error} />
        <Field
          label="Naam van de app of telefoon"
          htmlFor="mfa_friendly_name"
          required
          error={errors.friendly_name}
          hint="Bijvoorbeeld: iPhone of 1Password."
        >
          <Input
            id="mfa_friendly_name"
            name="friendly_name"
            autoComplete="off"
            enterKeyHint="next"
            required
            maxLength={60}
            defaultValue={defaultName}
            aria-invalid={Boolean(errors.friendly_name)}
            aria-describedby={errors.friendly_name ? "mfa_friendly_name-error" : undefined}
          />
        </Field>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={cancel} disabled={enrolling}>
            Annuleren
          </Button>
          <PendingSubmit pending={enrolling} pendingLabel="Bezig">
            Volgende
          </PendingSubmit>
        </div>
      </form>
    );
  }

  // Step 2: scan the QR code (or type the secret), then confirm with the first code.
  const errors = verifyState.fieldErrors ?? {};
  return (
    <form action={verifyAction} className="space-y-5 rounded-xl border border-border p-4" noValidate>
      <input type="hidden" name="factor_id" value={factorId} />
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
        <li>Open je authenticator app en kies voor een nieuw account of het plusje.</li>
        <li>Scan de QR-code hieronder. Lukt scannen niet, vul dan de sleutel handmatig in.</li>
        <li>Vul de code van 6 cijfers in die de app nu laat zien.</li>
      </ol>

      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        {/* A data URI from Supabase Auth, so next/image adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={enrollState.qrCode}
          alt={`QR-code voor ${enrollState.friendlyName ?? "je authenticator app"}`}
          width={176}
          height={176}
          className="size-44 shrink-0 rounded-xl border border-border bg-white p-2 max-sm:size-48"
        />
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium text-ink">Sleutel voor handmatig invoeren</p>
          <code className="block rounded-lg bg-surface px-3 py-2 font-mono text-sm break-all text-ink select-all">
            {enrollState.secret?.match(/.{1,4}/g)?.join(" ")}
          </code>
          <p className="text-xs text-muted">
            Kies in de app voor een tijdgebaseerde code. De spaties mag je weglaten.
          </p>
        </div>
      </div>

      <FormMessage error={verifyState.error} />
      <Field label="Code uit de app" htmlFor="mfa_code" required error={errors.code}>
        <Input
          id="mfa_code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCorrect="off"
          enterKeyHint="done"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          placeholder="123456"
          className="font-mono tracking-[0.3em] sm:max-w-48"
          aria-invalid={Boolean(errors.code)}
          aria-describedby={errors.code ? "mfa_code-error" : undefined}
        />
      </Field>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={cancel} disabled={verifying || cancelling}>
          Annuleren
        </Button>
        <PendingSubmit pending={verifying} disabled={cancelling} pendingLabel="Bezig met controleren">
          Bevestigen en aanzetten
        </PendingSubmit>
      </div>
    </form>
  );
}
